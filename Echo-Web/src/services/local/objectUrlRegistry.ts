/**
 * Shared registry for managing Blob Object URLs with deduplication,
 * lifecycle tracking, and explicit revocation.
 */
export class ObjectUrlRegistry {
  private static instance: ObjectUrlRegistry | null = null
  private urlByKey = new Map<string, string>()
  private keyByUrl = new Map<string, string>()

  public static getInstance(): ObjectUrlRegistry {
    if (!ObjectUrlRegistry.instance) {
      ObjectUrlRegistry.instance = new ObjectUrlRegistry()
    }
    return ObjectUrlRegistry.instance
  }

  public getOrCreate(key: string, blob: Blob): string {
    const existing = this.urlByKey.get(key)
    if (existing) {
      return existing
    }

    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const url = URL.createObjectURL(blob)
      this.urlByKey.set(key, url)
      this.keyByUrl.set(url, key)
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
  }

  public revokeAll(): void {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      for (const url of this.urlByKey.values()) {
        URL.revokeObjectURL(url)
      }
    }
    this.urlByKey.clear()
    this.keyByUrl.clear()
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
