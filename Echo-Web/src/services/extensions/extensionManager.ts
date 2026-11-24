import type { Track } from '../../types/domain.ts'
import type {
  AddonEndpoint,
  AddonManifest,
  ExtensionHealthStatus,
  ExtensionTelemetry,
  ExtensionResolvedStream,
} from '../../types/extension.ts'

const STORAGE_KEY = 'echo_extension_addons_v1'

export class ExtensionManager {
  private addons: AddonEndpoint[] = []
  private listeners = new Set<(addons: AddonEndpoint[]) => void>()
  private telemetry: ExtensionTelemetry = {
    totalAttempts: 0,
    matchesFound: 0,
    resolutionSuccesses: 0,
    fallbackCount: 0,
  }

  constructor() {
    this.load()
  }

  private load(): void {
    if (typeof localStorage === 'undefined') return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        this.addons = JSON.parse(raw) as AddonEndpoint[]
      }
    } catch {
      this.addons = []
    }
  }

  private save(): void {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.addons))
      } catch {
        // Storage unavailable
      }
    }
    for (const listener of this.listeners) {
      listener(this.getAddons())
    }
  }

  public subscribe(listener: (addons: AddonEndpoint[]) => void): () => void {
    this.listeners.add(listener)
    listener(this.getAddons())
    return () => {
      this.listeners.delete(listener)
    }
  }

  public getAddons(): AddonEndpoint[] {
    return [...this.addons].sort((a, b) => a.priority - b.priority)
  }

  public hasEnabledAddons(): boolean {
    return this.addons.some((a) => a.enabled)
  }

  public async checkHealth(url: string): Promise<ExtensionHealthStatus> {
    try {
      const res = await fetch(`/api/extensions/health?url=${encodeURIComponent(url)}`)
      const data = (await res.json()) as {
        ok: boolean
        latencyMs?: number | undefined
        manifest?: AddonManifest | undefined
        error?: string | undefined
      }

      if (res.ok && data.ok) {
        return {
          status: 'online',
          latencyMs: data.latencyMs,
          manifest: data.manifest,
        }
      }
      return {
        status: 'error',
        latencyMs: data.latencyMs,
        error: data.error || `HTTP ${res.status}`,
      }
    } catch (err) {
      return {
        status: 'offline',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  public async addAddon(addon: {
    name?: string | undefined
    url: string
    enabled?: boolean | undefined
  }): Promise<AddonEndpoint> {
    let resolvedName = (addon.name || '').trim()
    if (!resolvedName) {
      const health = await this.checkHealth(addon.url)
      resolvedName = health.manifest?.name || 'Custom Extension'
    }

    const id = `addon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const newEndpoint: AddonEndpoint = {
      id,
      name: resolvedName,
      url: addon.url.trim().replace(/\/+$/, ''),
      enabled: addon.enabled ?? true,
      priority: this.addons.length + 1,
    }

    this.addons.push(newEndpoint)
    this.save()
    return newEndpoint
  }

  public toggleAddon(id: string, enabled: boolean): void {
    const target = this.addons.find((a) => a.id === id)
    if (target) {
      target.enabled = enabled
      this.save()
    }
  }

  public removeAddon(id: string): void {
    this.addons = this.addons.filter((a) => a.id !== id)
    this.reindexPriorities()
    this.save()
  }

  public reorderAddons(orderedIds: string[]): void {
    const map = new Map(this.addons.map((a) => [a.id, a]))
    const reordered: AddonEndpoint[] = []
    orderedIds.forEach((id, index) => {
      const addon = map.get(id)
      if (addon) {
        reordered.push({ ...addon, priority: index + 1 })
        map.delete(id)
      }
    })
    // Append any remaining unlisted addons
    for (const remaining of map.values()) {
      reordered.push({ ...remaining, priority: reordered.length + 1 })
    }
    this.addons = reordered
    this.save()
  }

  private reindexPriorities(): void {
    this.addons.sort((a, b) => a.priority - b.priority)
    this.addons.forEach((a, idx) => {
      a.priority = idx + 1
    })
  }

  /**
   * Resolves an audio stream from configured extension sources in priority order.
   * If matching or resolution fails for all extensions, returns null so the caller
   * falls back cleanly to YouTube resolution.
   */
  public async resolveTrackExtension(track: Track): Promise<ExtensionResolvedStream | null> {
    const enabledAddons = this.getAddons().filter((a) => a.enabled)
    if (enabledAddons.length === 0) return null

    this.telemetry.totalAttempts++

    for (const addon of enabledAddons) {
      try {
        // Step 1: Match track candidate
        const matchRes = await fetch('/api/extensions/match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            addonUrl: addon.url,
            title: track.title,
            artist: track.artistName,
            durationMs: track.durationMs,
          }),
        })

        if (!matchRes.ok) continue
        const matchData = (await matchRes.json()) as {
          matched: boolean
          candidate?: { id: string } | undefined
        }

        if (!matchData.matched || !matchData.candidate?.id) continue
        this.telemetry.matchesFound++

        // Step 2: Resolve stream URL
        const resolveRes = await fetch('/api/extensions/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            addonUrl: addon.url,
            trackId: matchData.candidate.id,
          }),
        })

        if (!resolveRes.ok) continue
        const resolveData = (await resolveRes.json()) as {
          success: boolean
          stream?: {
            url: string
            format?: string | undefined
            codec?: string | undefined
            quality?: string | undefined
          } | undefined
        }

        if (resolveData.success && resolveData.stream?.url) {
          this.telemetry.resolutionSuccesses++
          this.telemetry.activeExtensionSource = addon.name

          return {
            streamUrl: resolveData.stream.url,
            mimeType: resolveData.stream.codec || 'audio/flac',
            codec: resolveData.stream.codec,
            quality: resolveData.stream.quality || 'lossless',
            source: addon.name,
          }
        }
      } catch {
        // Try next addon in cascade
      }
    }

    this.telemetry.fallbackCount++
    return null
  }

  public getTelemetry(): ExtensionTelemetry {
    return { ...this.telemetry }
  }

  public resetTelemetry(): void {
    this.telemetry = {
      totalAttempts: 0,
      matchesFound: 0,
      resolutionSuccesses: 0,
      fallbackCount: 0,
    }
  }
}

export const extensionManager = new ExtensionManager()
