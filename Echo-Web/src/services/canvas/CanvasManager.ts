import type { Track } from '../../types/domain.ts'
import type { CanvasVideoResult } from './providers/AppleCanvas.ts'
import { AppleCanvas } from './providers/AppleCanvas.ts'
import { TidalCanvas } from './providers/TidalCanvas.ts'

export interface CanvasCacheEntry {
  result: CanvasVideoResult | null
  cachedAt: number
  expiresAt: number
}

export class CanvasManager {
  public static readonly POSITIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
  public static readonly NEGATIVE_CACHE_TTL_MS = 2 * 60 * 1000 // 2 minutes

  private static instance: CanvasManager | null = null
  // LRU-bounded (Map keeps insertion order)
  private static readonly CACHE_MAX = 200
  private cache = new Map<string, CanvasCacheEntry>()
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

  public async resolveCanvasVideo(
    track: Track,
    externalSignal?: AbortSignal,
  ): Promise<CanvasVideoResult | null> {
    const cacheKey = `${track.id || track.videoId || ''}:${track.title}:${track.artistName}`
    const cached = this.cache.get(cacheKey)
    if (cached) {
      if (Date.now() < cached.expiresAt) {
        return cached.result
      }
      this.cache.delete(cacheKey)
    }

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
    const title = track.cleanTitle || track.title || ''
    const artist = track.artistName || ''
    const album = track.albumTitle || track.album?.title || undefined
    const isrc = track.isrc

    let result: CanvasVideoResult | null = null

    try {
      // 1. Tidal (ISRC matching)
      if (isrc && !signal.aborted) {
        result = await TidalCanvas.resolve(isrc, title, artist, signal)
      }

      // 2. Apple Music Canvas
      if (!result && !signal.aborted) {
        result = await AppleCanvas.resolve(title, artist, album, signal)
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

          const res = await fetch(resolveUrl.toString(), {
            ...(signal ? { signal } : {}),
          })
          if (res.ok) {
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
              result = resolvedItem
            }
          }
        } catch {
          // Resolver fallback network or parsing failure is non-fatal
        }
      }

      if (!signal.aborted) {
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
      }

      return result
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

  public clearCache(): void {
    this.cache.clear()
  }
}
