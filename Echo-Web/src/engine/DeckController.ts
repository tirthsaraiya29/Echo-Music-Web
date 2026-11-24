import type { CrossfadeProfile, DeckId, PlaybackState, Track } from '../types/audio.ts'
import type { WebAudioGraph } from './WebAudioGraph.ts'
import { isValidTrack } from './QueueManager.ts'

export interface DeckControllerOptions {
  crossfadeDuration?: number
  crossfadeProfile?: CrossfadeProfile
  prebufferWindowMs?: number
  varispeedEnabled?: boolean
}

export function generateCrossfadeCurves(
  profile: CrossfadeProfile = 'equalPower',
  steps = 32,
): { fadeOutCurve: Float32Array; fadeInCurve: Float32Array } {
  const clampedSteps = Math.max(2, Math.min(256, steps))
  const fadeOutCurve = new Float32Array(clampedSteps)
  const fadeInCurve = new Float32Array(clampedSteps)

  for (let i = 0; i < clampedSteps; i++) {
    const t = i / (clampedSteps - 1)
    switch (profile) {
      case 'linear': {
        fadeOutCurve[i] = 1 - t
        fadeInCurve[i] = t
        break
      }
      case 'logarithmic': {
        const factor = Math.E * Math.E - 1
        fadeOutCurve[i] = Math.max(0, Math.min(1, (Math.exp(2 * (1 - t)) - 1) / factor))
        fadeInCurve[i] = Math.max(0, Math.min(1, (Math.exp(2 * t) - 1) / factor))
        break
      }
      case 'scurve': {
        const s = t * t * (3 - 2 * t)
        fadeOutCurve[i] = 1 - s
        fadeInCurve[i] = s
        break
      }
      case 'equalPower':
      default: {
        const theta = t * (Math.PI / 2)
        fadeOutCurve[i] = Math.cos(theta)
        fadeInCurve[i] = Math.sin(theta)
        break
      }
    }
  }

  // Ensure strict boundary guarantees
  fadeOutCurve[0] = 1.0
  fadeOutCurve[clampedSteps - 1] = 0.0
  fadeInCurve[0] = 0.0
  fadeInCurve[clampedSteps - 1] = 1.0

  return { fadeOutCurve, fadeInCurve }
}

export interface CrossfadeMetrics {
  crossfadeCount: number
  crossfadeSuccesses: number
  crossfadeFailures: number
  crossfadesCancelled: number
  gaplessTransitions: number
  lastCrossfadeDurationMs: number
}

export interface CrossfadeStatus {
  isCrossfading: boolean
  crossfadeDurationSeconds: number
  crossfadeProfile: CrossfadeProfile
  activeDeck: DeckId
  standbyDeck: DeckId
  hasStandbyTrack: boolean
  standbyReadyState: number
  metrics: CrossfadeMetrics
}

export class DeckController {
  private readonly graph: WebAudioGraph
  private readonly deckAElement: HTMLAudioElement
  private readonly deckBElement: HTMLAudioElement
  private readonly abortController = new AbortController()

  private deckASource: MediaElementAudioSourceNode | null = null
  private deckBSource: MediaElementAudioSourceNode | null = null

  private activeDeckId: DeckId = 'A'
  private crossfadeDurationSeconds = 3.0
  private crossfadeProfileSetting: CrossfadeProfile = 'equalPower'
  private prebufferWindowMs = 15000

  private activeTrackDeckA: Track | null = null
  private activeTrackDeckB: Track | null = null
  private varispeedEnabled = false

  private isPrebufferingTriggered = false
  private isCrossfading = false
  private crossfadeTimer: number | null = null

  private metrics: CrossfadeMetrics = {
    crossfadeCount: 0,
    crossfadeSuccesses: 0,
    crossfadeFailures: 0,
    crossfadesCancelled: 0,
    gaplessTransitions: 0,
    lastCrossfadeDurationMs: 0,
  }

