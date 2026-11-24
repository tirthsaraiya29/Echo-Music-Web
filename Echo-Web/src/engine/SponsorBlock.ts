import type { SponsorSegment } from '../types/audio.ts'
import {
  sponsorSegmentSchema,
  sponsorblockOptionsSchema,
  recordSponsorBlockMetric,
  type SponsorBlockOptions,
} from './sponsorblockTypes.ts'

export type { SponsorSegment, SponsorBlockOptions }

export interface SponsorBlockRequestOptions {
  signal?: AbortSignal | undefined
  timeoutMs?: number | undefined
}

export class SponsorBlock {
  private isEnabled = true
  private categories: string[] = ['music_offtopic', 'intro', 'outro', 'preview']
  private pollIntervalMs = 250
  private apiBaseUrl = '/api/sponsorblock'

  private pollTimer: number | ReturnType<typeof setInterval> | null = null
  private currentSegments: SponsorSegment[] = []
  private currentVideoId: string | null = null
  private segmentCache = new Map<string, SponsorSegment[]>()
  private inFlightRequests = new Map<string, Promise<SponsorSegment[]>>()
  private skippedSegmentIds = new Set<string>()
  private activeLoadController: AbortController | null = null

  private getCurrentTime: (() => number) | null = null
  private onSeek: ((timeSeconds: number) => void) | null = null
  public onSegmentSkipped?: (segment: SponsorSegment) => void

  constructor(options: Partial<SponsorBlockOptions> = {}) {
    const parsed = sponsorblockOptionsSchema.parse(options)
    this.isEnabled = parsed.enabled
    this.categories = parsed.categories
    this.pollIntervalMs = parsed.pollIntervalMs
    this.apiBaseUrl = parsed.apiBaseUrl
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled
    if (!enabled && this.pollTimer !== null) {
      this.stopPolling()
    } else if (enabled && this.pollTimer === null && this.currentVideoId) {
      this.startPolling()
    }
  }

  public getEnabled(): boolean {
    return this.isEnabled
  }

  public setCategories(categories: string[]): void {
    this.categories = [...categories]
  }

  public attachPlayer(getCurrentTime: () => number, onSeek: (timeSeconds: number) => void): void {
    this.getCurrentTime = getCurrentTime
    this.onSeek = onSeek
  }

  public async loadSegmentsForVideo(
    videoId: string,
    options: SponsorBlockRequestOptions = {},
  ): Promise<SponsorSegment[]> {
    this.stopPolling()
    if (this.activeLoadController) {
      this.activeLoadController.abort()
      this.activeLoadController = null
    }

    const cleanVideoId = videoId?.trim()
    this.currentVideoId = cleanVideoId
    this.currentSegments = []
    this.skippedSegmentIds.clear()

    if (!cleanVideoId || !/^[a-zA-Z0-9_-]{11}$/.test(cleanVideoId)) {
      return []
    }

    // Check LRU cache
    const cached = this.segmentCache.get(cleanVideoId)
    if (cached) {
      recordSponsorBlockMetric('cacheHits')
      // Refresh key order in LRU cache
      this.segmentCache.delete(cleanVideoId)
      this.segmentCache.set(cleanVideoId, cached)

      if (this.currentVideoId !== cleanVideoId) return []
      this.currentSegments = cached.map((s) => ({ ...s }))
      if (this.isEnabled) this.startPolling()
      return this.currentSegments
    }

    recordSponsorBlockMetric('cacheMisses')

    // Coalesce concurrent in-flight requests for the same videoId
    const inFlight = this.inFlightRequests.get(cleanVideoId)
    if (inFlight) {
      const segs = await inFlight
      if (this.currentVideoId === cleanVideoId) {
        this.currentSegments = segs.map((s) => ({ ...s }))
        if (this.isEnabled && segs.length > 0) this.startPolling()
      }
      return segs
    }

    const timeoutMs = options.timeoutMs ?? 5000
    const timeoutCtrl = new AbortController()
    const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs)
    this.activeLoadController = new AbortController()
    const localCtrl = this.activeLoadController

    const combinedSignal = anySignal(
      [options.signal, localCtrl.signal, timeoutCtrl.signal].filter(
        (s): s is AbortSignal => s !== undefined,
      ),
    )

