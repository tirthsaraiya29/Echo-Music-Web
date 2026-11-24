import { Hono } from 'hono'
import { Ytdl, chooseFormat } from '@distube/ytdl-core'
import { Readable } from 'node:stream'
import { z } from 'zod'
import type { StreamFormat, StreamResolutionResult } from '../../src/types/innertube.ts'
import {
  isAllowedStreamingDomain,
  safeProxyFetch,
  proxyTargetUrlSchema,
  getProxySecurityMetrics,
} from '../utils/ssrf.ts'

export const streamRouter = new Hono()
const ytdl = new Ytdl()

export const streamResolveQuerySchema = z.object({
  videoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/, 'Valid 11-character videoId is required'),
  quality: z.enum(['low', 'medium', 'high', 'lossless']).default('high'),
})

export const streamFormatSchema = z.object({
  itag: z.number(),
  mimeType: z.string(),
  bitrate: z.number(),
  contentLength: z.string().optional(),
  audioQuality: z.enum(['AUDIO_QUALITY_LOW', 'AUDIO_QUALITY_MEDIUM', 'AUDIO_QUALITY_HIGH']),
  quality: z.string(),
  approxDurationMs: z.string().optional(),
})

export const streamResolutionResultSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  artist: z.string(),
  durationMs: z.number(),
  streamUrl: z.string(),
  format: streamFormatSchema,
  allAudioFormats: z.array(streamFormatSchema),
  expiresInSeconds: z.number(),
  source: z.enum(['opus', 'aac']),
})

export interface StreamResolverMetrics {
  totalRequests: number
  cacheHits: number
  cacheMisses: number
  inFlightJoins: number
  resolutionFailures: number
  lastFailureReason: string | null
}

const resolverMetrics: StreamResolverMetrics = {
  totalRequests: 0,
  cacheHits: 0,
  cacheMisses: 0,
  inFlightJoins: 0,
  resolutionFailures: 0,
  lastFailureReason: null,
}

export function getStreamResolverMetrics(): StreamResolverMetrics {
  return { ...resolverMetrics }
}

export function resetStreamResolverMetrics(): void {
  resolverMetrics.totalRequests = 0
  resolverMetrics.cacheHits = 0
  resolverMetrics.cacheMisses = 0
  resolverMetrics.inFlightJoins = 0
  resolverMetrics.resolutionFailures = 0
  resolverMetrics.lastFailureReason = null
}

export interface RangeStreamingMetrics {
  totalRangeRequests: number
  partialContentResponses: number
  notSatisfiableResponses: number
  fullContentResponses: number
  abortedStreams: number
}

const rangeMetrics: RangeStreamingMetrics = {
  totalRangeRequests: 0,
  partialContentResponses: 0,
  notSatisfiableResponses: 0,
  fullContentResponses: 0,
  abortedStreams: 0,
}

export function getRangeStreamingMetrics(): RangeStreamingMetrics {
  return { ...rangeMetrics }
}

export function resetRangeStreamingMetrics(): void {
  rangeMetrics.totalRangeRequests = 0
  rangeMetrics.partialContentResponses = 0
  rangeMetrics.notSatisfiableResponses = 0
  rangeMetrics.fullContentResponses = 0
  rangeMetrics.abortedStreams = 0
}

export function formatContentRange(start: number, end: number, total: number | '*'): string {
  return `bytes ${start}-${end}/${total}`
}

type VideoFormat = ReturnType<typeof chooseFormat>

export interface CachedVideoInfo {
  format: VideoFormat
  totalBytes: number
  title?: string
  author?: string
  durationSeconds?: number
  cachedAt: number
}

// LRU-bounded: Map preserves insertion order, so deleting and re-setting on access makes the
// oldest entry the eviction candidate.
const INFO_CACHE_MAX = 500
const infoCache = new Map<string, CachedVideoInfo>()
const inFlightInfo = new Map<string, Promise<CachedVideoInfo>>()
const inFlightYtdl = new Map<string, Promise<any>>()

