/**
 * Lyrics provider orchestration service.
 *
 * Responsibilities:
 * - Coordinates cascading retrieval of synchronized and unsynchronized lyrics across
 *   multiple providers (LRCLIB, BetterLyrics, KuGou, and YouTube Captions fallback).
 * - Multi-tiered caching: in-memory LRU cache (200 entries) with positive (24h) and negative (2m) TTLs,
 *   and persistent IndexedDB cache (300 entries) for offline resilience.
 * - Runtime schema validation via Zod for incoming track queries, provider lyric payloads, and metrics.
 * - In-flight deduplication / coalescing: prevents concurrent duplicate fetches for the same query.
 * - Bounded timeouts (6000ms per provider) and graceful cascade progression on network failure.
 * - Cooperative lifecycle cancellation via internal AbortControllers and external AbortSignals.
 * - Instrumentation of latency, cache hit ratios, provider hit distributions, and failure reasons.
 */

import { z } from 'zod'
import type { Track } from '../../types/domain.ts'
import type { SynchronizedLyrics, LyricsProviderType } from '../../types/lyrics.ts'
import { db } from '../db/echoDatabase.ts'
import { useEchoStore } from '../../stores/useEchoStore.ts'
import { BetterLyricsProvider } from './BetterLyricsProvider.ts'
import { LRCLIBProvider } from './LRCLIBProvider.ts'
import { KuGouProvider } from './KuGouProvider.ts'
import { LyricsPlusProvider } from './LyricsPlusProvider.ts'

// --- Runtime Schemas ---

export const lyricsQuerySchema = z
  .object({
    id: z.string().optional(),
    videoId: z.string().optional(),
    title: z.string().trim().min(1, 'Track title must not be empty'),
    cleanTitle: z.string().optional(),
    artistName: z.string().optional().default(''),
    albumTitle: z.string().optional(),
    durationSeconds: z.number().nonnegative().optional(),
    durationMs: z.number().nonnegative().optional(),
  })
  .passthrough()

export type LyricsQueryInput = z.infer<typeof lyricsQuerySchema>

export const lyricWordSchema = z.object({
  text: z.string(),
  startTimeMs: z.number().nonnegative(),
  endTimeMs: z.number().nonnegative(),
})

export const lyricLineSchema = z.object({
  startTimeMs: z.number().nonnegative(),
  endTimeMs: z.number().nonnegative().optional(),
  text: z.string(),
  translatedText: z.string().optional(),
  words: z.array(lyricWordSchema).optional(),
  agent: z.string().optional(),
  isBackground: z.boolean().optional(),
})

export const synchronizedLyricsSchema = z.object({
  provider: z.enum(['BETTER_LYRICS', 'LRCLIB', 'KUGOU', 'YOUTUBE', 'LYRICS_PLUS']),
  isSynced: z.boolean(),
  isWordSynced: z.boolean(),
  lines: z.array(lyricLineSchema),
})

export const cachedLyricsPayloadSchema = z.object({
  trackId: z.string().min(1),
  query: z.string().min(1),
  lyrics: synchronizedLyricsSchema,
  provider: z.string(),
  fetchedAt: z.number().nonnegative(),
})

export const lyricsProviderOrderSchema = z.array(
  z.enum(['LRCLIB', 'BETTER_LYRICS', 'KUGOU', 'LYRICS_PLUS']),
)

export function serializeLyricsProviderOrder(order: LyricsProviderKey[]): string {
  return order.join(',')
}

export function deserializeLyricsProviderOrder(orderStr: string): LyricsProviderKey[] {
  if (!orderStr || typeof orderStr !== 'string') {
    return ['LRCLIB', 'LYRICS_PLUS', 'BETTER_LYRICS', 'KUGOU']
  }
  const validKeys: LyricsProviderKey[] = ['LRCLIB', 'LYRICS_PLUS', 'BETTER_LYRICS', 'KUGOU']
  const parsed = orderStr
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is LyricsProviderKey => validKeys.includes(s as LyricsProviderKey))
  const distinct = Array.from(new Set(parsed))
  return [...distinct, ...validKeys.filter((k) => !distinct.includes(k))]
}