    const fetchPromise = (async () => {
      try {
        const url = this.apiBaseUrl.includes('/api/sponsorblock')
          ? `${this.apiBaseUrl}/${encodeURIComponent(cleanVideoId)}`
          : `${this.apiBaseUrl}/skipSegments?videoID=${encodeURIComponent(cleanVideoId)}&categories=${encodeURIComponent(JSON.stringify(this.categories))}`

        const response = await fetch(url, { signal: combinedSignal })
        clearTimeout(timer)

        if (!response.ok) {
          if (response.status === 404) {
            this.setCache(cleanVideoId, [])
            return []
          }
          recordSponsorBlockMetric('fetchErrors')
          return []
        }

        const data = (await response.json().catch(() => [])) as unknown[]
        if (!Array.isArray(data)) {
          this.setCache(cleanVideoId, [])
          return []
        }

        const parsedSegments: SponsorSegment[] = []
        for (const item of data) {
          if (!item || typeof item !== 'object') continue
          const obj = item as Record<string, unknown>
          let start = 0
          let end = 0
          if (Array.isArray(obj['segment']) && obj['segment'].length === 2) {
            start = Number(obj['segment'][0])
            end = Number(obj['segment'][1])
          } else if (typeof obj['start'] === 'number' && typeof obj['end'] === 'number') {
            start = obj['start']
            end = obj['end']
          } else {
            continue
          }

          const rawCandidate = {
            category: String(obj['category'] || 'music_offtopic'),
            start,
            end,
            uuid: typeof obj['UUID'] === 'string' ? obj['UUID'] : typeof obj['uuid'] === 'string' ? obj['uuid'] : undefined,
          }

          const parsed = sponsorSegmentSchema.safeParse(rawCandidate)
          if (parsed.success) {
            const seg: SponsorSegment = {
              category: parsed.data.category,
              start: parsed.data.start,
              end: parsed.data.end,
              ...(parsed.data.uuid ? { uuid: parsed.data.uuid } : {}),
            }
            parsedSegments.push(seg)
          }
        }

        parsedSegments.sort((a, b) => a.start - b.start)
        this.setCache(cleanVideoId, parsedSegments)
        recordSponsorBlockMetric('segmentsLoaded')

        return parsedSegments
      } catch (err: unknown) {
        clearTimeout(timer)
        if (combinedSignal.aborted) {
          recordSponsorBlockMetric('cancellations')
        } else {
          recordSponsorBlockMetric('fetchErrors')
        }
        return []
      } finally {
        this.inFlightRequests.delete(cleanVideoId)
      }
    })()

    this.inFlightRequests.set(cleanVideoId, fetchPromise)

    const finalSegments = await fetchPromise

    if (this.currentVideoId !== cleanVideoId) {
      return []
    }

    this.currentSegments = finalSegments.map((s) => ({ ...s }))
    if (this.isEnabled && finalSegments.length > 0) {
      this.startPolling()
    }

    return finalSegments
  }

  private setCache(videoId: string, segments: SponsorSegment[]): void {
    // Bound cache to 100 entries max (LRU eviction)
    if (this.segmentCache.size >= 100) {
      const oldestKey = this.segmentCache.keys().next().value
      if (oldestKey) {
        this.segmentCache.delete(oldestKey)
      }
    }
    this.segmentCache.set(videoId, segments)
  }

  public setManualSegments(segments: SponsorSegment[]): void {
    this.stopPolling()
    this.skippedSegmentIds.clear()
    this.currentSegments = segments
      .filter((s) => {
        const parsed = sponsorSegmentSchema.safeParse(s)
        return parsed.success
      })
      .map((s) => ({ ...s }))
      .sort((a, b) => a.start - b.start)

    if (this.isEnabled && this.currentSegments.length > 0) {
      this.startPolling()
    }
  }

  public checkSegments(currentTime: number): SponsorSegment | null {
    if (!this.isEnabled || this.currentSegments.length === 0) return null

    for (const seg of this.currentSegments) {
      const segId = seg.uuid || `${seg.start}-${seg.end}`
      if (this.skippedSegmentIds.has(segId)) continue

      if (currentTime >= seg.start && currentTime < seg.end - 0.05) {
        return { ...seg }
      }
    }
    return null
  }

  public startPolling(): void {
    if (this.pollTimer !== null) return

    const intervalFn = typeof window !== 'undefined' ? window.setInterval : setInterval
    this.pollTimer = intervalFn(() => {
      if (!this.isEnabled || !this.getCurrentTime || !this.onSeek) return

      const time = this.getCurrentTime()
      const segToSkip = this.checkSegments(time)

      if (segToSkip) {
        const segId = segToSkip.uuid || `${segToSkip.start}-${segToSkip.end}`
        this.skippedSegmentIds.add(segId)
        recordSponsorBlockMetric('segmentsSkipped')
        // Micro-offset of +0.05s guarantees clearing segment boundary to prevent stutter loops
        const targetTime = Math.max(0, segToSkip.end + 0.05)
        this.onSeek(targetTime)
        this.onSegmentSkipped?.(segToSkip)
      }
    }, this.pollIntervalMs)
  }

  public stopPolling(): void {
    if (this.pollTimer !== null) {
      if (typeof window !== 'undefined') window.clearInterval(this.pollTimer as number)
      else clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  public destroy(): void {
    this.stopPolling()
    if (this.activeLoadController) {
      this.activeLoadController.abort()
      this.activeLoadController = null
    }
    this.currentSegments = []
    this.skippedSegmentIds.clear()
    this.segmentCache.clear()
    this.inFlightRequests.clear()
    this.getCurrentTime = null
    this.onSeek = null
  }
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const s of signals) {
    if (s.aborted) {
      controller.abort()
      return controller.signal
    }
    s.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return controller.signal
}
