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
  private inFlightResolutions = new Map<string, Promise<ExtensionResolvedStream | null>>()
  private preloadedStreams = new Map<string, ExtensionResolvedStream>()
  private static readonly PRELOAD_CACHE_MAX = 20

  private telemetry: ExtensionTelemetry = {
    totalAttempts: 0,
    matchesFound: 0,
    resolutionSuccesses: 0,
    fallbackCount: 0,
    fallbackToYouTubeCount: 0,
    extensionCascadeFailures: 0,
    preloadsTriggered: 0,
    preloadCacheHits: 0,
    inFlightPreloadDeduplicated: 0,
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
    let initialHealth: ExtensionHealthStatus = { status: 'unknown' }
    const health = await this.checkHealth(normalizedUrl)
    initialHealth = health
    if (!resolvedName) {
      resolvedName = health.manifest?.name || 'Custom Extension'
    }

    const id = `addon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const newEndpoint = addonEndpointSchema.parse({
      id,
      name: resolvedName,
      url: normalizedUrl,
      enabled: validated.enabled ?? true,
      priority: this.addons.length + 1,
      healthStatus: initialHealth.status,
      latencyMs: initialHealth.latencyMs,
      lastCheckAt: Date.now(),
      lastError: initialHealth.error,
    })

    this.addons.push(newEndpoint)
    this.save()
    recordExtensionRegistryMetric('registrations')
    return newEndpoint
  }

  public async testEndpointHealth(addonId: string): Promise<ExtensionHealthStatus> {
    const addon = this.addons.find((a) => a.id === addonId)
    if (!addon) {
      throw new Error(`Endpoint ${addonId} not found`)
    }

    const status = await this.checkHealth(addon.url)
    addon.healthStatus = status.status
    addon.latencyMs = status.latencyMs
    addon.lastCheckAt = Date.now()
    addon.lastError = status.error
    if (status.status === 'online') {
      addon.lastSuccessAt = Date.now()
    }
    this.save()
    return status
  }

  public async testAllEndpoints(): Promise<void> {
    const promises = this.addons.map((a) => this.testEndpointHealth(a.id).catch(() => {}))
    await Promise.allSettled(promises)
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
  /**
   * Preloads an extension audio stream for an upcoming track without duplicating in-flight
   * work or triggering redundant resolutions.
   */
  public async preloadExtensionStream(track: Track): Promise<ExtensionResolvedStream | null> {
    const enabledAddons = this.getAddons().filter((a) => a.enabled)
    if (enabledAddons.length === 0) return null

    this.telemetry.preloadsTriggered++

    if (this.preloadedStreams.has(track.id)) {
      this.telemetry.preloadCacheHits++
      return this.preloadedStreams.get(track.id) || null
    }

    if (this.inFlightResolutions.has(track.id)) {
      this.telemetry.inFlightPreloadDeduplicated++
      return this.inFlightResolutions.get(track.id) || null
    }

    const promise = this.executeTrackResolution(track, enabledAddons).finally(() => {
      this.inFlightResolutions.delete(track.id)
    })

    this.inFlightResolutions.set(track.id, promise)
    const result = await promise

    if (result) {
      this.preloadedStreams.set(track.id, result)
      if (this.preloadedStreams.size > ExtensionManager.PRELOAD_CACHE_MAX) {
        const oldestKey = this.preloadedStreams.keys().next().value
        if (oldestKey !== undefined) this.preloadedStreams.delete(oldestKey)
      }
    }

    return result
  }

  /**
   * Resolves an audio stream from configured extension sources in priority order.
   * Leverages preloaded stream cache and in-flight deduplication before issuing requests.
   */
  public async resolveTrackExtension(track: Track): Promise<ExtensionResolvedStream | null> {
    const enabledAddons = this.getAddons().filter((a) => a.enabled)
    if (enabledAddons.length === 0) return null

    // Check preloaded cache first
    if (this.preloadedStreams.has(track.id)) {
      this.telemetry.preloadCacheHits++
      const cached = this.preloadedStreams.get(track.id)!
      this.preloadedStreams.delete(track.id) // Consume cache entry
      return cached
    }

    // Await in-flight resolution if already running for this track
    if (this.inFlightResolutions.has(track.id)) {
      this.telemetry.inFlightPreloadDeduplicated++
      return this.inFlightResolutions.get(track.id)!
    }

    this.telemetry.totalAttempts++

    const promise = this.executeTrackResolution(track, enabledAddons).finally(() => {
      this.inFlightResolutions.delete(track.id)
    })

    this.inFlightResolutions.set(track.id, promise)
    return promise
  }

  private async executeTrackResolution(
    track: Track,
    enabledAddons: AddonEndpoint[],
  ): Promise<ExtensionResolvedStream | null> {
    for (const addon of enabledAddons) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3500)
      try {
        // Step 1: Match track candidate
        const matchRes = await fetch('/api/extensions/match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            addonUrl: addon.url,
            title: track.title,
            artist: track.artistName,
            durationMs: track.durationMs,
            isrc: track.isrc || undefined,
          }),
        })

        if (!matchRes.ok) {
          this.telemetry.extensionCascadeFailures++
          continue
        }
        const matchData = (await matchRes.json()) as {
          matched: boolean
          candidate?: { id: string } | undefined
        }

        if (!matchData.matched || !matchData.candidate?.id) {
          this.telemetry.extensionCascadeFailures++
          continue
        }
        this.telemetry.matchesFound++

        // Step 2: Resolve stream URL
        const resolveRes = await fetch('/api/extensions/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            addonUrl: addon.url,
            trackId: matchData.candidate.id,
          }),
        })

        if (!resolveRes.ok) {
          this.telemetry.extensionCascadeFailures++
          continue
        }
        const resolveData = (await resolveRes.json()) as {
          success: boolean
          stream?: {
            url: string
            format?: string | undefined
            codec?: string | undefined
            quality?: string | undefined
            bitrate?: number | undefined
          } | undefined
        }

        if (resolveData.success && resolveData.stream?.url) {
          this.telemetry.resolutionSuccesses++
          this.telemetry.activeExtensionSource = addon.name
          addon.lastSuccessAt = Date.now()
          addon.healthStatus = 'online'
          this.save()

          return {
            streamUrl: resolveData.stream.url,
            mimeType: resolveData.stream.codec || 'audio/flac',
            codec: resolveData.stream.codec,
            quality: resolveData.stream.quality || 'lossless',
            bitrate: resolveData.stream.bitrate,
            source: addon.name,
          }
        }
        this.telemetry.extensionCascadeFailures++
      } catch {
        this.telemetry.extensionCascadeFailures++
      } finally {
        clearTimeout(timer)
      }
    }

    this.telemetry.fallbackCount++
    this.telemetry.fallbackToYouTubeCount++
    return null
  }

  public clearPreloadCache(): void {
    this.preloadedStreams.clear()
    this.inFlightResolutions.clear()
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
      fallbackToYouTubeCount: 0,
      extensionCascadeFailures: 0,
      preloadsTriggered: 0,
      preloadCacheHits: 0,
      inFlightPreloadDeduplicated: 0,
    }
    this.clearPreloadCache()
  }
}

export const extensionManager = new ExtensionManager()
