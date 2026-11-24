/**
 * Canvas video resolution service.
 *
 * Responsibilities:
 * - Orchestrates multi-provider canvas video resolution across Tidal (ISRC lookup),
 *   Apple Music (editorial motion video), and Artist Video archives.
 * - Multi-tiered caching: in-memory LRU cache (200 entries) with positive (24h) and negative (2m) TTLs.
 * - In-flight coalescing: merges concurrent calls for the same track into a single resolution operation.
 * - Bounded timeouts (5000ms per resolution step) with cooperative AbortSignal cancellation support.
 * - Runtime schema validation via Zod for track query inputs and provider resolution payloads.
 * - Instrumentation of latency, provider breakdown, cache hit ratios, and failure reasons.
 */

import { z } from 'zod'
import type { Track } from '../../types/domain.ts'
import { AppleCanvas } from './providers/AppleCanvas.ts'
import { TidalCanvas } from './providers/TidalCanvas.ts'

// --- Runtime Schemas ---

export const canvasQuerySchema = z
  .object({
    id: z.string().optional(),
    videoId: z.string().optional(),
    title: z.string().trim().min(1, 'Track title must not be empty'),
    cleanTitle: z.string().optional(),
    artistName: z.string().optional().default(''),
    albumTitle: z.string().optional(),
    isrc: z.string().optional(),
  })
  .passthrough()

export type CanvasQueryInput = z.infer<typeof canvasQuerySchema>

export const canvasVideoResultSchema = z.object({
  provider: z.enum(['APPLE', 'TIDAL', 'ARTIST_VIDEO']),
  videoUrl: z.string().min(1),
  rawUrl: z.string().optional(),
})

export type CanvasVideoResult = z.infer<typeof canvasVideoResultSchema>

export const canvasTelemetryMetricsSchema = z.object({
  totalRequests: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
  networkRequests: z.number().int().nonnegative(),
  coalescedRequests: z.number().int().nonnegative(),
  providerHits: z.object({
    APPLE: z.number().int().nonnegative(),
    TIDAL: z.number().int().nonnegative(),
    ARTIST_VIDEO: z.number().int().nonnegative(),
  }),
  failuresByReason: z.record(z.string(), z.number().int().nonnegative()),
  avgLatencyMs: z.number().nonnegative(),
  lastLatencyMs: z.number().nonnegative(),
})

export type CanvasTelemetryMetrics = z.infer<typeof canvasTelemetryMetricsSchema>

export type CanvasStatus =
  | 'idle'
  | 'loading'
  | 'resolved'
  | 'empty'
  | 'stale'
  | 'offline'
  | 'error'

export interface CanvasCacheEntry {
  result: CanvasVideoResult | null
  cachedAt: number
  expiresAt: number
}

// Module-level telemetry metrics singleton
let canvasMetrics: CanvasTelemetryMetrics = {
  totalRequests: 0,
  cacheHits: 0,
  networkRequests: 0,
  coalescedRequests: 0,
  providerHits: {
    APPLE: 0,
    TIDAL: 0,
    ARTIST_VIDEO: 0,
  },
  failuresByReason: {},
  avgLatencyMs: 0,
  lastLatencyMs: 0,
}

export function getCanvasResolutionMetrics(): CanvasTelemetryMetrics {
  return {
    ...canvasMetrics,
    providerHits: { ...canvasMetrics.providerHits },
    failuresByReason: { ...canvasMetrics.failuresByReason },
  }
}

export function resetCanvasResolutionMetrics(): void {
  canvasMetrics = {
    totalRequests: 0,
    cacheHits: 0,
    networkRequests: 0,
    coalescedRequests: 0,
    providerHits: {
      APPLE: 0,
      TIDAL: 0,
      ARTIST_VIDEO: 0,
    },
    failuresByReason: {},
    avgLatencyMs: 0,
    lastLatencyMs: 0,
  }
}

export class CanvasManager {
  public static readonly POSITIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
  public static readonly NEGATIVE_CACHE_TTL_MS = 2 * 60 * 1000 // 2 minutes
  public static readonly CACHE_MAX = 200
  public static readonly RESOLVER_TIMEOUT_MS = 5000 // 5 seconds bounded timeout per provider