export const lyricsOrchestratorMetricsSchema = z.object({
  totalRequests: z.number().int().nonnegative(),
  memoryCacheHits: z.number().int().nonnegative(),
  persistentCacheHits: z.number().int().nonnegative(),
  networkRequests: z.number().int().nonnegative(),
  providerHits: z.object({
    BETTER_LYRICS: z.number().int().nonnegative(),
    LRCLIB: z.number().int().nonnegative(),
    KUGOU: z.number().int().nonnegative(),
    YOUTUBE: z.number().int().nonnegative(),
    LYRICS_PLUS: z.number().int().nonnegative().optional(),
  }),
  coalescedRequests: z.number().int().nonnegative(),
  failuresByReason: z.record(z.string(), z.number().int().nonnegative()),
  customOrderUsedCount: z.number().int().nonnegative().optional(),
  orderReorderCount: z.number().int().nonnegative().optional(),
  avgLatencyMs: z.number().nonnegative(),
  lastLatencyMs: z.number().nonnegative(),
})

export type LyricsOrchestratorMetrics = z.infer<typeof lyricsOrchestratorMetricsSchema>

export type LyricsStatus =
  | 'idle'
  | 'loading'
  | 'resolved'
  | 'empty'
  | 'stale'
  | 'offline'
  | 'error'

export type LyricsProviderKey = 'LRCLIB' | 'BETTER_LYRICS' | 'KUGOU' | 'LYRICS_PLUS'

export const PROVIDER_CASCADE: Record<LyricsProviderKey, LyricsProviderKey[]> = {
  LRCLIB: ['LRCLIB', 'LYRICS_PLUS', 'BETTER_LYRICS', 'KUGOU'],
  LYRICS_PLUS: ['LYRICS_PLUS', 'LRCLIB', 'BETTER_LYRICS', 'KUGOU'],
  BETTER_LYRICS: ['BETTER_LYRICS', 'LYRICS_PLUS', 'LRCLIB', 'KUGOU'],
  KUGOU: ['KUGOU', 'LYRICS_PLUS', 'LRCLIB', 'BETTER_LYRICS'],
}

export interface LyricsCacheEntry {
  lyrics: SynchronizedLyrics | null
  cachedAt: number
  expiresAt: number
}

// Module-level metrics singleton
let orchestratorMetrics: LyricsOrchestratorMetrics = {
  totalRequests: 0,
  memoryCacheHits: 0,
  persistentCacheHits: 0,
  networkRequests: 0,
  providerHits: {
    BETTER_LYRICS: 0,
    LRCLIB: 0,
    KUGOU: 0,
    YOUTUBE: 0,
    LYRICS_PLUS: 0,
  },
  coalescedRequests: 0,
  failuresByReason: {},
  customOrderUsedCount: 0,
  orderReorderCount: 0,
  avgLatencyMs: 0,
  lastLatencyMs: 0,
}

export function recordProviderReorder(): void {
  orchestratorMetrics.orderReorderCount = (orchestratorMetrics.orderReorderCount || 0) + 1
}

export function getLyricsOrchestratorMetrics(): LyricsOrchestratorMetrics {
  return {
    ...orchestratorMetrics,
    providerHits: { ...orchestratorMetrics.providerHits },
    failuresByReason: { ...orchestratorMetrics.failuresByReason },
  }
}

export function resetLyricsOrchestratorMetrics(): void {
  orchestratorMetrics = {
    totalRequests: 0,
    memoryCacheHits: 0,
    persistentCacheHits: 0,
    networkRequests: 0,
    providerHits: {
      BETTER_LYRICS: 0,
      LRCLIB: 0,
      KUGOU: 0,
      YOUTUBE: 0,
      LYRICS_PLUS: 0,
    },
    coalescedRequests: 0,
    failuresByReason: {},
    customOrderUsedCount: 0,
    orderReorderCount: 0,
    avgLatencyMs: 0,
    lastLatencyMs: 0,
  }
}

export class LyricsOrchestrator {
  public static readonly POSITIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
  public static readonly NEGATIVE_CACHE_TTL_MS = 2 * 60 * 1000 // 2 minutes
  public static readonly CACHE_MAX = 200
  public static readonly PERSISTENT_CACHE_MAX = 300
  public static readonly PROVIDER_TIMEOUT_MS = 6000 // 6 seconds bounded timeout per provider

  private static instance: LyricsOrchestrator | null = null
  private currentAbortController: AbortController | null = null
  private cache = new Map<string, LyricsCacheEntry>()
  private inFlightRequests = new Map<string, Promise<SynchronizedLyrics | null>>()

