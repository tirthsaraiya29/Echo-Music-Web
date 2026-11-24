import { Hono } from 'hono'
import { z } from 'zod'
import type { Track } from '../../src/types/audio.ts'
import { buildClientContext, fetchVisitorData } from '../utils/potoken.ts'

export const radioRouter = new Hono()

export const radioContinuationQuerySchema = z
  .object({
    videoId: z.string().min(1).max(64).optional(),
    continuation: z.string().min(1).max(1024).optional(),
    gl: z.string().regex(/^[A-Za-z]{2}$/).default('US'),
    hl: z.string().regex(/^[A-Za-z]{2}(-[A-Za-z]{2})?$/).default('en'),
    explicit: z.enum(['true', 'false']).default('true'),
  })
  .refine((data) => Boolean(data.videoId || data.continuation), {
    message: 'videoId or continuation parameter is required',
  })

export const radioResponseSchema = z.object({
  tracks: z.array(z.record(z.string(), z.unknown())),
  continuationToken: z.string().optional(),
})

export interface RadioMetrics {
  requestsTotal: number
  successTotal: number
  failuresTotal: number
  tracksFetched: number
  continuationsUsed: number
  inFlightDeduplicated: number
  lastError: string | null
}

const radioMetrics: RadioMetrics = {
  requestsTotal: 0,
  successTotal: 0,
  failuresTotal: 0,
  tracksFetched: 0,
  continuationsUsed: 0,
  inFlightDeduplicated: 0,
  lastError: null,
}

export function getRadioMetrics(): RadioMetrics {
  return { ...radioMetrics }
}

export function resetRadioMetrics(): void {
  radioMetrics.requestsTotal = 0
  radioMetrics.successTotal = 0
  radioMetrics.failuresTotal = 0
  radioMetrics.tracksFetched = 0
  radioMetrics.continuationsUsed = 0
  radioMetrics.inFlightDeduplicated = 0
  radioMetrics.lastError = null
}

const inFlightRadio = new Map<string, Promise<{ tracks: Track[]; continuationToken?: string }>>()

export function resolveRadioContinuation(
  videoId?: string,
  continuationToken?: string,
  gl = 'US',
  hl = 'en',
  explicitAllowed = true,
  signal?: AbortSignal,
): Promise<{ tracks: Track[]; continuationToken?: string }> {
  const cacheKey = `${videoId || ''}:${continuationToken || ''}:${gl}:${hl}:${explicitAllowed}`
  const existing = inFlightRadio.get(cacheKey)
  if (existing) {
    radioMetrics.inFlightDeduplicated++
    return existing
  }

  const p = (async () => {
    try {
      const res = await fetchInnerTubeRadio(videoId, continuationToken, gl, hl, explicitAllowed, signal)
      radioMetrics.successTotal++
      radioMetrics.tracksFetched += res.tracks.length
      if (continuationToken) radioMetrics.continuationsUsed++
      return res
    } catch (err) {
      radioMetrics.failuresTotal++
      radioMetrics.lastError = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      inFlightRadio.delete(cacheKey)
    }
  })()

  inFlightRadio.set(cacheKey, p)
  return p
}