export function clearInfoCache(): void {
  infoCache.clear()
  inFlightInfo.clear()
  inFlightYtdl.clear()
}

let customYtdlGetInfo: ((videoId: string) => Promise<any>) | null = null

export function setCustomYtdlGetInfo(fn: ((videoId: string) => Promise<any>) | null): void {
  customYtdlGetInfo = fn
}

function cacheInfo(key: string, value: CachedVideoInfo): void {
  infoCache.set(key, value)
  if (infoCache.size > INFO_CACHE_MAX) {
    const oldest = infoCache.keys().next().value
    if (oldest !== undefined) infoCache.delete(oldest)
  }
}

function getCachedInfo(key: string): CachedVideoInfo | undefined {
  const cached = infoCache.get(key)
  if (cached) {
    infoCache.delete(key)
    infoCache.set(key, cached)
  }
  return cached
}

export type StreamQuality = 'low' | 'medium' | 'high' | 'lossless'

export interface ParsedByteRange {
  start: number
  end?: number
}

export type ParseRangeResult =
  | { valid: true; range: ParsedByteRange }
  | { valid: false; status: 416 }

/**
 * Parses HTTP Range request header per RFC 9110 Section 14.1.2.
 * Strictly supports single byte ranges:
 * - Closed range: bytes=start-end (e.g. bytes=0-1024)
 * - Open-ended range: bytes=start- (e.g. bytes=1024-)
 * - Suffix range: bytes=-suffixLength (e.g. bytes=-500)
 *
 * Rejects multiple ranges (bytes=a-b,c-d), non-byte units, inverted ranges (start > end),
 * suffix ranges with 0 length, and out-of-bounds start offsets by returning { valid: false, status: 416 }.
 */
export function parseByteRange(rangeHeader: string, totalBytes: number): ParseRangeResult {
  if (typeof rangeHeader !== 'string') {
    return { valid: false, status: 416 }
  }

  const trimmed = rangeHeader.trim()
  // Reject multiple ranges (comma-separated byte-range-set per RFC 9110)
  if (trimmed.includes(',')) {
    return { valid: false, status: 416 }
  }

  // Must strictly match bytes=<range-spec>
  const prefixMatch = /^bytes=(.+)$/i.exec(trimmed)
  if (!prefixMatch || !prefixMatch[1]) {
    return { valid: false, status: 416 }
  }

  const spec = prefixMatch[1].trim()

  // Suffix range: -suffixLength (e.g. -500)
  const suffixMatch = /^-(\d+)$/.exec(spec)
  if (suffixMatch && suffixMatch[1]) {
    const suffixLen = Number.parseInt(suffixMatch[1], 10)
    if (suffixLen <= 0 || !Number.isFinite(suffixLen)) {
      return { valid: false, status: 416 }
    }
    if (totalBytes <= 0) {
      return { valid: false, status: 416 }
    }
    const start = Math.max(0, totalBytes - suffixLen)
    const end = totalBytes - 1
    return { valid: true, range: { start, end } }
  }

  // Closed range: start-end (e.g. 0-499)
  const closedMatch = /^(\d+)-(\d+)$/.exec(spec)
  if (closedMatch && closedMatch[1] && closedMatch[2]) {
    const start = Number.parseInt(closedMatch[1], 10)
    let end = Number.parseInt(closedMatch[2], 10)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      return { valid: false, status: 416 }
    }
    if (totalBytes > 0) {
      if (start >= totalBytes) {
        return { valid: false, status: 416 }
      }
      if (end >= totalBytes) {
        end = totalBytes - 1
      }
    }
    return { valid: true, range: { start, end } }
  }

  // Open-ended range: start- (e.g. 500-)
  const openMatch = /^(\d+)-$/.exec(spec)
  if (openMatch && openMatch[1]) {
    const start = Number.parseInt(openMatch[1], 10)
    if (!Number.isFinite(start)) {
      return { valid: false, status: 416 }
    }
    if (totalBytes > 0) {
      if (start >= totalBytes) {
        return { valid: false, status: 416 }
      }
      return { valid: true, range: { start, end: totalBytes - 1 } }
    }
    return { valid: true, range: { start } }
  }

  // Any other format is invalid/unsatisfiable
  return { valid: false, status: 416 }
}

