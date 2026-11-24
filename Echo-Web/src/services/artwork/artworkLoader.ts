import {
  imageUrlSchema,
  recordArtworkMetric,
} from './artworkTypes.ts'

export class ArtworkLoader {
  private static instance: ArtworkLoader | null = null
  private inFlight = new Map<string, Promise<boolean>>()
  private cache = new Map<string, boolean>()
  private maxCacheSize = 250

  public static getInstance(): ArtworkLoader {
    if (!ArtworkLoader.instance) {
      ArtworkLoader.instance = new ArtworkLoader()
    }
    return ArtworkLoader.instance
  }

  public async preloadImage(
    src: string,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<boolean> {
    const valid = imageUrlSchema.safeParse(src)
    if (!valid.success) {
      recordArtworkMetric('imageLoadErrors')
      return false
    }

    const cached = this.cache.get(src)
    if (cached !== undefined) {
      return cached
    }

    const existing = this.inFlight.get(src)
    if (existing) {
      recordArtworkMetric('preloadsCoalesced')
      return existing
    }

    if (options.signal?.aborted) {
      return false
    }

    const timeoutMs = options.timeoutMs ?? 5000

    const promise = new Promise<boolean>((resolve) => {
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          recordArtworkMetric('imageLoadErrors')
          resolve(false)
        }
      }, timeoutMs)

      if (options.signal) {
        options.signal.addEventListener(
          'abort',
          () => {
            if (!settled) {
              settled = true
              clearTimeout(timer)
              resolve(false)
            }
          },
          { once: true },
        )
      }

      if (typeof Image === 'undefined') {
        clearTimeout(timer)
        resolve(true) // Node environment mock resolution
        return
      }

      const img = new Image()
      img.onload = () => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          recordArtworkMetric('imagesLoaded')
          resolve(true)
        }
      }
      img.onerror = () => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          recordArtworkMetric('imageLoadErrors')
          resolve(false)
        }
      }
      img.src = src
    }).then((success) => {
      this.inFlight.delete(src)
      if (this.cache.size >= this.maxCacheSize) {
        const firstKey = this.cache.keys().next().value
        if (firstKey) this.cache.delete(firstKey)
      }
      this.cache.set(src, success)
      return success
    })

    this.inFlight.set(src, promise)
    return promise
  }

  public revokeObjectUrl(url: string): void {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function' && url.startsWith('blob:')) {
      URL.revokeObjectURL(url)
    }
  }

  public clear(): void {
    this.inFlight.clear()
    this.cache.clear()
  }
}

export const artworkLoader = ArtworkLoader.getInstance()