radioRouter.get('/continuation', async (c) => {
  radioMetrics.requestsTotal++
  const query = {
    videoId: c.req.query('videoId'),
    continuation: c.req.query('continuation'),
    gl: c.req.query('gl') || 'US',
    hl: c.req.query('hl') || 'en',
    explicit: c.req.query('explicit') || 'true',
  }

  const parsedQuery = radioContinuationQuerySchema.safeParse(query)
  if (!parsedQuery.success) {
    return c.json(
      {
        error: 'Invalid radio continuation parameters',
        issues: parsedQuery.error.issues,
      },
      400,
    )
  }

  const { videoId, continuation: continuationToken, gl, hl, explicit } = parsedQuery.data
  const explicitAllowed = explicit !== 'false'

  // Timeout controller with 10s timeout
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), 10000)

  // Listen for client disconnect
  const clientSignal = c.req.raw.signal
  const abortListener = () => timeoutController.abort()
  if (clientSignal) {
    clientSignal.addEventListener('abort', abortListener, { once: true })
  }

  try {
    const radioData = await resolveRadioContinuation(
      videoId,
      continuationToken,
      gl,
      hl,
      explicitAllowed,
      timeoutController.signal,
    )
    return c.json(radioData)
  } catch (err: unknown) {
    if (clientSignal?.aborted) {
      return new Response(JSON.stringify({ error: 'Client aborted request' }), {
        status: 499,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return c.json(
      {
        error: 'Failed to fetch radio continuation',
        message: err instanceof Error ? err.message : String(err),
      },
      502,
    )
  } finally {
    clearTimeout(timer)
    if (clientSignal) {
      clientSignal.removeEventListener('abort', abortListener)
    }
  }
})

radioRouter.get('/telemetry', (c) => {
  return c.json(getRadioMetrics())
})

interface RunItem {
  text?: string
  navigationEndpoint?: {
    browseEndpoint?: {
      browseId?: string
    }
  }
}

interface InnerTubeItem {
  playlistPanelVideoRenderer?: {
    videoId?: string
    title?: { runs?: Array<{ text?: string }> }
    longBylineText?: {
      runs?: RunItem[]
    }
    shortBylineText?: {
      runs?: RunItem[]
    }
    thumbnail?: { thumbnails?: Array<{ url?: string }> }
    lengthText?: { runs?: Array<{ text?: string }> }
  }
}

async function fetchInnerTubeRadio(
  videoId?: string,
  continuationToken?: string,
  gl = 'US',
  hl = 'en',
  explicitAllowed = true,
  signal?: AbortSignal,
): Promise<{ tracks: Track[]; continuationToken?: string }> {
  if (signal?.aborted) {
    throw new Error('Radio request aborted')
  }

  const visitorData = await fetchVisitorData()
  const context = buildClientContext('WEB_REMIX', visitorData, undefined, gl, hl)

  const payload: Record<string, unknown> = {
    context,
  }

  if (continuationToken) {
    payload['continuation'] = continuationToken
  } else if (videoId) {
    payload['videoId'] = videoId
    payload['playlistId'] = `RDAMVM${videoId}`
    payload['isAudioOnly'] = true
  }

  const fetchOptions: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://music.youtube.com',
      Referer: 'https://music.youtube.com/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'X-YouTube-Client-Name': '67',
      'X-YouTube-Client-Version': '1.20240901.01.00',
    },
    body: JSON.stringify(payload),
  }
  if (signal) {
    fetchOptions.signal = signal
  }

  const res = await fetch('https://music.youtube.com/youtubei/v1/next', fetchOptions)

  if (!res.ok) {
    throw new Error(`InnerTube next returned HTTP ${res.status}`)
  }

  const data = (await res.json()) as Record<string, unknown>
  const tracks: Track[] = []

  const rawContents = extractPlaylistPanelContents(data)

  if (Array.isArray(rawContents)) {
    for (const item of rawContents as InnerTubeItem[]) {
      const renderer = item.playlistPanelVideoRenderer
      if (!renderer?.videoId) continue

      const trackVideoId = renderer.videoId
      const title = renderer.title?.runs?.[0]?.text || 'Unknown Track'

      let artistName = 'Unknown Artist'
      let artistId = `artist-${trackVideoId}`
      let albumTitle = 'Single'
      const albumId = `album-${trackVideoId}`

      const bylineRuns = renderer.longBylineText?.runs || renderer.shortBylineText?.runs
      if (Array.isArray(bylineRuns) && bylineRuns.length > 0) {
        const firstRun = bylineRuns[0]
        if (firstRun?.text) {
          artistName = firstRun.text
          const browseId = firstRun.navigationEndpoint?.browseEndpoint?.browseId
          if (browseId) artistId = browseId
        }
        if (bylineRuns.length >= 3 && bylineRuns[2]?.text) {
          albumTitle = bylineRuns[2].text
        }
      }

      const thumbnails = renderer.thumbnail?.thumbnails
      const artwork =
        thumbnails && thumbnails.length > 0 ? thumbnails[thumbnails.length - 1]?.url || '' : ''

      const lengthStr = renderer.lengthText?.runs?.[0]?.text
      const durationMs = parseTimeStringToMs(lengthStr)

      const rawBadges = (renderer as Record<string, unknown>)['badges'] as
        | Array<{ musicInlineBadgeRenderer?: { icon?: { iconType?: string } } }>
        | undefined
      const isExplicit = Boolean(
        rawBadges?.some((b) =>
          b.musicInlineBadgeRenderer?.icon?.iconType?.toLowerCase().includes('explicit'),
        ) || /\b(explicit|\(explicit\)|\[explicit\])\b/i.test(title),
      )

      tracks.push({
        id: trackVideoId,
        title,
        artistId,
        artistName,
        albumId,
        albumTitle,
        albumImage: artwork,
        durationMs,
        artwork,
        explicit: isExplicit,
        playCount: 0,
        videoId: trackVideoId,
      })
    }
  }

  const nextContinuationToken = extractNextContinuationToken(data)

  const finalTracks = explicitAllowed ? tracks : tracks.filter((t) => !t.explicit)
  const result: { tracks: Track[]; continuationToken?: string } = {
    tracks: finalTracks,
  }
  if (nextContinuationToken) {
    result.continuationToken = nextContinuationToken
  }

  return result
}