function selectBestAudioFormat(
  formats: readonly VideoFormat[],
  quality: StreamQuality = 'high',
): VideoFormat {
  // YouTube audio delivery maxes out at ~160kbps Opus (ITAG 251) or ~128kbps AAC (ITAG 140).
  // Lossless formats (FLAC/WAV) are supported for local media and extension providers;
  // for YouTube stream resolution, 'lossless' maps to the highest available Opus tier (ITAG 251).
  // ITAGs: 140 = AAC ~128kbps, 250 = opus ~70-100kbps, 251 = opus ~160kbps.
  const itagByQuality: Record<StreamQuality, number> = {
    low: 140,
    medium: 250,
    high: 251,
    lossless: 251,
  }
  const preferred = formats.find((f) => f.itag === itagByQuality[quality])
  if (preferred) return preferred

  const audioOnly = [...formats]
    .filter((f) => f.hasAudio && !f.hasVideo)
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))

  if (quality === 'low') {
    const lowest = audioOnly[audioOnly.length - 1]
    if (lowest) return lowest
  }

  if (audioOnly[0]) return audioOnly[0]

  // Standard highestaudio selector fallback
  try {
    const chosen = chooseFormat(formats, {
      filter: { hasAudio: true, hasVideo: false },
      quality: 'highestaudio',
    })
    if (chosen) return chosen
  } catch {
    // Continue down the cascade
  }

  // Last resort fallback to first format or throw
  if (formats[0]) return formats[0]
  throw new Error('No compatible audio format found for track')
}

export async function getOrFetchVideoInfo(
  videoId: string,
  quality: StreamQuality = 'high',
): Promise<CachedVideoInfo> {
  resolverMetrics.totalRequests++
  // Cache per videoId+quality: one video's formats resolve to different ITAGs per quality tier.
  const cacheKey = `${videoId}:${quality}`
  const cached = getCachedInfo(cacheKey)
  if (cached && Date.now() - cached.cachedAt < 30 * 60 * 1000) {
    resolverMetrics.cacheHits++
    return cached
  }

  // Deduplicate in-flight requests for the exact same cacheKey
  const existingInFlight = inFlightInfo.get(cacheKey)
  if (existingInFlight) {
    resolverMetrics.inFlightJoins++
    return existingInFlight
  }

  resolverMetrics.cacheMisses++

  const fetchPromise = (async () => {
    try {
      // Deduplicate underlying ytdl.getInfo calls across concurrent requests for the same videoId
      let ytdlPromise = inFlightYtdl.get(videoId)
      if (!ytdlPromise) {
        ytdlPromise = (async () => {
          try {
            if (customYtdlGetInfo) {
              return await customYtdlGetInfo(videoId)
            }
            return await ytdl.getInfo(videoId)
          } finally {
            inFlightYtdl.delete(videoId)
          }
        })()
        inFlightYtdl.set(videoId, ytdlPromise)
      }

      const info = await ytdlPromise
      const format = selectBestAudioFormat(info.formats, quality)

      const totalBytes = Number.parseInt(String(format.contentLength ?? '0'), 10)
      const durationSeconds = Number.parseInt(String(info.videoDetails?.lengthSeconds ?? '0'), 10)

      const cachedInfo: CachedVideoInfo = {
        format,
        totalBytes,
        title: info.videoDetails?.title,
        author: info.videoDetails?.author?.name,
        durationSeconds,
        cachedAt: Date.now(),
      }

      cacheInfo(cacheKey, cachedInfo)
      return cachedInfo
    } catch (err) {
      resolverMetrics.resolutionFailures++
      resolverMetrics.lastFailureReason = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      inFlightInfo.delete(cacheKey)
    }
  })()

  inFlightInfo.set(cacheKey, fetchPromise)
  return fetchPromise
}