  private gaplessPlaybackEnabled = true
  private playbackState: PlaybackState = 'IDLE'
  private currentPlayOperationId = 0
  private currentLoadOperationId = 0

  public onPlaybackStateChange?: (state: PlaybackState) => void
  public onTimeUpdate?: (currentTime: number, duration: number) => void
  public onBufferedUpdate?: (bufferedTime: number) => void
  public onTrackEnded?: (endedDeckId: DeckId) => void
  public onPrebufferNeeded?: (standbyDeckId: DeckId) => void
  public onCrossfadeStart?: (fromDeck: DeckId, toDeck: DeckId) => void
  public onCrossfadeFailed?: (fromDeck: DeckId, toDeck: DeckId, error: Error) => void
  public onCrossfadeCancelled?: (fromDeck: DeckId, toDeck: DeckId) => void
  public onCrossfadeComplete?: (newActiveDeck: DeckId) => void
  public onGaplessTransition?: (fromDeck: DeckId, toDeck: DeckId) => void
  public onVolumeChange?: (volume: number, muted: boolean) => void
  public onError?: (error: Error) => void

  constructor(graph: WebAudioGraph, options: DeckControllerOptions = {}) {
    this.graph = graph
    this.crossfadeDurationSeconds = options.crossfadeDuration ?? 3.0
    this.crossfadeProfileSetting = options.crossfadeProfile ?? 'equalPower'
    this.prebufferWindowMs = options.prebufferWindowMs ?? 15000
    this.varispeedEnabled = Boolean(options.varispeedEnabled)

    this.deckAElement = new Audio()
    this.deckBElement = new Audio()

    this.setupAudioElement(this.deckAElement, 'A')
    this.setupAudioElement(this.deckBElement, 'B')

    this.attachAudioSources()
  }

  public get activeDeck(): DeckId {
    return this.activeDeckId
  }

  public get standbyDeck(): DeckId {
    return this.activeDeckId === 'A' ? 'B' : 'A'
  }

  public get state(): PlaybackState {
    return this.playbackState
  }

  public get crossfadeDuration(): number {
    return this.crossfadeDurationSeconds
  }

  public setCrossfadeDuration(seconds: number): void {
    this.crossfadeDurationSeconds = Math.max(0, Math.min(12, Number.isFinite(seconds) ? seconds : 3))
  }

  public get crossfadeProfile(): CrossfadeProfile {
    return this.crossfadeProfileSetting
  }

  public setCrossfadeProfile(profile: CrossfadeProfile): void {
    this.crossfadeProfileSetting = profile
  }

  public getCrossfadeProfile(): CrossfadeProfile {
    return this.crossfadeProfileSetting
  }

  public setGaplessPlayback(enabled: boolean): void {
    this.gaplessPlaybackEnabled = Boolean(enabled)
  }

  public getGaplessPlayback(): boolean {
    return this.gaplessPlaybackEnabled
  }

  public setPrebufferWindowMs(ms: number): void {
    this.prebufferWindowMs = Math.max(5000, Math.min(60000, Number.isFinite(ms) ? ms : 15000))
  }

  public getMetrics(): Readonly<CrossfadeMetrics> {
    return { ...this.metrics }
  }

  public getCrossfadeStatus(): CrossfadeStatus {
    const standbyEl = this.getStandbyElement()
    return {
      isCrossfading: this.isCrossfading,
      crossfadeDurationSeconds: this.crossfadeDurationSeconds,
      crossfadeProfile: this.crossfadeProfileSetting,
      activeDeck: this.activeDeckId,
      standbyDeck: this.standbyDeck,
      hasStandbyTrack: Boolean(this.getStandbyTrack()),
      standbyReadyState: standbyEl.readyState,
      metrics: this.getMetrics(),
    }
  }

  public isCrossfadeActive(): boolean {
    return this.isCrossfading
  }