  private static instance: CanvasManager | null = null
  private cache = new Map<string, CanvasCacheEntry>()
  private inFlightResolutions = new Map<string, Promise<CanvasVideoResult | null>>()
  private currentAbortController: AbortController | null = null

  public static getInstance(): CanvasManager {
    if (!CanvasManager.instance) {
      CanvasManager.instance = new CanvasManager()
    }
    return CanvasManager.instance
  }

  public getCacheEntry(cacheKey: string): CanvasCacheEntry | undefined {
    return this.cache.get(cacheKey)
  }

  public setCacheEntry(cacheKey: string, entry: CanvasCacheEntry): void {
    this.cache.set(cacheKey, entry)
  }

  public cancelOngoingResolution(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }
  }

  public clearCache(): void {
    this.cache.clear()
    this.inFlightResolutions.clear()
  }

  public async resolveCanvasVideo(
    track: Track,
    externalSignal?: AbortSignal,
  ): Promise<CanvasVideoResult | null> {
    const startTime = performance.now()

    // 1. Runtime schema validation for input query
    const parsed = canvasQuerySchema.safeParse(track)
    if (!parsed.success) {
      this.recordFailure('malformed_input')
      return null
    }

    canvasMetrics.totalRequests++

    const trackKey = track.id || track.videoId || ''
    const cacheKey = `${trackKey}:${track.title}:${track.artistName}`

    // 2. Memory cache inspection
    const cached = this.cache.get(cacheKey)
    if (cached) {
      if (Date.now() < cached.expiresAt) {
        canvasMetrics.cacheHits++
        this.recordLatency(performance.now() - startTime)
        return cached.result
      }
      this.cache.delete(cacheKey)
    }

    // 3. In-flight coalescing
    const inFlight = this.inFlightResolutions.get(cacheKey)
    if (inFlight) {
      canvasMetrics.coalescedRequests++
      return inFlight
    }

    // 4. Cancel prior ongoing resolution on track switch
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }

    const abortController = new AbortController()
    this.currentAbortController = abortController

    const onExternalAbort = () => abortController.abort()
    if (externalSignal) {
      if (externalSignal.aborted) {
        abortController.abort()
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true })
      }
    }

    canvasMetrics.networkRequests++

    const resolutionPromise = (async (): Promise<CanvasVideoResult | null> => {
      const signal = abortController.signal
      const title = track.cleanTitle || track.title || ''
      const artist = track.artistName || ''
      const album = track.albumTitle || track.album?.title || undefined
      const isrc = track.isrc

      let result: CanvasVideoResult | null = null

      try {
        // 1. Tidal (ISRC matching)
        if (isrc && !signal.aborted) {
          try {
            const tidalCandidate = await this.fetchWithTimeout(
              (sig) => TidalCanvas.resolve(isrc, title, artist, sig),
              signal,
              CanvasManager.RESOLVER_TIMEOUT_MS,
            )
            if (tidalCandidate) {
              const validation = canvasVideoResultSchema.safeParse(tidalCandidate)
              if (validation.success) {
                result = validation.data
                canvasMetrics.providerHits.TIDAL++
              }
            }
          } catch {
            // Tidal resolution failed; continue cascade
          }
        }

        // 2. Apple Music Canvas
        if (!result && !signal.aborted) {
          try {
            const appleCandidate = await this.fetchWithTimeout(
              (sig) => AppleCanvas.resolve(title, artist, album, sig),
              signal,
              CanvasManager.RESOLVER_TIMEOUT_MS,
            )
            if (appleCandidate) {
              const validation = canvasVideoResultSchema.safeParse(appleCandidate)
              if (validation.success) {
                result = validation.data
                canvasMetrics.providerHits.APPLE++
              }
            }
          } catch {
            // Apple resolution failed; continue cascade
          }
        }

        // 3. Central resolver fallback (Artist Video / Tidal / Apple search)
        if (!result && !signal.aborted) {
          try {
            const origin =
              typeof window !== 'undefined' && window.location?.origin
                ? window.location.origin
                : 'http://localhost'
            const resolveUrl = new URL('/api/canvas/resolve', origin)
            resolveUrl.searchParams.set('title', title)
            resolveUrl.searchParams.set('artist', artist)
            if (album) resolveUrl.searchParams.set('album', album)
            if (isrc) resolveUrl.searchParams.set('isrc', isrc)

            const fallbackCandidate = await this.fetchWithTimeout(
              async (sig) => {
                const res = await fetch(resolveUrl.toString(), {
                  signal: sig,
                })
                if (!res.ok) return null
                const data = (await res.json()) as {
                  success?: boolean
                  provider?: 'APPLE' | 'TIDAL' | 'ARTIST_VIDEO'
                  videoUrl?: string
                  rawUrl?: string
                }
                if (data.success && data.videoUrl && data.provider) {
                  const resolvedItem: CanvasVideoResult = {
                    provider: data.provider,
                    videoUrl: data.videoUrl,
                  }
                  if (data.rawUrl) {
                    resolvedItem.rawUrl = data.rawUrl
                  }
                  return resolvedItem
                }
                return null
              },
              signal,
              CanvasManager.RESOLVER_TIMEOUT_MS,
            )

            if (fallbackCandidate) {
              const validation = canvasVideoResultSchema.safeParse(fallbackCandidate)
              if (validation.success) {
                result = validation.data
                canvasMetrics.providerHits[result.provider]++
              }
            }
          } catch {
            // Fallback failed
          }
        }

        if (signal.aborted) {
          this.recordFailure('aborted')
          return null
        }

        if (!result) {
          this.recordFailure('not_found')
        }

        // Memory cache update with bounded LRU eviction
        this.cache.set(cacheKey, {
          result,
          cachedAt: Date.now(),
          expiresAt:
            Date.now() +
            (result
              ? CanvasManager.POSITIVE_CACHE_TTL_MS
              : CanvasManager.NEGATIVE_CACHE_TTL_MS),
        })
        if (this.cache.size > CanvasManager.CACHE_MAX) {
          const oldest = this.cache.keys().next().value
          if (oldest !== undefined) this.cache.delete(oldest)
        }

        return result
      } catch {
        if (signal.aborted) {
          this.recordFailure('aborted')
        } else {
          this.recordFailure('network_error')
        }
        return null
      } finally {
        this.recordLatency(performance.now() - startTime)
        if (externalSignal) {
          externalSignal.removeEventListener('abort', onExternalAbort)
        }
        if (this.currentAbortController === abortController) {
          this.currentAbortController = null
        }
      }
    })().finally(() => {
      this.inFlightResolutions.delete(cacheKey)
    })

    this.inFlightResolutions.set(cacheKey, resolutionPromise)
    return resolutionPromise
  }

  private async fetchWithTimeout<T>(
    fetcher: (signal: AbortSignal) => Promise<T>,
    parentSignal: AbortSignal,
    timeoutMs: number,
  ): Promise<T | null> {
    const timeoutController = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timeoutController.abort(new Error('TIMEOUT'))
    }, timeoutMs)

    const onParentAbort = () => {
      timeoutController.abort(parentSignal.reason)
    }
    parentSignal.addEventListener('abort', onParentAbort, { once: true })

    try {
      return await fetcher(timeoutController.signal)
    } catch {
      if (timeoutController.signal.aborted && !parentSignal.aborted) {
        this.recordFailure('timeout')
      }
      return null
    } finally {
      if (timer) clearTimeout(timer)
      parentSignal.removeEventListener('abort', onParentAbort)
    }
  }

  private recordFailure(reason: string): void {
    canvasMetrics.failuresByReason[reason] =
      (canvasMetrics.failuresByReason[reason] || 0) + 1
  }

  private recordLatency(latencyMs: number): void {
    canvasMetrics.lastLatencyMs = latencyMs
    const n = canvasMetrics.totalRequests
    canvasMetrics.avgLatencyMs =
      n <= 1
        ? latencyMs
        : (canvasMetrics.avgLatencyMs * (n - 1) + latencyMs) / n
  }
}