function extractPlaylistPanelContents(data: Record<string, unknown>): unknown[] | null {
  const contContents = data['continuationContents'] as Record<string, unknown> | undefined
  if (contContents) {
    const playlistCont = contContents['playlistPanelContinuation'] as
      Record<string, unknown> | undefined
    if (playlistCont?.['contents']) {
      return playlistCont['contents'] as unknown[]
    }
  }

  const contents = data['contents'] as Record<string, unknown> | undefined
  const singleCol = contents?.['singleColumnMusicWatchNextResultsRenderer'] as
    Record<string, unknown> | undefined
  const tabbed = singleCol?.['tabbedRenderer'] as Record<string, unknown> | undefined
  const watchNext = tabbed?.['watchNextTabbedResultsRenderer'] as
    Record<string, unknown> | undefined
  const tabs = watchNext?.['tabs'] as Array<Record<string, unknown>> | undefined
  const firstTab = tabs?.[0]?.['tabRenderer'] as Record<string, unknown> | undefined
  const tabContent = firstTab?.['content'] as Record<string, unknown> | undefined
  const queue = tabContent?.['musicQueueRenderer'] as Record<string, unknown> | undefined
  const queueContent = queue?.['content'] as Record<string, unknown> | undefined
  const playlistPanel = queueContent?.['playlistPanelRenderer'] as
    Record<string, unknown> | undefined

  if (playlistPanel?.['contents']) {
    return playlistPanel['contents'] as unknown[]
  }

  return null
}

function extractNextContinuationToken(data: Record<string, unknown>): string | undefined {
  const contContents = data['continuationContents'] as Record<string, unknown> | undefined
  const playlistCont = contContents?.['playlistPanelContinuation'] as
    Record<string, unknown> | undefined
  const continuations = playlistCont?.['continuations'] as
    Array<Record<string, unknown>> | undefined
  const nextContData = continuations?.[0]?.['nextRadioContinuationData'] as
    Record<string, unknown> | undefined
  if (typeof nextContData?.['continuation'] === 'string') {
    return nextContData['continuation']
  }
  return undefined
}

export function parseTimeStringToMs(timeStr?: string, fallback = 180000): number {
  const safeFallback = Math.max(0, Math.min(86400000, Number.isFinite(fallback) ? Math.round(fallback) : 180000))
  if (!timeStr || typeof timeStr !== 'string') return safeFallback

  const trimmed = timeStr.trim()
  if (!trimmed) return safeFallback

  const parts = trimmed.split(':').map((p) => Number.parseInt(p, 10))
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return safeFallback

  let ms = safeFallback
  if (parts.length === 1) {
    ms = (parts[0] ?? 180) * 1000
  } else if (parts.length === 2) {
    const mins = parts[0] ?? 0
    const secs = parts[1] ?? 0
    ms = (mins * 60 + secs) * 1000
  } else if (parts.length === 3) {
    const hrs = parts[0] ?? 0
    const mins = parts[1] ?? 0
    const secs = parts[2] ?? 0
    ms = (hrs * 3600 + mins * 60 + secs) * 1000
  }

  if (ms < 0 || ms > 86400000) return safeFallback
  return ms
}