  public static getInstance(): LyricsOrchestrator {
    if (!LyricsOrchestrator.instance) {
      LyricsOrchestrator.instance = new LyricsOrchestrator()
    }
    return LyricsOrchestrator.instance
  }

  public getCacheEntry(cacheKey: string): LyricsCacheEntry | undefined {
    return this.cache.get(cacheKey)
  }

  public setCacheEntry(cacheKey: string, entry: LyricsCacheEntry): void {
    this.cache.set(cacheKey, entry)
  }

  public getProviderCascade(
    preferred?: string,
    customOrder?: LyricsProviderKey[],
  ): LyricsProviderKey[] {
    const defaultPreferred = useEchoStore.getState().preferences.preferredLyricsProvider || 'LRCLIB'
    const actualPreferred = preferred || defaultPreferred

    if (customOrder && customOrder.length > 0) {
      const validKeys: LyricsProviderKey[] = ['LRCLIB', 'LYRICS_PLUS', 'BETTER_LYRICS', 'KUGOU']
      const sanitized = customOrder.filter((k) => validKeys.includes(k))
      const distinct = Array.from(new Set(sanitized))
      return [...distinct, ...validKeys.filter((k) => !distinct.includes(k))]
    }

    const storeOrder = useEchoStore.getState().preferences.lyricsProviderOrder
    if (storeOrder && storeOrder.length > 0 && (!preferred || preferred === defaultPreferred)) {
      const validKeys: LyricsProviderKey[] = ['LRCLIB', 'LYRICS_PLUS', 'BETTER_LYRICS', 'KUGOU']
      const sanitized = storeOrder.filter((k) => validKeys.includes(k))
      const distinct = Array.from(new Set(sanitized))
      return [...distinct, ...validKeys.filter((k) => !distinct.includes(k))]
    }

    return PROVIDER_CASCADE[actualPreferred as LyricsProviderKey] || PROVIDER_CASCADE.LRCLIB
  }

  public buildCacheKey(
    track: Track,
    preferred: string = useEchoStore.getState().preferences.preferredLyricsProvider || 'LRCLIB',
    romanize: boolean = Boolean(useEchoStore.getState().preferences.romanizeLyrics),
  ): string {
    const trackKey = track.id || track.videoId || ''
    return `${trackKey}:${track.title}:${track.artistName}:${preferred}:${romanize ? 'rom' : 'orig'}`
  }