  public cancelCrossfade(): void {
    if (this.crossfadeTimer !== null) {
      window.clearTimeout(this.crossfadeTimer)
      this.crossfadeTimer = null
    }
    if (this.isCrossfading) {
      this.isCrossfading = false
      const now = this.graph.context.currentTime
      const fromDeck = this.activeDeckId
      const toDeck = this.standbyDeck
      const fromGain = fromDeck === 'A' ? this.graph.deckAGain : this.graph.deckBGain
      const toGain = toDeck === 'A' ? this.graph.deckAGain : this.graph.deckBGain
      fromGain.gain.cancelScheduledValues(now)
      toGain.gain.cancelScheduledValues(now)
      fromGain.gain.setValueAtTime(1.0, now)
      toGain.gain.setValueAtTime(0.0, now)

      const standbyEl = this.getStandbyElement()
      this.releaseMediaElement(standbyEl)
      if (toDeck === 'A') {
        this.activeTrackDeckA = null
      } else {
        this.activeTrackDeckB = null
      }
      this.metrics.crossfadesCancelled++
      this.onCrossfadeCancelled?.(fromDeck, toDeck)
    }
  }

  public getActiveTrack(): Track | null {
    return this.activeDeckId === 'A' ? this.activeTrackDeckA : this.activeTrackDeckB
  }

  public getStandbyTrack(): Track | null {
    return this.activeDeckId === 'A' ? this.activeTrackDeckB : this.activeTrackDeckA
  }

  public getCurrentTime(): number {
    const el = this.getActiveElement()
    return Number.isFinite(el.currentTime) ? el.currentTime : 0
  }

  public getDuration(): number {
    const el = this.getActiveElement()
    return Number.isFinite(el.duration) ? el.duration : 0
  }

  public getBufferedTime(): number {
    const el = this.getActiveElement()
    if (el.buffered.length > 0) {
      return el.buffered.end(el.buffered.length - 1)
    }
    return 0
  }

  public async loadActive(track: Track, url: string, autoPlay = true): Promise<void> {
    if (!isValidTrack(track) || typeof url !== 'string' || !url.trim()) {
      throw new Error('Invalid track or URL provided to loadActive')
    }
    if (this.isCrossfading) {
      this.cancelCrossfade()
    }
    const loadId = ++this.currentLoadOperationId
    const deck = this.activeDeckId
    if (deck === 'A') {
      this.activeTrackDeckA = track
    } else {
      this.activeTrackDeckB = track
    }

    this.isPrebufferingTriggered = false
    if (this.crossfadeTimer !== null) {
      window.clearTimeout(this.crossfadeTimer)
      this.crossfadeTimer = null
    }
    this.isCrossfading = false

    // Halt and release standby deck if it was active during an in-flight crossfade
    const standbyEl = this.getStandbyElement()
    this.releaseMediaElement(standbyEl)
    if (this.standbyDeck === 'A') {
      this.activeTrackDeckA = null
    } else {
      this.activeTrackDeckB = null
    }

    const now = this.graph.context.currentTime
    this.graph.deckAGain.gain.cancelScheduledValues(now)
    this.graph.deckBGain.gain.cancelScheduledValues(now)

    this.setDeckGain(deck, 1.0)
    this.setDeckGain(this.standbyDeck, 0.0)

    const el = this.getActiveElement()
    el.pause()
    el.src = url
    el.load()

    if (loadId !== this.currentLoadOperationId) {
      return
    }

    if (autoPlay) {
      await this.play()
    } else {
      this.setPlaybackState('PAUSED')
    }
  }

  public prebufferStandby(track: Track, url: string): void {
    if (!isValidTrack(track) || typeof url !== 'string' || !url.trim()) {
      return
    }
    const deck = this.standbyDeck
    if (deck === 'A') {
      this.activeTrackDeckA = track
    } else {
      this.activeTrackDeckB = track
    }

    this.setDeckGain(deck, 0.0)
    const el = this.getStandbyElement()
    el.src = url
    el.preload = 'auto'
    el.load()
  }

