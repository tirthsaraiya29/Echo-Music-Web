import type { Track } from '../../types/domain.ts'
import {
  type AddonEndpoint,
  type AddonManifest,
  type ExtensionHealthStatus,
  type ExtensionTelemetry,
  type ExtensionResolvedStream,
  type RegisterAddonInput,
  type ExtensionRegistryMetrics,
  addonEndpointSchema,
  registerAddonInputSchema,
  extensionHealthStatusSchema,
  extensionRegistryMetricsSchema,
} from '../../types/extension.ts'

const STORAGE_KEY = 'echo_extension_addons_v1'

const registryMetrics = {
  registrations: 0,
  removals: 0,
  toggles: 0,
  healthChecks: 0,
  healthCheckFailures: 0,
}

export function recordExtensionRegistryMetric(
  key: keyof typeof registryMetrics,
): void {
  registryMetrics[key] = (registryMetrics[key] || 0) + 1
}

export function resetExtensionRegistryMetrics(): void {
  registryMetrics.registrations = 0
  registryMetrics.removals = 0
  registryMetrics.toggles = 0
  registryMetrics.healthChecks = 0
  registryMetrics.healthCheckFailures = 0
}

export function getExtensionRegistryMetrics(): ExtensionRegistryMetrics {
  return extensionRegistryMetricsSchema.parse(registryMetrics)
}

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
        const parsed = JSON.parse(raw) as unknown[]
        const validAddons: AddonEndpoint[] = []
        for (const item of parsed) {
          const res = addonEndpointSchema.safeParse(item)
          if (res.success) {
            validAddons.push(res.data)
          }
        }
        this.addons = validAddons
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

  public async checkHealth(
    url: string,
    signal?: AbortSignal,
  ): Promise<ExtensionHealthStatus> {
    recordExtensionRegistryMetric('healthChecks')
    try {
      const fetchOptions: RequestInit = {}
      if (signal) {
        fetchOptions.signal = signal
      }
      const res = await fetch(`/api/extensions/health?url=${encodeURIComponent(url)}`, fetchOptions)
      const data = (await res.json()) as {
        ok: boolean
        latencyMs?: number | undefined
        manifest?: AddonManifest | undefined
        error?: string | undefined
      }

      if (res.ok && data.ok) {
        return extensionHealthStatusSchema.parse({
          status: 'online',
          latencyMs: data.latencyMs,
          manifest: data.manifest,
        })
      }
      recordExtensionRegistryMetric('healthCheckFailures')
      return extensionHealthStatusSchema.parse({
        status: 'error',
        latencyMs: data.latencyMs,
        error: data.error || `HTTP ${res.status}`,
      })
    } catch (err) {
      recordExtensionRegistryMetric('healthCheckFailures')
      return extensionHealthStatusSchema.parse({
        status: 'offline',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  public async addAddon(input: RegisterAddonInput): Promise<AddonEndpoint> {
    const validated = registerAddonInputSchema.parse(input)
    const normalizedUrl = validated.url.trim().replace(/\/+$/, '')

    // Deduplication check
    const existing = this.addons.find(
      (a) => a.url.toLowerCase() === normalizedUrl.toLowerCase(),
    )
    if (existing) {
      throw new Error(`Extension endpoint already registered: ${normalizedUrl}`)
    }

    let resolvedName = (validated.name || '').trim()
    if (!resolvedName) {
      const health = await this.checkHealth(normalizedUrl)
      resolvedName = health.manifest?.name || 'Custom Extension'
    }

    const id = `addon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const newEndpoint = addonEndpointSchema.parse({
      id,
      name: resolvedName,
      url: normalizedUrl,
      enabled: validated.enabled ?? true,
      priority: this.addons.length + 1,
    })

    this.addons.push(newEndpoint)
    this.save()
    recordExtensionRegistryMetric('registrations')
    return newEndpoint
  }

  public toggleAddon(id: string, enabled: boolean): void {
    const target = this.addons.find((a) => a.id === id)
    if (target) {
      target.enabled = enabled
      this.save()
      recordExtensionRegistryMetric('toggles')
    }
  }

  public removeAddon(id: string): void {
    const beforeLen = this.addons.length
    this.addons = this.addons.filter((a) => a.id !== id)
    if (this.addons.length < beforeLen) {
      this.reindexPriorities()
      this.save()
      recordExtensionRegistryMetric('removals')
    }
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
