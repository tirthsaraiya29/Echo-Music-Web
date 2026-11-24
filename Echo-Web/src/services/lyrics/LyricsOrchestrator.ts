import type { Track } from '../../types/domain.ts'
import type { SynchronizedLyrics } from '../../types/lyrics.ts'
import { db } from '../db/echoDatabase.ts'
import { useEchoStore } from '../../stores/useEchoStore.ts'
import { BetterLyricsProvider } from './BetterLyricsProvider.ts'
import { LRCLIBProvider } from './LRCLIBProvider.ts'
import { KuGouProvider } from './KuGouProvider.ts'

// Prune target for the persistent cache; in-memory cache stays LRU-bounded separately.
const PERSISTENT_CACHE_MAX = 300

export type LyricsProviderKey = 'LRCLIB' | 'BETTER_LYRICS' | 'KUGOU'

export const PROVIDER_CASCADE: Record<LyricsProviderKey, LyricsProviderKey[]> = {
  LRCLIB: ['LRCLIB', 'BETTER_LYRICS', 'KUGOU'],
  BETTER_LYRICS: ['BETTER_LYRICS', 'LRCLIB', 'KUGOU'],
  KUGOU: ['KUGOU', 'LRCLIB', 'BETTER_LYRICS'],
}

export interface LyricsCacheEntry {
  lyrics: SynchronizedLyrics | null
  cachedAt: number
  expiresAt: number
}

export class LyricsOrchestrator {
  public static readonly POSITIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
  public static readonly NEGATIVE_CACHE_TTL_MS = 2 * 60 * 1000 // 2 minutes

  private static instance: LyricsOrchestrator | null = null
  private currentAbortController: AbortController | null = null
  // LRU-bounded (Map keeps insertion order)
  private static readonly CACHE_MAX = 200
  private cache = new Map<string, LyricsCacheEntry>()

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
    preferred: string = useEchoStore.getState().preferences.preferredLyricsProvider || 'LRCLIB',
  ): LyricsProviderKey[] {
    return PROVIDER_CASCADE[preferred as LyricsProviderKey] || PROVIDER_CASCADE.LRCLIB
  }

  public buildCacheKey(
    track: Track,
    preferred: string = useEchoStore.getState().preferences.preferredLyricsProvider || 'LRCLIB',
    romanize: boolean = Boolean(useEchoStore.getState().preferences.romanizeLyrics),
  ): string {
    const trackKey = track.id || track.videoId || ''
    return `${trackKey}:${track.title}:${track.artistName}:${preferred}:${romanize ? 'rom' : 'orig'}`
  }

  private cleanTitle(title: string): string {
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

  private cleanArtist(artist: string): string {
    return artist.split(/,|&|feat\.|ft\./i)[0]!.trim()
  }

  public async getLyrics(
    track: Track,
    externalSignal?: AbortSignal,
  ): Promise<SynchronizedLyrics | null> {
    const prefs = useEchoStore.getState().preferences
    const preferred = prefs.preferredLyricsProvider || 'LRCLIB'
    const preferRomanized = Boolean(prefs.romanizeLyrics)

    const cacheKey = this.buildCacheKey(track, preferred, preferRomanized)
    const cached = this.cache.get(cacheKey)
    if (cached) {
      if (Date.now() < cached.expiresAt) {
        return cached.lyrics
      }
      this.cache.delete(cacheKey)
    }

    // Persistent cache first, so a reload or offline session still gets lyrics.
    const trackId = track.videoId || track.id
    if (trackId && typeof indexedDB !== 'undefined') {
      const stored = await db.cachedLyrics.get(trackId)
      if (stored && stored.query === cacheKey) {
        this.cache.set(cacheKey, {
          lyrics: stored.lyrics,
          cachedAt: stored.fetchedAt || Date.now(),
          expiresAt: Date.now() + LyricsOrchestrator.POSITIVE_CACHE_TTL_MS,
        })
        this.pruneMemoryCache()
        return stored.lyrics
      }
    }

    // Cancel any ongoing fetch to avoid race conditions and memory leaks on rapid skips
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }

    const abortController = new AbortController()
    this.currentAbortController = abortController

    const onExternalAbort = () => abortController.abort()
    if (externalSignal) {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true })
    }

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
      const cascade = this.getProviderCascade(preferred)

      for (const provider of cascade) {
        if (lyrics || signal.aborted) break

        switch (provider) {
          case 'BETTER_LYRICS':
            lyrics = await BetterLyricsProvider.fetchLyrics(
              cleanTitle,
              cleanArtist,
              album,
              durationSeconds,
              signal,
            )
            break
          case 'LRCLIB':
            lyrics = await LRCLIBProvider.fetchLyrics(
              cleanTitle,
              cleanArtist,
              album,
              durationSeconds,
              signal,
              preferRomanized,
            )
            break
          case 'KUGOU':
            lyrics = await KuGouProvider.fetchLyrics(
              cleanTitle,
              cleanArtist,
              album,
              durationSeconds,
              signal,
            )
            break
        }
      }

      // Fallback to YouTube Captions
      if (!lyrics && !signal.aborted && (track.videoId || track.id)) {
        lyrics = await this.fetchYouTubeCaptions(track.videoId || track.id, signal)
      }

      if (!signal.aborted) {
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
        if (trackId && lyrics) {
          void this.persistLyrics(trackId, cacheKey, lyrics)
        }
      }

      return lyrics
    } catch {
      return null
    } finally {
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort)
      }
      if (this.currentAbortController === abortController) {
        this.currentAbortController = null
      }
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
  }

  private async persistLyrics(
    trackId: string,
    query: string,
    lyrics: SynchronizedLyrics,
  ): Promise<void> {
    if (typeof indexedDB === 'undefined') return
    try {
      await db.cachedLyrics.put({
        trackId,
        query,
        lyrics,
        provider: lyrics.provider,
        fetchedAt: Date.now(),
      })
      const count = await db.cachedLyrics.count()
      if (count > PERSISTENT_CACHE_MAX) {
        const stale = await db.cachedLyrics
          .orderBy('fetchedAt')
          .limit(count - PERSISTENT_CACHE_MAX)
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
}
