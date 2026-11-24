import { z } from 'zod'

export const artworkKeySchema = z.string().trim().min(1).max(256)

export const artworkLifecycleMetricsSchema = z.object({
  createdCount: z.number().nonnegative(),
  reusedCount: z.number().nonnegative(),
  revokedCount: z.number().nonnegative(),
  activeCount: z.number().nonnegative(),
})

export type ArtworkLifecycleMetrics = z.infer<typeof artworkLifecycleMetricsSchema>

const artworkMetrics = {
  createdCount: 0,
  reusedCount: 0,
  revokedCount: 0,
}

export function getArtworkLifecycleMetrics(): ArtworkLifecycleMetrics {
  return {
    ...artworkMetrics,
    activeCount: ObjectUrlRegistry.getInstance().getActiveCount(),
  }
}

export function resetArtworkLifecycleMetrics(): void {
  artworkMetrics.createdCount = 0
  artworkMetrics.reusedCount = 0
  artworkMetrics.revokedCount = 0
}

/**
 * Shared registry for managing Blob Object URLs with deduplication,
 * lifecycle tracking, capacity caps, and explicit revocation.
 */
export class ObjectUrlRegistry {
  private static instance: ObjectUrlRegistry | null = null
  private urlByKey = new Map<string, string>()
  private keyByUrl = new Map<string, string>()
  private readonly maxActiveUrls = 500

  public static getInstance(): ObjectUrlRegistry {
    if (!ObjectUrlRegistry.instance) {
      ObjectUrlRegistry.instance = new ObjectUrlRegistry()
    }
    return ObjectUrlRegistry.instance
  }

  public getOrCreate(key: string, blob: Blob): string {
    const keyValidation = artworkKeySchema.safeParse(key)
    if (!keyValidation.success) {
      return ''
    }
    const validKey = keyValidation.data

    const existing = this.urlByKey.get(validKey)
    if (existing) {
      artworkMetrics.reusedCount++
      return existing
    }

    // Capacity cap: Evict oldest entry if at or exceeding limit
    if (this.urlByKey.size >= this.maxActiveUrls) {
      const oldestKey = this.urlByKey.keys().next().value
      if (oldestKey) {
        this.revokeByKey(oldestKey)
      }
    }

    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const url = URL.createObjectURL(blob)
      this.urlByKey.set(validKey, url)
      this.keyByUrl.set(url, validKey)
      artworkMetrics.createdCount++
      return url
    }

    return ''
  }

  public revokeByKey(key: string): void {
    const url = this.urlByKey.get(key)
    if (url) {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(url)
      }
      this.urlByKey.delete(key)
      this.keyByUrl.delete(url)
      artworkMetrics.revokedCount++
    }
  }

  public revokeUrl(url: string): void {
    const key = this.keyByUrl.get(url)
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url)
    }
    if (key) {
      this.urlByKey.delete(key)
    }
    this.keyByUrl.delete(url)
    artworkMetrics.revokedCount++
  }

  public revokeAll(): void {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      for (const url of this.urlByKey.values()) {
        URL.revokeObjectURL(url)
      }
    }
    const count = this.urlByKey.size
    this.urlByKey.clear()
    this.keyByUrl.clear()
    artworkMetrics.revokedCount += count
  }

  public getActiveCount(): number {
    return this.urlByKey.size
  }

  public hasKey(key: string): boolean {
    return this.urlByKey.has(key)
  }

  public getUrl(key: string): string | undefined {
    return this.urlByKey.get(key)
  }
}

export const objectUrlRegistry = ObjectUrlRegistry.getInstance()

export function getLocalArtworkUrl(trackId: string, artworkBlob: Blob): string {
  return objectUrlRegistry.getOrCreate(`art_${trackId}`, artworkBlob)
}

export function revokeLocalArtwork(trackId: string): void {
  objectUrlRegistry.revokeByKey(`art_${trackId}`)
}