streamRouter.get('/telemetry', (c) => {
  return c.json(getStreamResolverMetrics())
})

streamRouter.get('/resolve', async (c) => {
  const query = {
    videoId: c.req.query('videoId'),
    quality: c.req.query('quality') || 'high',
  }

  const parsedQuery = streamResolveQuerySchema.safeParse(query)
  if (!parsedQuery.success) {
    return c.json(
      { error: parsedQuery.error.issues[0]?.message || 'Valid 11-character videoId is required' },
      400,
    )
  }

  const { videoId, quality } = parsedQuery.data

  try {
    const cachedInfo = await getOrFetchVideoInfo(videoId, quality)
    const formatInfo: StreamFormat = {
      itag: cachedInfo.format.itag,
      mimeType: cachedInfo.format.mimeType || 'audio/webm; codecs="opus"',
      bitrate: cachedInfo.format.bitrate ?? 160000,
      contentLength:
        cachedInfo.format.contentLength !== undefined
          ? String(cachedInfo.format.contentLength)
          : undefined,
      audioQuality:
        quality === 'low'
          ? 'AUDIO_QUALITY_LOW'
          : quality === 'medium'
            ? 'AUDIO_QUALITY_MEDIUM'
            : 'AUDIO_QUALITY_HIGH',
      quality: cachedInfo.format.quality || 'tiny',
      approxDurationMs: cachedInfo.durationSeconds
        ? String(cachedInfo.durationSeconds * 1000)
        : undefined,
    }

    const result: StreamResolutionResult = {
      videoId,
      title: cachedInfo.title || 'Unknown Title',
      artist: cachedInfo.author || 'Unknown Artist',
      durationMs: (cachedInfo.durationSeconds || 180) * 1000,
      streamUrl: `/api/stream/listen?videoId=${encodeURIComponent(videoId)}&quality=${encodeURIComponent(quality)}`,
      format: formatInfo,
      allAudioFormats: [formatInfo],
      expiresInSeconds: 21600,
      source: cachedInfo.format.mimeType?.includes('opus') ? 'opus' : 'aac',
    }

    const validatedResult = streamResolutionResultSchema.safeParse(result)
    if (!validatedResult.success) {
      return c.json({ error: 'Stream resolution result validation failed' }, 502)
    }

    return c.json(result)
  } catch (err: unknown) {
    return c.json(
      {
        error: 'Failed to resolve audio stream',
        message: err instanceof Error ? err.message : String(err),
      },
      502,
    )
  }
})

streamRouter.get('/range-telemetry', (c) => {
  return c.json(getRangeStreamingMetrics())
})