  public async play(): Promise<void> {
    const playOpId = ++this.currentPlayOperationId
    await this.graph.resume()
    const el = this.getActiveElement()

    try {
      this.setPlaybackState('BUFFERING')
      await el.play()

      // Guard: If another play/pause/load operation started while el.play() was pending, ignore
      if (playOpId !== this.currentPlayOperationId) {
        return
      }

      if (el.paused) {
        this.setPlaybackState('PAUSED')
      } else {
        this.setPlaybackState('PLAYING')
      }
    } catch (err: unknown) {
      if (playOpId !== this.currentPlayOperationId) {
        return
      }

      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        this.setPlaybackState('REQUIRES_USER_INTERACTION')
      } else if (err instanceof DOMException && err.name === 'AbortError') {
        // Ignored: interruption by rapid skip or subsequent load/pause
      } else {
        this.setPlaybackState('ERROR')
        this.onError?.(err instanceof Error ? err : new Error(String(err)))
      }
    }
  }

  public pause(): void {
    ++this.currentPlayOperationId
    if (this.isCrossfading) {
      this.cancelCrossfade()
    }
    this.getActiveElement().pause()
    this.setPlaybackState('PAUSED')
  }

  public toggle(): Promise<void> {
    if (this.playbackState === 'PLAYING') {
      this.pause()
      return Promise.resolve()
    }
    return this.play()
  }

  public seek(seconds: number): void {
    if (this.isCrossfading) {
      this.cancelCrossfade()
    }
    const el = this.getActiveElement()
    const duration = this.getDuration()
    const target = duration > 0 ? Math.max(0, Math.min(seconds, duration)) : Math.max(0, seconds)
    el.currentTime = target
    this.onTimeUpdate?.(target, duration)
  }

  public setPlaybackRate(rate: number): void {
    const clamped = Math.max(0.5, Math.min(2.0, rate))
    this.deckAElement.playbackRate = clamped
    this.deckBElement.playbackRate = clamped
    const a = this.deckAElement as unknown as {
      preservesPitch?: boolean
      mozPreservesPitch?: boolean
      webkitPreservesPitch?: boolean
    }
    const b = this.deckBElement as unknown as {
      preservesPitch?: boolean
      mozPreservesPitch?: boolean
      webkitPreservesPitch?: boolean
    }
    const preserve = !this.varispeedEnabled
    if ('preservesPitch' in a) a.preservesPitch = preserve
    if ('mozPreservesPitch' in a) a.mozPreservesPitch = preserve
    if ('webkitPreservesPitch' in a) a.webkitPreservesPitch = preserve
    if ('preservesPitch' in b) b.preservesPitch = preserve
    if ('mozPreservesPitch' in b) b.mozPreservesPitch = preserve
    if ('webkitPreservesPitch' in b) b.webkitPreservesPitch = preserve
  }

  public setVarispeed(enabled: boolean): void {
    this.varispeedEnabled = Boolean(enabled)
    const preserve = !this.varispeedEnabled
    const a = this.deckAElement as unknown as {
      preservesPitch?: boolean
      mozPreservesPitch?: boolean
      webkitPreservesPitch?: boolean
    }
    const b = this.deckBElement as unknown as {
      preservesPitch?: boolean
      mozPreservesPitch?: boolean
      webkitPreservesPitch?: boolean
    }
    if ('preservesPitch' in a) a.preservesPitch = preserve
    if ('mozPreservesPitch' in a) a.mozPreservesPitch = preserve
    if ('webkitPreservesPitch' in a) a.webkitPreservesPitch = preserve
    if ('preservesPitch' in b) b.preservesPitch = preserve
    if ('mozPreservesPitch' in b) b.mozPreservesPitch = preserve
    if ('webkitPreservesPitch' in b) b.webkitPreservesPitch = preserve
  }

  public getVarispeed(): boolean {
    return this.varispeedEnabled
  }

  public getPitchShiftSemitones(): number {
    if (!this.varispeedEnabled) return 0
    const rate = this.deckAElement.playbackRate || 1.0
    return Math.round(12 * Math.log2(rate) * 10) / 10
  }

  private currentSinkId = 'default'

  public getAudioSink(): string {
    const elA = this.deckAElement as unknown as { sinkId?: string }
    return this.currentSinkId || elA.sinkId || 'default'
  }

  public async setAudioSink(sinkId: string): Promise<boolean> {
    if (typeof sinkId !== 'string' || !sinkId.trim()) {
      return false
    }
    const cleanSinkId = sinkId.trim()
    const elA = this.deckAElement as unknown as { setSinkId?: (id: string) => Promise<void> }
    const elB = this.deckBElement as unknown as { setSinkId?: (id: string) => Promise<void> }

    if (typeof elA.setSinkId !== 'function' && typeof elB.setSinkId !== 'function') {
      return false
    }

    let success = true
    if (typeof elA.setSinkId === 'function') {
      try {
        await elA.setSinkId(cleanSinkId)
      } catch {
        success = false
      }
    }
    if (typeof elB.setSinkId === 'function') {
      try {
        await elB.setSinkId(cleanSinkId)
      } catch {
        success = false
      }
    }

    if (success) {
      this.currentSinkId = cleanSinkId
    }
    return success
  }

  public async crossfadeToStandby(): Promise<void> {
    if (this.isCrossfading) return
    const standbyEl = this.getStandbyElement()

    if (!standbyEl.src) {
      this.handleTrackEnded(this.activeDeckId)
      return
    }

    this.isCrossfading = true
    this.metrics.crossfadeCount++
    const crossfadeStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const duration = this.crossfadeDurationSeconds
    const fromDeck = this.activeDeckId
    const toDeck = this.standbyDeck

    this.onCrossfadeStart?.(fromDeck, toDeck)

    try {
      await standbyEl.play()
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.onError?.(error)
      this.isCrossfading = false
      this.metrics.crossfadeFailures++
      this.onCrossfadeFailed?.(fromDeck, toDeck, error)
      return
    }

    const now = this.graph.context.currentTime
    const fromGain = fromDeck === 'A' ? this.graph.deckAGain : this.graph.deckBGain
    const toGain = toDeck === 'A' ? this.graph.deckAGain : this.graph.deckBGain

    if (duration > 0) {
      const { fadeOutCurve, fadeInCurve } = generateCrossfadeCurves(this.crossfadeProfileSetting, 32)

      fromGain.gain.cancelScheduledValues(now)
      toGain.gain.cancelScheduledValues(now)

      fromGain.gain.setValueCurveAtTime(fadeOutCurve, now, duration)
      toGain.gain.setValueCurveAtTime(fadeInCurve, now, duration)
    } else {
      fromGain.gain.cancelScheduledValues(now)
      toGain.gain.cancelScheduledValues(now)
      fromGain.gain.setTargetAtTime(0.0, now, 0.02)
      toGain.gain.setTargetAtTime(1.0, now, 0.02)
    }

    this.crossfadeTimer = window.setTimeout(
      () => {
        const oldActiveEl = this.getActiveElement()
        this.releaseMediaElement(oldActiveEl)
        if (fromDeck === 'A') {
          this.activeTrackDeckA = null
        } else {
          this.activeTrackDeckB = null
        }

        this.activeDeckId = toDeck
        this.isCrossfading = false
        this.isPrebufferingTriggered = false
        this.crossfadeTimer = null

        this.setDeckGain(fromDeck, 0.0)
        this.setDeckGain(toDeck, 1.0)
        this.metrics.crossfadeSuccesses++
        this.metrics.lastCrossfadeDurationMs =
          (typeof performance !== 'undefined' ? performance.now() : Date.now()) - crossfadeStartTime

        this.onCrossfadeComplete?.(toDeck)
      },
      Math.max(10, duration * 1000),
    )
  }

  public destroy(): void {
    if (this.crossfadeTimer !== null) {
      window.clearTimeout(this.crossfadeTimer)
      this.crossfadeTimer = null
    }

    this.abortController.abort()

    this.releaseMediaElement(this.deckAElement)
    this.releaseMediaElement(this.deckBElement)

    if (this.deckASource) {
      this.deckASource.disconnect()
      this.deckASource = null
    }

    if (this.deckBSource) {
      this.deckBSource.disconnect()
      this.deckBSource = null
    }
  }

  private releaseMediaElement(el: HTMLAudioElement): void {
    try {
      el.pause()
      el.currentTime = 0
      el.removeAttribute('src')
      el.src = ''
      el.load()
    } catch {
      // Non-fatal
    }
  }

  private setupAudioElement(el: HTMLAudioElement, deckId: DeckId): void {
    el.crossOrigin = 'anonymous'
    el.preload = 'metadata'
    const elWithPitch = el as unknown as {
      preservesPitch?: boolean
      mozPreservesPitch?: boolean
      webkitPreservesPitch?: boolean
    }
    const preserve = !this.varispeedEnabled
    if ('preservesPitch' in elWithPitch) elWithPitch.preservesPitch = preserve
    if ('mozPreservesPitch' in elWithPitch) elWithPitch.mozPreservesPitch = preserve
    if ('webkitPreservesPitch' in elWithPitch) elWithPitch.webkitPreservesPitch = preserve
    const signal = this.abortController.signal

    el.addEventListener(
      'timeupdate',
      () => {
        if (deckId !== this.activeDeckId && !this.isCrossfading) return
        const current = el.currentTime
        const duration = el.duration

        if (deckId === this.activeDeckId) {
          this.onTimeUpdate?.(current, Number.isFinite(duration) ? duration : 0)
          this.checkPrebufferThreshold(current, duration)
          this.checkCrossfadeThreshold(current, duration)
        }
      },
      { signal },
    )

    el.addEventListener(
      'progress',
      () => {
        if (deckId === this.activeDeckId && el.buffered.length > 0) {
          this.onBufferedUpdate?.(el.buffered.end(el.buffered.length - 1))
        }
      },
      { signal },
    )

    el.addEventListener(
      'ended',
      () => {
        if (deckId === this.activeDeckId) {
          this.handleTrackEnded(deckId)
        }
      },
      { signal },
    )

    el.addEventListener(
      'waiting',
      () => {
        if (deckId === this.activeDeckId) {
          this.setPlaybackState('BUFFERING')
        }
      },
      { signal },
    )

    el.addEventListener(
      'stalled',
      () => {
        if (deckId === this.activeDeckId && !el.paused && el.readyState < 3) {
          this.setPlaybackState('BUFFERING')
        }
      },
      { signal },
    )

    el.addEventListener(
      'playing',
      () => {
        if (deckId === this.activeDeckId) {
          this.setPlaybackState('PLAYING')
        }
      },
      { signal },
    )

    el.addEventListener(
      'pause',
      () => {
        if (deckId === this.activeDeckId && !this.isCrossfading) {
          this.setPlaybackState('PAUSED')
        }
      },
      { signal },
    )

    el.addEventListener(
      'volumechange',
      () => {
        if (deckId === this.activeDeckId) {
          this.onVolumeChange?.(el.volume, el.muted)
        }
      },
      { signal },
    )

    el.addEventListener(
      'canplay',
      () => {
        if (deckId === this.activeDeckId && this.playbackState === 'BUFFERING' && !el.paused) {
          this.setPlaybackState('PLAYING')
        }
      },
      { signal },
    )

    el.addEventListener(
      'error',
      () => {
        if (deckId === this.activeDeckId) {
          if (!el.src || el.src === window.location.href || !el.currentSrc) {
            return
          }
          this.setPlaybackState('ERROR')
          const mediaErr = el.error
          this.onError?.(
            new Error(mediaErr?.message ?? `Deck ${deckId} playback error: ${mediaErr?.code}`),
          )
        }
      },
      { signal },
    )
  }

  private attachAudioSources(): void {
    try {
      this.deckASource = this.graph.context.createMediaElementSource(this.deckAElement)
      this.deckASource.connect(this.graph.deckAGain)

      this.deckBSource = this.graph.context.createMediaElementSource(this.deckBElement)
      this.deckBSource.connect(this.graph.deckBGain)
    } catch (err) {
      this.onError?.(err instanceof Error ? err : new Error(String(err)))
    }
  }

  private getActiveElement(): HTMLAudioElement {
    return this.activeDeckId === 'A' ? this.deckAElement : this.deckBElement
  }

  private getStandbyElement(): HTMLAudioElement {
    return this.activeDeckId === 'A' ? this.deckBElement : this.deckAElement
  }

  private setDeckGain(deckId: DeckId, gain: number): void {
    const targetGain = deckId === 'A' ? this.graph.deckAGain : this.graph.deckBGain
    const now = this.graph.context.currentTime
    const clamped = Math.max(0.0, Math.min(1.0, gain))
    targetGain.gain.cancelScheduledValues(now)
    targetGain.gain.setTargetAtTime(clamped, now, 0.02)
  }

  private setPlaybackState(state: PlaybackState): void {
    if (this.playbackState !== state) {
      this.playbackState = state
      this.onPlaybackStateChange?.(state)
    }
  }

  private checkPrebufferThreshold(currentTime: number, duration: number): void {
    if (this.isPrebufferingTriggered || !Number.isFinite(duration) || duration <= 0) return

    const remainingSeconds = duration - currentTime
    const prebufferSeconds = this.prebufferWindowMs / 1000

    if (remainingSeconds <= prebufferSeconds) {
      this.isPrebufferingTriggered = true
      this.onPrebufferNeeded?.(this.standbyDeck)
    }
  }

  private checkCrossfadeThreshold(currentTime: number, duration: number): void {
    if (this.isCrossfading || !Number.isFinite(duration) || duration <= 0) return

    const remainingSeconds = duration - currentTime
    if (this.crossfadeDurationSeconds > 0 && remainingSeconds <= this.crossfadeDurationSeconds) {
      void this.crossfadeToStandby()
    }
  }

  public async transitionGapless(): Promise<boolean> {
    if (this.isCrossfading) return false
    const standbyEl = this.getStandbyElement()
    const standbyTrack = this.getStandbyTrack()
    if (!standbyTrack || !standbyEl.src) return false

    const fromDeck = this.activeDeckId
    const toDeck = this.standbyDeck

    try {
      standbyEl.currentTime = 0
      await standbyEl.play()
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.onError?.(error)
      return false
    }

    const now = this.graph.context.currentTime
    const fromGain = fromDeck === 'A' ? this.graph.deckAGain : this.graph.deckBGain
    const toGain = toDeck === 'A' ? this.graph.deckAGain : this.graph.deckBGain

    // 5ms micro-ramp to eliminate DC offset click
    fromGain.gain.cancelScheduledValues(now)
    toGain.gain.cancelScheduledValues(now)
    fromGain.gain.setValueAtTime(1.0, now)
    fromGain.gain.linearRampToValueAtTime(0.0, now + 0.005)
    toGain.gain.setValueAtTime(0.0, now)
    toGain.gain.linearRampToValueAtTime(1.0, now + 0.005)

    const oldActiveEl = this.getActiveElement()
    this.releaseMediaElement(oldActiveEl)
    if (fromDeck === 'A') {
      this.activeTrackDeckA = null
    } else {
      this.activeTrackDeckB = null
    }

    this.activeDeckId = toDeck
    this.isPrebufferingTriggered = false
    this.metrics.gaplessTransitions++

    this.onGaplessTransition?.(fromDeck, toDeck)
    return true
  }

  private handleTrackEnded(deckId: DeckId): void {
    if (this.isCrossfading) return

    const standbyEl = this.getStandbyElement()
    const standbyTrack = this.getStandbyTrack()
    if (this.gaplessPlaybackEnabled && standbyTrack && standbyEl.src && standbyEl.readyState >= 2) {
      void this.transitionGapless()
      return
    }

    this.onTrackEnded?.(deckId)
  }
}