  public cancelOngoingFetch(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }
  }

  public cleanTitle(title: string): string {
    return title
      .replace(/\(feat\..*?\)/gi, '')
      .replace(/\[feat\..*?\]/gi, '')
      .replace(/\(ft\..*?\)/gi, '')
      .replace(/\[ft\..*?\]/gi, '')
      .replace(/\(official.*?\)/gi, '')
      .replace(/\[official.*?\]/gi, '')
      .replace(/\(audio.*?\)/gi, '')
      .replace(/\[audio.*?\]/gi, '')
      .replace(/\(lyrics.*?\)/gi, '')
      .replace(/\[lyrics.*?\]/gi, '')
      .replace(/\(video.*?\)/gi, '')
      .replace(/\[video.*?\]/gi, '')
      .replace(/\(remastered.*?\)/gi, '')
      .replace(/\[remastered.*?\]/gi, '')
      .trim()
  }

  public cleanArtist(artist: string): string {
    return artist.split(/,|&|feat\.|ft\./i)[0]!.trim()
  }

  /**
   * Retrieves lyrics for the specified track with cascade resolution, multi-tier caching,
   * schema validation, in-flight coalescing, and cancellation support.
   */
  public async getLyrics(
    track: Track,
    externalSignal?: AbortSignal,
  ): Promise<SynchronizedLyrics | null> {
    const startTime = performance.now()

    // 1. Runtime schema validation for input query
    const parsed = lyricsQuerySchema.safeParse(track)
    if (!parsed.success) {
      this.recordFailure('malformed_input')
      return null
    }

    orchestratorMetrics.totalRequests++

    const prefs = useEchoStore.getState().preferences
    const preferred = prefs.preferredLyricsProvider || 'LRCLIB'
    const preferRomanized = Boolean(prefs.romanizeLyrics)

    const cacheKey = this.buildCacheKey(track, preferred, preferRomanized)

    // 2. Memory cache inspection
    const cached = this.cache.get(cacheKey)
    if (cached) {
      if (Date.now() < cached.expiresAt) {
        orchestratorMetrics.memoryCacheHits++
        this.recordLatency(performance.now() - startTime)
        return cached.lyrics
      }
      this.cache.delete(cacheKey)
    }

    // 3. Persistent cache inspection
    const trackId = track.videoId || track.id
    if (trackId && typeof indexedDB !== 'undefined') {
      try {
        const stored = await db.cachedLyrics.get(trackId)
        if (stored && stored.query === cacheKey) {
          const validStored = synchronizedLyricsSchema.safeParse(stored.lyrics)
          if (validStored.success) {
            this.cache.set(cacheKey, {
              lyrics: validStored.data,
              cachedAt: stored.fetchedAt || Date.now(),
              expiresAt: Date.now() + LyricsOrchestrator.POSITIVE_CACHE_TTL_MS,
            })
            this.pruneMemoryCache()
            orchestratorMetrics.persistentCacheHits++
            this.recordLatency(performance.now() - startTime)
            return validStored.data
          }
        }
      } catch {
        // Non-fatal IndexedDB read error
      }
    }

    // 4. In-flight request deduplication / coalescing
    const inFlight = this.inFlightRequests.get(cacheKey)
    if (inFlight) {
      orchestratorMetrics.coalescedRequests++
      return inFlight
    }

    // 5. Cancel any prior ongoing request to prevent stale racing on rapid track skips
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

    orchestratorMetrics.networkRequests++

    const fetchPromise = (async (): Promise<SynchronizedLyrics | null> => {
      const signal = abortController.signal
      const rawTitle = track.cleanTitle || track.title || ''
      const cleanTitle = this.cleanTitle(rawTitle)
      const rawArtist = track.artistName || ''
      const cleanArtist = this.cleanArtist(rawArtist)
      const album = track.albumTitle || track.album?.title || undefined
      const durationSeconds =
        track.durationSeconds ||
        (track.durationMs && track.durationMs > 0 ? track.durationMs / 1000 : undefined)

      let lyrics: SynchronizedLyrics | null = null

      try {
        const customOrder = prefs.lyricsProviderOrder
        if (customOrder && customOrder.length > 0) {
          orchestratorMetrics.customOrderUsedCount =
            (orchestratorMetrics.customOrderUsedCount || 0) + 1
        }
        const cascade = this.getProviderCascade(preferred, customOrder)

        for (const provider of cascade) {
          if (lyrics || signal.aborted) break

          try {
            let candidate: SynchronizedLyrics | null = null
            switch (provider) {
              case 'BETTER_LYRICS':
                candidate = await this.fetchWithTimeout(
                  (sig) =>
                    BetterLyricsProvider.fetchLyrics(
                      cleanTitle,
                      cleanArtist,
                      album,
                      durationSeconds,
                      sig,
                    ),
                  signal,
                  LyricsOrchestrator.PROVIDER_TIMEOUT_MS,
                )
                break
              case 'LRCLIB':
                candidate = await this.fetchWithTimeout(
                  (sig) =>
                    LRCLIBProvider.fetchLyrics(
                      cleanTitle,
                      cleanArtist,
                      album,
                      durationSeconds,
                      sig,
                      preferRomanized,
                    ),
                  signal,
                  LyricsOrchestrator.PROVIDER_TIMEOUT_MS,
                )
                break
              case 'KUGOU':
                candidate = await this.fetchWithTimeout(
                  (sig) =>
                    KuGouProvider.fetchLyrics(
                      cleanTitle,
                      cleanArtist,
                      album,
                      durationSeconds,
                      sig,
                    ),
                  signal,
                  LyricsOrchestrator.PROVIDER_TIMEOUT_MS,
                )
                break
              case 'LYRICS_PLUS':
                candidate = await this.fetchWithTimeout(
                  (sig) =>
                    LyricsPlusProvider.fetchLyrics(
                      cleanTitle,
                      cleanArtist,
                      album,
                      durationSeconds,
                      track.videoId || track.id,
                      sig,
                    ),
                  signal,
                  LyricsOrchestrator.PROVIDER_TIMEOUT_MS,
                )
                break
            }

            if (candidate) {
              const validation = synchronizedLyricsSchema.safeParse(candidate)
              if (validation.success) {
                lyrics = validation.data
                orchestratorMetrics.providerHits[provider] =
                  (orchestratorMetrics.providerHits[provider] || 0) + 1
              }
            }
          } catch {
            // Provider failed or timed out; continue cascade
          }
        }

        // Fallback to YouTube Captions
        if (!lyrics && !signal.aborted && (track.videoId || track.id)) {
          try {
            const ytCandidate = await this.fetchWithTimeout(
              (sig) => this.fetchYouTubeCaptions(track.videoId || track.id!, sig),
              signal,
              LyricsOrchestrator.PROVIDER_TIMEOUT_MS,
            )
            if (ytCandidate) {
              const validation = synchronizedLyricsSchema.safeParse(ytCandidate)
              if (validation.success) {
                lyrics = validation.data
                orchestratorMetrics.providerHits.YOUTUBE =
                  (orchestratorMetrics.providerHits.YOUTUBE || 0) + 1
              }
            }
          } catch {
            // YouTube caption fallback failed
          }
        }

        if (signal.aborted) {
          this.recordFailure('aborted')
          return null
        }

        if (!lyrics) {
          this.recordFailure('not_found')
        }

        // Cache resolution in memory
        this.cache.set(cacheKey, {
          lyrics,
          cachedAt: Date.now(),
          expiresAt:
            Date.now() +
            (lyrics
              ? LyricsOrchestrator.POSITIVE_CACHE_TTL_MS
              : LyricsOrchestrator.NEGATIVE_CACHE_TTL_MS),
        })
        this.pruneMemoryCache()

        // Persist positive results in IndexedDB
        if (trackId && lyrics) {
          void this.persistLyrics(trackId, cacheKey, lyrics)
        }

        return lyrics
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
      this.inFlightRequests.delete(cacheKey)
    })

    this.inFlightRequests.set(cacheKey, fetchPromise)
    return fetchPromise
  }

  /**
   * Executes a provider fetch operation bounded by a specified timeout.
   */
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

  private async fetchYouTubeCaptions(
    videoId: string,
    signal?: AbortSignal,
  ): Promise<SynchronizedLyrics | null> {
    try {
      const origin =
        typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : 'http://localhost'
      const url = new URL('/api/lyrics/youtube', origin)
      url.searchParams.set('videoId', videoId)
      const res = await fetch(url.toString(), {
        ...(signal ? { signal } : {}),
      })
      if (!res.ok) return null
      const data = (await res.json()) as { success?: boolean; lyrics?: SynchronizedLyrics }
      if (data.success && data.lyrics && data.lyrics.lines.length > 0) {
        return data.lyrics
      }
      return null
    } catch {
      return null
    }
  }

  public clearCache(): void {
    this.cache.clear()
    this.inFlightRequests.clear()
  }

  private async persistLyrics(
    trackId: string,
    query: string,
    lyrics: SynchronizedLyrics,
  ): Promise<void> {
    if (typeof indexedDB === 'undefined') return
    try {
      const payload = {
        trackId,
        query,
        lyrics,
        provider: lyrics.provider as LyricsProviderType,
        fetchedAt: Date.now(),
      }
      const parsed = cachedLyricsPayloadSchema.safeParse(payload)
      if (!parsed.success) return

      await db.cachedLyrics.put(payload)
      const count = await db.cachedLyrics.count()
      if (count > LyricsOrchestrator.PERSISTENT_CACHE_MAX) {
        const stale = await db.cachedLyrics
          .orderBy('fetchedAt')
          .limit(count - LyricsOrchestrator.PERSISTENT_CACHE_MAX)
          .toArray()
        await db.cachedLyrics.bulkDelete(stale.map((s) => s.trackId))
      }
    } catch {
      // Cache write failure is non-fatal
    }
  }

  private pruneMemoryCache(): void {
    if (this.cache.size > LyricsOrchestrator.CACHE_MAX) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
  }

  private recordFailure(reason: string): void {
    orchestratorMetrics.failuresByReason[reason] =
      (orchestratorMetrics.failuresByReason[reason] || 0) + 1
  }

  private recordLatency(latencyMs: number): void {
    orchestratorMetrics.lastLatencyMs = latencyMs
    const n = orchestratorMetrics.totalRequests
    orchestratorMetrics.avgLatencyMs =
      n <= 1
        ? latencyMs
        : (orchestratorMetrics.avgLatencyMs * (n - 1) + latencyMs) / n
  }
}