streamRouter.get('/listen', async (c) => {
  if (c.req.raw.signal?.aborted) {
    rangeMetrics.abortedStreams++
    return new Response(null, { status: 499 })
  }

  const videoId = c.req.query('videoId')
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return c.text('Valid 11-character videoId is required', 400)
  }
  const quality = (c.req.query('quality') as StreamQuality | undefined) ?? 'high'

  try {
    const cachedInfo = await getOrFetchVideoInfo(videoId, quality)
    const total = cachedInfo.totalBytes
    const rangeHeader = c.req.header('range')

    let start = 0
    let end: number | undefined = total > 0 ? total - 1 : undefined

    if (rangeHeader) {
      rangeMetrics.totalRangeRequests++
      const parsed = parseByteRange(rangeHeader, total)
      if (!parsed.valid) {
        rangeMetrics.notSatisfiableResponses++
        const notSatHeaders = new Headers()
        notSatHeaders.set('Content-Range', `bytes */${total > 0 ? total : '*'}`)
        notSatHeaders.set('Accept-Ranges', 'bytes')
        return new Response(null, { status: 416, headers: notSatHeaders })
      }
      start = parsed.range.start
      end = parsed.range.end
    }

    const stream = await ytdl.download(videoId, {
      format: cachedInfo.format,
      filter: { hasAudio: true, hasVideo: false },
      ...(end !== undefined ? { range: { start, end } } : { range: { start } }),
    })

    const webStream = Readable.toWeb(stream)
    const headers = new Headers()
    headers.set('Content-Type', cachedInfo.format.mimeType || 'audio/webm; codecs="opus"')
    headers.set('Accept-Ranges', 'bytes')
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Type')

    if (rangeHeader) {
      rangeMetrics.partialContentResponses++
      if (total > 0) {
        const chunkEnd = end !== undefined ? Math.min(end, total - 1) : total - 1
        const chunkLen = Math.max(0, chunkEnd - start + 1)
        headers.set('Content-Range', formatContentRange(start, chunkEnd, total))
        headers.set('Content-Length', String(chunkLen))
      } else {
        if (end !== undefined) {
          const chunkLen = Math.max(0, end - start + 1)
          headers.set('Content-Range', formatContentRange(start, end, '*'))
          headers.set('Content-Length', String(chunkLen))
        } else {
          headers.set('Content-Range', `bytes ${start}-/*`)
        }
      }
      return new Response(webStream as unknown as ReadableStream, { status: 206, headers })
    }

    rangeMetrics.fullContentResponses++
    if (total > 0) {
      headers.set('Content-Length', String(total))
    }
    return new Response(webStream as unknown as ReadableStream, { status: 200, headers })
  } catch (err: unknown) {
    return c.text(
      `Audio streaming failed: ${err instanceof Error ? err.message : String(err)}`,
      502,
    )
  }
})

streamRouter.get('/proxy-telemetry', (c) => {
  return c.json(getProxySecurityMetrics())
})

streamRouter.get('/proxy', async (c) => {
  if (c.req.raw.signal?.aborted) {
    return new Response(null, { status: 499 })
  }

  const rawUrl = c.req.query('url')
  if (!rawUrl) {
    return c.text('URL parameter is missing or targets an unauthorized domain', 403)
  }

  const parsedUrl = proxyTargetUrlSchema.safeParse(rawUrl)
  if (!parsedUrl.success || !isAllowedStreamingDomain(parsedUrl.data)) {
    return c.text('URL parameter is missing or targets an unauthorized domain', 403)
  }
  const targetUrl = parsedUrl.data

  const rangeHeader = c.req.header('range')
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    Origin: 'https://music.youtube.com',
    Referer: 'https://music.youtube.com/',
    Accept: '*/*',
  }

  if (rangeHeader) {
    const parsed = parseByteRange(rangeHeader, 0)
    if (!parsed.valid) {
      const notSatHeaders = new Headers()
      notSatHeaders.set('Content-Range', 'bytes */*')
      notSatHeaders.set('Accept-Ranges', 'bytes')
      return new Response(null, { status: 416, headers: notSatHeaders })
    }
    headers['Range'] = rangeHeader.trim()
  }

  try {
    const upstream = await safeProxyFetch(targetUrl, {
      headers,
      domainValidator: isAllowedStreamingDomain,
      signal: c.req.raw.signal,
      timeoutMs: 15000,
    })
    const responseHeaders = new Headers()

    responseHeaders.set('Access-Control-Allow-Origin', '*')
    responseHeaders.set('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Type')
    responseHeaders.set('Accept-Ranges', 'bytes')

    const contentType = upstream.headers.get('content-type')
    if (contentType) responseHeaders.set('Content-Type', contentType)

    const contentLength = upstream.headers.get('content-length')
    if (contentLength) responseHeaders.set('Content-Length', contentLength)

    const contentRange = upstream.headers.get('content-range')
    if (contentRange) responseHeaders.set('Content-Range', contentRange)

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    })
  } catch (err: unknown) {
    return c.text(`Proxy failed: ${err instanceof Error ? err.message : String(err)}`, 502)
  }
})
