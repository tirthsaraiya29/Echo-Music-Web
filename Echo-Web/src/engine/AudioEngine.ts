import type {
  AudioEngineConfig,
  AudioEngineEvent,
  AudioEngineEventMap,
  AudioEngineState,
  ContinuationPagingState,
  CrossfadeProfile,
  DeckId,
  PlaybackState,
  QueueSnapshot,
  RepeatMode,
  RestoreQueueOptions,
  SponsorSegment,
  Track,
  VerifiedStreamTelemetry,
} from '../types/audio.ts'
import type { StreamResolutionResult } from '../types/innertube.ts'
import { DeckController } from './DeckController.ts'
import { MediaSession } from './MediaSession.ts'
import { QueueManager } from './QueueManager.ts'
import { SponsorBlock } from './SponsorBlock.ts'
import { WebAudioGraph } from './WebAudioGraph.ts'
import { db } from '../services/db/echoDatabase.ts'
import { useEchoStore } from '../stores/useEchoStore.ts'
import { recordListeningEvent } from '../services/recommendations/localTasteEngine.ts'
import { updateLastFmNowPlaying, scrobbleLastFmTrack } from '../services/lastfm/lastfmService.ts'
import { updateDiscordPresence, clearDiscordPresence } from '../services/discord/discordService.ts'
import { castService } from '../services/cast/castService.ts'
import { extensionManager } from '../services/extensions/extensionManager.ts'
import type { ExtensionResolvedStream } from '../types/extension.ts'
import {
  isDataSaverActive,
  isMeteredConnection,
  getEffectiveAudioQuality,
} from '../services/networkQuality.ts'

export { isDataSaverActive, isMeteredConnection, getEffectiveAudioQuality }

export interface AudioEngineMetrics {
  stateEmissionsCount: number
  eventsEmittedCount: number
  tracksLoadedCount: number
  errorsCaughtCount: number
  lastTransitionDurationMs: number
}

export class AudioEngine {
  private static instance: AudioEngine | null = null

  private readonly graph: WebAudioGraph
  private readonly deckController: DeckController
  private readonly queueManager: QueueManager
  private readonly sponsorBlock: SponsorBlock
  private readonly mediaSession: MediaSession

  private listeners = new Set<(state: AudioEngineState) => void>()
  private eventHandlers = new Map<AudioEngineEvent, Set<(...args: unknown[]) => void>>()

  private volumeLevel = 0.8
  private isMuted = false
  private autoRadioEnabled = true

  private stateVersion = 0
  private lastErrorMessage: string | null = null
  private metrics: AudioEngineMetrics = {
    stateEmissionsCount: 0,
    eventsEmittedCount: 0,
    tracksLoadedCount: 0,
    errorsCaughtCount: 0,
    lastTransitionDurationMs: 0,
  }

  // LRU-bounded stream URL cache and registry of created blob object URLs, which are revoked
  // when evicted so IndexedDB blobs are not pinned in memory.
  private streamCache = new Map<string, { url: string; mimeType?: string | undefined }>()
  private static readonly STREAM_CACHE_MAX = 200
  private objectUrls = new Set<string>()
  private isFetchingRadioContinuation = false
  private radioAbortController: AbortController | null = null
  private inFlightRadioVideoId: string | null = null
  private currentLoadRequestId = 0

  private userInteractionCleanup: (() => void) | null = null

  private sleepTimerInterval: number | null = null
  private sleepTimerEndsAt: number | null = null
  private sleepTimerFadeActive = false
  private sleepTimerEndOfTrack = false
  private playbackRate = 1.0
  private lastStreamFormat: StreamResolutionResult['format'] | null = null
  private activeExtensionStream: ExtensionResolvedStream | null = null
  private consecutiveErrorCount = 0
  private lastPodcastSaveMs = 0
  private lastFmScrobbled = false
  private loudnessMeasured = false
  private crossfadeRollback: (() => void) | null = null
  private currentTrackRecorded = false

  private constructor(config: Partial<AudioEngineConfig> = {}) {
    this.graph = new WebAudioGraph({
      volumeNormalization: config.volumeNormalization ?? false,
      stereoWidth: config.stereoWidth ?? 1.0,
    })

    this.deckController = new DeckController(this.graph, {
      crossfadeDuration: config.crossfadeDuration ?? 3.0,
      crossfadeProfile: useEchoStore.getState().preferences.crossfadeProfile ?? 'equalPower',
      prebufferWindowMs: config.prebufferWindowMs ?? 15000,
    })
    this.deckController.setGaplessPlayback(useEchoStore.getState().preferences.gaplessPlayback ?? true)
    this.deckController.setCrossfadeProfile(useEchoStore.getState().preferences.crossfadeProfile ?? 'equalPower')

    this.queueManager = new QueueManager()

    const sponsorBlockOptions: { enabled?: boolean; categories?: string[] } = {}
    if (typeof config.sponsorBlockEnabled === 'boolean') {
      sponsorBlockOptions.enabled = config.sponsorBlockEnabled
    }
    if (config.sponsorBlockCategories) {
      sponsorBlockOptions.categories = config.sponsorBlockCategories
    }
    this.sponsorBlock = new SponsorBlock(sponsorBlockOptions)

    this.mediaSession = new MediaSession({
      onPlay: () => void this.play(),
      onPause: () => this.pause(),
      onPreviousTrack: () => void this.previous(),
      onNextTrack: () => void this.next(),
      onSeekTo: (seconds) => this.seek(seconds),
      onSeekBackward: (offset) => this.seek(Math.max(0, this.getCurrentTime() - offset)),
      onSeekForward: (offset) =>
        this.seek(Math.min(this.deckController.getDuration(), this.getCurrentTime() + offset)),
    })

    this.autoRadioEnabled = config.autoRadio ?? true

    this.wireSubsystems()
    this.setupUserInteractionListener()

    if (typeof localStorage !== 'undefined') {
      try {
        const savedSink = localStorage.getItem('echo_audio_output_device_id')
        if (savedSink && savedSink !== 'default') {
          void this.deckController.setAudioSink(savedSink)
        }
      } catch {
        // Ignore storage read failures
      }
    }
  }

  public static getInstance(config?: Partial<AudioEngineConfig>): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine(config)
    }
    return AudioEngine.instance
  }

  public getMetrics(): Readonly<AudioEngineMetrics> {
    return { ...this.metrics }
  }

  public getState(): AudioEngineState {
    const detailed = this.queueManager.getDetailedQueue()
    return {
      playbackState: this.deckController.state,
      currentTrack: this.queueManager.currentTrack,
      currentTime: this.deckController.getCurrentTime(),
      duration: this.deckController.getDuration(),
      bufferedTime: this.deckController.getBufferedTime(),
      volume: this.volumeLevel,
      muted: this.isMuted,
      repeatMode: this.queueManager.repeatMode,
      isShuffle: this.queueManager.isShuffle,
      activeDeck: this.deckController.activeDeck,
      upNext: this.queueManager.upNext,
      sourceQueue: this.queueManager.sourceQueue,
      sourceUpcoming: detailed.sourceUpcoming,
      history: this.queueManager.history,
      radioQueue: this.queueManager.radioQueue,
      equalizerGains: this.graph.equalizer.getGains(),
      stereoWidth: this.graph.stereoWidener.getWidth(),
      volumeNormalization: this.graph.getVolumeNormalization(),
      crossfadeDuration: this.deckController.crossfadeDuration,
      crossfadeProfile: this.deckController.getCrossfadeProfile(),
      gaplessPlayback: this.deckController.getGaplessPlayback(),
      continuationState: this.queueManager.getContinuationState(),
      playbackRate: this.playbackRate,
      sleepTimerRemaining: this.getSleepTimerRemaining(),
      sleepTimerEndOfTrack: this.sleepTimerEndOfTrack,
      audioSinkId: this.deckController.getAudioSink(),
      isLoading: this.deckController.state === 'BUFFERING' || this.isFetchingRadioContinuation,
      hasError: this.deckController.state === 'ERROR' || this.consecutiveErrorCount > 0,
      lastErrorMessage: this.lastErrorMessage,
      stateVersion: this.stateVersion,
    }
  }

  public subscribe(listener: (state: AudioEngineState) => void): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => {
      this.listeners.delete(listener)
    }
  }

  public on<K extends AudioEngineEvent>(event: K, handler: AudioEngineEventMap[K]): () => void {
    let handlers = this.eventHandlers.get(event)
    if (!handlers) {
      handlers = new Set()
      this.eventHandlers.set(event, handlers)
    }
    const genericHandler = handler as unknown as (...args: unknown[]) => void
    handlers.add(genericHandler)
    return () => {
      handlers?.delete(genericHandler)
    }
  }

  public async play(track?: Track): Promise<void> {
    if (castService.getIsConnected()) {
      if (track) {
        if (track.id !== this.queueManager.currentTrack?.id) {
          this.recordCurrentTrackTransition(false)
        }
        this.queueManager.playTrackDirectly(track)
        await this.loadAndPlayTrack(track)
        return
      }
      castService.play()
      this.mediaSession.updatePlaybackState('playing')
      this.emitState()
      return
    }

    if (track) {
      if (track.id !== this.queueManager.currentTrack?.id) {
        this.recordCurrentTrackTransition(false)
      }
      this.queueManager.playTrackDirectly(track)
      await this.loadAndPlayTrack(track)
      return
    }

    const current = this.queueManager.currentTrack
    if (!current) {
      const nextResult = this.queueManager.next()
      if (nextResult.track) {
        await this.loadAndPlayTrack(nextResult.track)
      }
      return
    }

    await this.deckController.play()
    this.emitState()
  }

  public pause(): void {
    if (castService.getIsConnected()) {
      castService.pause()
    }
    this.deckController.pause()
    this.mediaSession.updatePlaybackState('paused')
    this.emitState()
  }

  public async togglePlayback(): Promise<void> {
    if (this.deckController.state === 'PLAYING') {
      this.pause()
    } else {
      await this.play()
    }
  }

  public async next(): Promise<void> {
    if (this.deckController.isCrossfadeActive()) {
      this.deckController.cancelCrossfade()
    }
    this.recordCurrentTrackTransition(false)
    const { track, shouldStop } = this.queueManager.next()
    this.emit('queueChange')

    if (!track || shouldStop) {
      this.pause()
      this.emitState()
      return
    }

    await this.loadAndPlayTrack(track)
    this.checkAutoRadio()
  }

  public async previous(): Promise<void> {
    if (this.deckController.isCrossfadeActive()) {
      this.deckController.cancelCrossfade()
    }
    const currentTime = this.deckController.getCurrentTime()
    const { track, seekToZero } = this.queueManager.previous(currentTime)
    this.emit('queueChange')

    if (seekToZero) {
      this.seek(0)
      return
    }

    if (track) {
      this.recordCurrentTrackTransition(false)
      await this.loadAndPlayTrack(track)
    }
  }

  public getCurrentTime(): number {
    return this.deckController.getCurrentTime()
  }

  public seek(seconds: number): void {
    if (castService.getIsConnected()) {
      castService.seek(seconds)
    }
    this.deckController.seek(seconds)
    this.mediaSession.updatePositionState(this.deckController.getDuration(), seconds)
    this.emitState()
  }

  public seekTo(positionSeconds: number): void {
    this.seek(positionSeconds)
  }

  public playNext(track: Track): void {
    this.queueManager.playNext(track)
    this.emit('queueChange')
    this.emitState()
  }

  public addToQueue(track: Track): void {
    this.queueManager.addToQueue(track)
    this.emit('queueChange')
    this.emitState()
  }

  public removeFromQueue(index: number): void {
    this.queueManager.removeUpNext(index)
    this.emit('queueChange')
    this.emitState()
  }

  public moveQueueItem(from: number, to: number): void {
    this.queueManager.moveUpNext(from, to)
    this.emit('queueChange')
    this.emitState()
  }

  public clearQueue(): void {
    this.queueManager.clearUpNext()
    this.emit('queueChange')
    this.emitState()
  }

  public removeSourceQueueItem(index: number): void {
    this.queueManager.removeSourceQueueItem(index)
    this.emit('queueChange')
    this.emitState()
  }

  public moveSourceQueueItem(from: number, to: number): void {
    this.queueManager.moveSourceQueueItem(from, to)
    this.emit('queueChange')
    this.emitState()
  }

  public clearSourceUpcoming(): void {
    this.queueManager.clearSourceUpcoming()
    this.emit('queueChange')
    this.emitState()
  }

  public clearEntireQueue(): void {
    this.queueManager.clearEntireQueue()
    this.emit('queueChange')
    this.emitState()
  }

  public clearHistory(): void {
    this.queueManager.clearHistory()
    this.emit('queueChange')
    this.emitState()
  }

  public getDetailedQueue() {
    return this.queueManager.getDetailedQueue()
  }

  public setQueue(tracks: Track[], startIndex = 0): void {
    const prefs = useEchoStore.getState().preferences
    const showExplicit = prefs.showExplicit ?? true
    let validTracks = tracks
    let validIndex = startIndex

    // If explicit content is disabled and the queue has explicit tracks, filter them out
    if (!showExplicit && tracks.length > 0) {
      const selectedTrack = tracks[startIndex]
      validTracks = tracks.filter((t, i) => !t.explicit || i === startIndex)
      validIndex = selectedTrack ? validTracks.indexOf(selectedTrack) : 0
      if (validIndex < 0) validIndex = 0
    }

    this.recordCurrentTrackTransition(false)
    const track = this.queueManager.setSourceQueue(validTracks, validIndex)
    this.emit('queueChange')
    if (track) {
      void this.loadAndPlayTrack(track)
    }
  }

  public playQueue(tracks: Track[], startIndex = 0): void {
    this.setQueue(tracks, startIndex)
  }

  public setVolume(volume: number): void {
    this.volumeLevel = Math.max(0, Math.min(1, volume))
    this.graph.setMasterVolume(this.volumeLevel, this.isMuted)
    this.emit('volumeChange', this.volumeLevel, this.isMuted)
    this.emitState()
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted
    this.graph.setMasterVolume(this.volumeLevel, this.isMuted)
    this.emit('volumeChange', this.volumeLevel, this.isMuted)
    this.emitState()
  }

  public setShuffle(enabled: boolean): void {
    this.queueManager.setShuffle(enabled)
    this.mediaSession.updateShuffleActive(enabled)
    this.emit('queueChange')
    this.emitState()
  }

  public setRepeatMode(mode: RepeatMode): void {
    this.queueManager.setRepeatMode(mode)
    this.mediaSession.updateRepeatMode(mode.toLowerCase() as 'off' | 'all' | 'one')
    this.emit('queueChange')
    this.emitState()
  }

  public setCrossfadeDuration(seconds: number): void {
    this.deckController.setCrossfadeDuration(seconds)
    this.emitState()
  }

  public setCrossfadeProfile(profile: CrossfadeProfile): void {
    this.deckController.setCrossfadeProfile(profile)
    this.emitState()
  }

  public setGaplessPlayback(enabled: boolean): void {
    this.deckController.setGaplessPlayback(enabled)
    this.emitState()
  }

  public setVolumeNormalization(enabled: boolean): void {
    this.graph.setVolumeNormalization(enabled)
    this.emitState()
  }

  public setStereoWidth(width: number): void {
    this.graph.stereoWidener.setWidth(width)
    this.emitState()
  }

  public setEqualizerGain(bandIndex: number, gainDb: number): void {
    this.graph.equalizer.setGain(bandIndex, gainDb)
    this.emitState()
  }

  public setEqualizerBands(gains: number[]): void {
    this.graph.equalizer.setAllGains(gains)
    this.emitState()
  }

  public setEqualizerPreset(presetName: string): void {
    this.graph.equalizer.setPreset(presetName)
    this.emitState()
  }

  public resetEqualizer(): void {
    this.graph.equalizer.reset()
    this.emitState()
  }

  public startSleepTimer(minutesOrOption: number | 'end_of_track'): void {
    this.cancelSleepTimer()
    if (minutesOrOption === 'end_of_track') {
      this.sleepTimerEndOfTrack = true
      this.emitState()
      return
    }

    const durationMs = minutesOrOption * 60 * 1000
    this.sleepTimerEndsAt = Date.now() + durationMs

    this.sleepTimerInterval = window.setInterval(() => {
      if (!this.sleepTimerEndsAt) return
      const remaining = Math.max(0, this.sleepTimerEndsAt - Date.now())

      // Fade out audio gradually in the final 30 seconds
      if (remaining <= 30000 && !this.sleepTimerFadeActive) {
        this.sleepTimerFadeActive = true
        let step = 0
        const steps = 30
        const startVol = this.volumeLevel
        const fadeInterval = window.setInterval(() => {
          step++
          const curVol = Math.max(0, startVol * (1 - step / steps))
          this.graph.setMasterVolume(curVol, this.isMuted)
          if (step >= steps) {
            window.clearInterval(fadeInterval)
          }
        }, 1000)
      }

      if (remaining <= 0) {
        this.pause()
        this.cancelSleepTimer()
        this.graph.setMasterVolume(this.volumeLevel, this.isMuted)
      } else {
        this.emitState()
      }
    }, 1000)

    this.emitState()
  }

  public cancelSleepTimer(): void {
    if (this.sleepTimerInterval !== null) {
      window.clearInterval(this.sleepTimerInterval)
      this.sleepTimerInterval = null
    }
    this.sleepTimerEndsAt = null
    this.sleepTimerFadeActive = false
    this.sleepTimerEndOfTrack = false
    this.graph.setMasterVolume(this.volumeLevel, this.isMuted)
    this.emitState()
  }

  public getSleepTimerRemaining(): number | null {
    if (!this.sleepTimerEndsAt) return null
    return Math.max(0, Math.round((this.sleepTimerEndsAt - Date.now()) / 1000))
  }

  public setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(0.5, Math.min(2.0, rate))
    this.deckController.setPlaybackRate(this.playbackRate)
    this.emitState()
  }

  public getPlaybackRate(): number {
    return this.playbackRate
  }

  public async setAudioOutput(sinkId: string): Promise<boolean> {
    if (typeof sinkId !== 'string' || !sinkId.trim()) {
      return false
    }
    const cleanSinkId = sinkId.trim()
    const success = await this.deckController.setAudioSink(cleanSinkId)
    if (success) {
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('echo_audio_output_device_id', cleanSinkId)
        } catch {
          // Ignore storage write failures
        }
      }
      this.emitState()
    }
    return success
  }

  public getAudioOutput(): string {
    return this.deckController.getAudioSink()
  }

  public getAudioTelemetry(): VerifiedStreamTelemetry {
    const current = this.queueManager.currentTrack
    const ctx = this.graph.context
    const sampleRateKhz = (ctx.sampleRate / 1000).toFixed(1)
    const isLocal = current?.id.startsWith('local_')

    if (this.activeExtensionStream) {
      const ext = this.activeExtensionStream
      const isFlac =
        (ext.codec?.toLowerCase().includes('flac') ?? false) ||
        (ext.mimeType?.toLowerCase().includes('flac') ?? false)
      const isAlac =
        (ext.codec?.toLowerCase().includes('alac') ?? false) ||
        (ext.mimeType?.toLowerCase().includes('alac') ?? false)
      const isWav =
        (ext.codec?.toLowerCase().includes('wav') ?? false) ||
        (ext.mimeType?.toLowerCase().includes('wav') ?? false)
      const isLossless =
        isFlac ||
        isAlac ||
        isWav ||
        (ext.quality?.toLowerCase().includes('lossless') ?? false)
      const is320 =
        (ext.quality?.includes('320') ?? false) || Boolean(ext.bitrate && ext.bitrate >= 320000)

      const codec = isFlac
        ? 'FLAC (Lossless)'
        : isAlac
          ? 'ALAC (Lossless)'
          : isWav
            ? 'WAV (PCM)'
            : isLossless
              ? 'Lossless Audio'
              : is320
                ? 'MP3 (320 kbps)'
                : ext.codec || 'Extension Stream'

      const numericBitrate = ext.bitrate || (is320 ? 320000 : undefined)
      const bitrate = isLossless
        ? 'Lossless'
        : is320
          ? '320 kbps'
          : ext.bitrate
            ? `${Math.round(ext.bitrate / 1000)} kbps`
            : ext.quality || '320 kbps'

      const container =
        ext.format ||
        (ext.mimeType?.split(';')[0]?.replace('audio/', '') ?? 'native')

      return {
        codec,
        bitrate,
        numericBitrate,
        sampleRate: `${sampleRateKhz} kHz`,
        sourceSampleRate: ext.sampleRate ? `${(ext.sampleRate / 1000).toFixed(1)} kHz` : `${sampleRateKhz} kHz`,
        outputSampleRate: `${sampleRateKhz} kHz`,
        bitDepth: ext.bitDepth ? `${ext.bitDepth}-bit` : (isLossless ? '16/24-bit' : '16-bit'),
        dspBitDepth: '32-bit Float DSP',
        channels: 2,
        source: ext.source || 'Extension Provider',
        isHighBitrate: Boolean(is320 || isLossless),
        isLossless,
        container,
        verified: true,
      }
    }

    // Local files
    const isLocalLossless =
      Boolean(isLocal) &&
      (current?.title.toLowerCase().endsWith('.flac') ||
        current?.title.toLowerCase().endsWith('.wav') ||
        current?.title.toLowerCase().endsWith('.alac'))

    if (isLocal) {
      const ext = current?.title.split('.').pop()?.toUpperCase() || 'PCM'
      const codec = isLocalLossless ? `${ext} (Lossless)` : `${ext} (Audio)`
      return {
        codec,
        bitrate: isLocalLossless ? 'Lossless' : 'Source Native',
        sampleRate: `${sampleRateKhz} kHz`,
        sourceSampleRate: `${sampleRateKhz} kHz`,
        outputSampleRate: `${sampleRateKhz} kHz`,
        bitDepth: isLocalLossless ? '16/24-bit' : '16-bit',
        dspBitDepth: '32-bit Float DSP',
        channels: 2,
        source: 'Local File (Decoded PCM)',
        isHighBitrate: Boolean(isLocalLossless),
        isLossless: Boolean(isLocalLossless),
        container: ext.toLowerCase(),
        verified: true,
      }
    }

    // Streamed tracks report verified facts from decoded container
    const isOpus = (this.lastStreamFormat?.mimeType ?? '').toLowerCase().includes('opus')
    const codec = isOpus ? 'Opus' : 'AAC'
    const container = this.lastStreamFormat?.mimeType?.includes('webm')
      ? 'WebM'
      : this.lastStreamFormat?.mimeType?.includes('mp4')
        ? 'MP4'
        : 'audio/stream'
    const bitrateKbps = this.lastStreamFormat
      ? Math.round(this.lastStreamFormat.bitrate / 1000)
      : null
    const bitrate = bitrateKbps ? `~${bitrateKbps} kbps` : 'Unresolved'
    const isHighBitrate = Boolean(bitrateKbps && bitrateKbps >= 256)
    const sourceSampleRate = this.lastStreamFormat?.audioSampleRate
      ? `${(Number(this.lastStreamFormat.audioSampleRate) / 1000).toFixed(1)} kHz`
      : `${sampleRateKhz} kHz`
    const channels = this.lastStreamFormat?.audioChannels || 2

    return {
      codec,
      bitrate,
      numericBitrate: this.lastStreamFormat?.bitrate,
      sampleRate: `${sampleRateKhz} kHz`,
      sourceSampleRate,
      outputSampleRate: `${sampleRateKhz} kHz`,
      bitDepth: '16-bit Equivalent',
      dspBitDepth: '32-bit Float DSP',
      channels,
      source: 'YouTube Innertube Stream',
      isHighBitrate,
      isLossless: false,
      container,
      verified: Boolean(this.lastStreamFormat),
    }
  }

  public takeQueueOwnership(owner: string, token?: string): string {
    return this.queueManager.takeOwnership(owner, token)
  }

  public revokeQueueOwnership(reason?: string): void {
    this.queueManager.revokeOwnership(reason)
  }

  public getQueueOwnership(): { owner: string | null; token: string | null; isOwned: boolean } {
    return this.queueManager.getOwnership()
  }

  public snapshotQueue(owner?: string, token?: string): QueueSnapshot {
    const time = this.deckController.getCurrentTime()
    return this.queueManager.snapshotQueue(time, owner, token)
  }

  public async restoreQueue(
    snapshot: QueueSnapshot,
    resume = true,
    options?: RestoreQueueOptions,
  ): Promise<boolean> {
    const track = this.queueManager.restoreQueue(snapshot, options)
    if (!track && snapshot.currentTrack) {
      // Ownership check blocked the restore
      return false
    }
    this.emit('queueChange')

    if (track) {
      await this.loadAndPlayTrack(track, resume)
      if (snapshot.currentTime > 0) {
        this.seek(snapshot.currentTime)
      }
    }
    return true
  }

  public setPauseAtEndOfItems(enable: boolean): void {
    this.queueManager.setPauseAtEndOfItems(enable)
  }

  public getContinuationState(): Readonly<ContinuationPagingState> {
    return this.queueManager.getContinuationState()
  }

  public getVisualizerData(): Uint8Array<ArrayBuffer> {
    return this.graph.getFrequencyData()
  }

  public getFrequencyData(outputArray?: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    return this.graph.getFrequencyData(outputArray)
  }

  public getBeatEnergy(): number {
    return this.graph.getBeatEnergy()
  }

  public destroy(): void {
    if (this.sleepTimerInterval !== null) {
      window.clearInterval(this.sleepTimerInterval)
      this.sleepTimerInterval = null
    }

    if (this.userInteractionCleanup) {
      this.userInteractionCleanup()
      this.userInteractionCleanup = null
    }

    if (this.radioAbortController) {
      this.radioAbortController.abort()
      this.radioAbortController = null
    }
    this.isFetchingRadioContinuation = false
    this.inFlightRadioVideoId = null

    this.sponsorBlock.destroy()
    this.mediaSession.destroy()
    this.deckController.destroy()
    this.graph.destroy()
    this.listeners.clear()
    this.eventHandlers.clear()
    for (const url of this.objectUrls) {
      URL.revokeObjectURL(url)
    }
    this.objectUrls.clear()
    this.streamCache.clear()
    AudioEngine.instance = null
  }

  private wireSubsystems(): void {
    this.sponsorBlock.attachPlayer(
      () => this.deckController.getCurrentTime(),
      (seconds) => this.seek(seconds),
    )

    this.sponsorBlock.onSegmentSkipped = (seg: SponsorSegment) => {
      this.emit('segmentSkip', seg)
    }

    castService.subscribe((connected) => {
      if (connected) {
        const current = this.queueManager.currentTrack
        if (current) {
          const currentTime = this.getCurrentTime()
          void this.resolveStreamInfo(current)
            .then((streamInfo) => {
              void castService.castTrack(
                current,
                streamInfo.url,
                currentTime,
                streamInfo.mimeType,
              )
              this.deckController.pause()
              this.emitState()
            })
            .catch(() => {})
        }
      }
    })

    this.deckController.onPlaybackStateChange = (state: PlaybackState) => {
      this.emit('playbackStateChange', state)
      if (state === 'PLAYING') {
        this.mediaSession.updatePlaybackState('playing')
      } else if (state === 'PAUSED' || state === 'IDLE' || state === 'ENDED') {
        this.mediaSession.updatePlaybackState('paused')
      }
      this.emitState()

      const current = this.queueManager.currentTrack
      const prefs = useEchoStore.getState().preferences
      if (current && prefs.discordRpc) {
        if (state === 'PLAYING') {
          void updateDiscordPresence(current, true, this.deckController.getCurrentTime())
        } else if (state === 'PAUSED') {
          void updateDiscordPresence(current, false, this.deckController.getCurrentTime())
        }
      }
    }

    this.deckController.onTimeUpdate = (current, duration) => {
      this.emit('timeUpdate', current, duration)
      this.mediaSession.updatePositionState(duration, current)
      this.emitState()

      const currentTrack = this.queueManager.currentTrack
      if (!currentTrack) return
      const prefs = useEchoStore.getState().preferences

      // True Loudness normalization measurement (first 5s)
      if (prefs.volumeNormalization && !this.loudnessMeasured && current > 0.5 && current < 5.0) {
        const rms = this.graph.calculateRMS()
        if (rms > 0.005) {
          this.loudnessMeasured = true
          this.graph.setTrackLoudnessTarget(currentTrack.id, rms)
        }
      }

      // Silence skipping (leading silence under 3s)
      if (prefs.skipSilence && current < 2.5 && this.graph.isSilent()) {
        this.seek(Math.min(current + 0.5, 3.0))
      }

      // Last.fm Scrobble rule: play 50% or 240 seconds, whichever comes first
      if (
        !this.lastFmScrobbled &&
        prefs.lastfmScrobbling &&
        prefs.lastfmSession?.sessionKey &&
        duration > 30 &&
        (current >= 240 || (duration > 0 && current / duration >= 0.5))
      ) {
        this.lastFmScrobbled = true
        void scrobbleLastFmTrack(currentTrack, prefs.lastfmSession.sessionKey)
      }

      // Podcast progress persistence (throttled 5s)
      const now = Date.now()
      if (now - this.lastPodcastSaveMs >= 5000 && duration > 0) {
        this.lastPodcastSaveMs = now
        const isPodcast = Boolean(
          currentTrack.isPodcast ||
          (currentTrack.durationSeconds && currentTrack.durationSeconds > 600) ||
          (currentTrack.durationMs && currentTrack.durationMs > 600000) ||
          currentTrack.albumTitle?.toLowerCase().includes('podcast'),
        )
        if (isPodcast) {
          const episodeId = currentTrack.videoId || currentTrack.id
          const posSec = Math.round(current)
          const durSec = Math.round(duration)
          const posMs = Math.round(current * 1000)
          const durMs = Math.round(duration * 1000)
          void db.podcastProgress
            .put({
              episodeId,
              showTitle: currentTrack.artistName || 'Podcast',
              episodeTitle: currentTrack.title || 'Episode',
              artworkUrl: currentTrack.artwork || currentTrack.thumbnailUrl,
              positionSeconds: posSec,
              durationSeconds: durSec,
              positionMs: posMs,
              durationMs: durMs,
              completed: durMs > 0 && posMs / durMs >= 0.95,
              dismissed: false,
              updatedAt: now,
            })
            .catch(() => {})
        }
      }
    }

    this.deckController.onBufferedUpdate = (buffered) => {
      this.emit('bufferedUpdate', buffered)
    }

    this.deckController.onTrackEnded = () => {
      this.consecutiveErrorCount = 0
      this.recordCurrentTrackTransition(true)

      const prefs = useEchoStore.getState().preferences
      if (prefs.discordRpc) {
        void clearDiscordPresence()
      }

      if (this.sleepTimerEndOfTrack) {
        this.pause()
        this.cancelSleepTimer()
        return
      }

      void this.next()
    }

    this.deckController.onPrebufferNeeded = () => {
      void this.handlePrebuffer()
    }

    this.deckController.onCrossfadeStart = (_fromDeck: DeckId, toDeck: DeckId) => {
      const standbyTrack = this.deckController.getStandbyTrack()
      const { promoted, rollback } = this.queueManager.promoteStandbyTrack(standbyTrack)
      this.crossfadeRollback = rollback
      this.queueManager.setActiveDeck(toDeck)
      const currentTrack = promoted ?? standbyTrack
      if (currentTrack) {
        this.mediaSession.updateTrack(currentTrack)
        this.emit('trackChange', currentTrack)
      }
      this.emit('deckSwap', toDeck)
      this.emit('queueChange')
      this.emitState()
    }

    this.deckController.onCrossfadeFailed = (fromDeck: DeckId, _toDeck: DeckId, _error: Error) => {
      if (this.crossfadeRollback) {
        this.crossfadeRollback()
        this.crossfadeRollback = null
      }
      this.queueManager.setActiveDeck(fromDeck)
      const restoredTrack = this.queueManager.currentTrack
      if (restoredTrack) {
        this.mediaSession.updateTrack(restoredTrack)
        this.emit('trackChange', restoredTrack)
      }
      this.emit('deckSwap', fromDeck)
      this.emit('queueChange')
      this.emitState()
    }

    this.deckController.onCrossfadeCancelled = (fromDeck: DeckId, _toDeck: DeckId) => {
      if (this.crossfadeRollback) {
        this.crossfadeRollback()
        this.crossfadeRollback = null
      }
      this.queueManager.setActiveDeck(fromDeck)
      const restoredTrack = this.queueManager.currentTrack
      if (restoredTrack) {
        this.mediaSession.updateTrack(restoredTrack)
        this.emit('trackChange', restoredTrack)
      }
      this.emit('deckSwap', fromDeck)
      this.emit('queueChange')
      this.emitState()
    }

    this.deckController.onCrossfadeComplete = (newActiveDeck: DeckId) => {
      this.queueManager.commitPromotion()
      this.crossfadeRollback = null
      this.queueManager.setActiveDeck(newActiveDeck)
      const currentTrack = this.queueManager.currentTrack
      if (currentTrack) {
        this.mediaSession.updateTrack(currentTrack)
        this.emit('trackChange', currentTrack)
      }
      this.emit('deckSwap', newActiveDeck)
      this.emitState()
    }

    this.deckController.onGaplessTransition = (_fromDeck: DeckId, toDeck: DeckId) => {
      const standbyTrack = this.deckController.getActiveTrack()
      this.queueManager.promoteStandbyTrack(standbyTrack)
      this.queueManager.commitPromotion()
      this.queueManager.setActiveDeck(toDeck)
      if (standbyTrack) {
        this.mediaSession.updateTrack(standbyTrack)
        this.emit('trackChange', standbyTrack)
      }
      this.emit('deckSwap', toDeck)
      this.emit('queueChange')
      this.emitState()
      void this.handlePrebuffer()
    }

    this.deckController.onError = (error) => {
      this.lastErrorMessage = error.message
      this.metrics.errorsCaughtCount++
      const current = this.queueManager.currentTrack
      if (current) {
        this.streamCache.delete(current.id)
        current.streamUrl = undefined
      }
      this.emit('error', error)
      this.emitState()

      // One retry with a fresh resolve; a second failure skips to the next track so a dead
      // source cannot stall the queue.
      this.consecutiveErrorCount++
      if (this.consecutiveErrorCount >= 2) {
        this.consecutiveErrorCount = 0
        void this.next()
      } else if (current) {
        void this.loadAndPlayTrack(current)
      }
    }
  }

  public recordCurrentTrackTransition(isAutoEnd = false): void {
    if (this.currentTrackRecorded) return
    const current = this.queueManager.currentTrack
    if (!current) return

    const durationSeconds = this.deckController.getDuration() || (current.durationSeconds ?? 0)
    const durationPlayedMs = Math.round(this.deckController.getCurrentTime() * 1000)
    const trackDurationMs = Math.round(durationSeconds * 1000) || 180000

    // Only record if at least 1000ms was played or it is an auto-end
    if (!isAutoEnd && durationPlayedMs < 1000) {
      return
    }

    const completionRatio = trackDurationMs > 0 ? durationPlayedMs / trackDurationMs : 0
    const isCompleted = isAutoEnd || completionRatio >= 0.85
    const isSkipped = !isCompleted

    this.currentTrackRecorded = true

    void recordListeningEvent({
      track: current,
      durationPlayedMs,
      trackDurationMs,
      completed: isCompleted,
      skipped: isSkipped,
    })

    if (isCompleted) {
      const episodeId = current.videoId || current.id
      if (episodeId && typeof indexedDB !== 'undefined') {
        void db.podcastProgress
          .update(episodeId, {
            completed: true,
            updatedAt: Date.now(),
          })
          .catch(() => {})
      }
    }
  }

  private async loadAndPlayTrack(track: Track, autoPlay = true): Promise<void> {
    this.crossfadeRollback = null
    const current = this.queueManager.currentTrack
    if (!this.currentTrackRecorded && current && current.id !== track.id) {
      this.recordCurrentTrackTransition(false)
    }
    this.currentTrackRecorded = false

    const requestId = ++this.currentLoadRequestId
    this.mediaSession.updateTrack(track)
    this.emit('trackChange', track)

    const streamInfo = await this.resolveStreamInfo(track)
    if (requestId !== this.currentLoadRequestId) {
      return
    }

    if (castService.getIsConnected()) {
      this.deckController.pause()
      await castService.castTrack(track, streamInfo.url, 0, streamInfo.mimeType)
      this.consecutiveErrorCount = 0
      this.lastFmScrobbled = false
      this.loudnessMeasured = false
      this.emitState()
      return
    }

    await this.deckController.loadActive(track, streamInfo.url, autoPlay)
    if (requestId !== this.currentLoadRequestId) {
      return
    }

    this.consecutiveErrorCount = 0
    this.lastFmScrobbled = false
    this.loudnessMeasured = false

    this.queueManager.setActiveDeck(this.deckController.activeDeck)

    const prefs = useEchoStore.getState().preferences

    // Last.fm Now Playing update
    if (prefs.lastfmScrobbling && prefs.lastfmSession?.sessionKey) {
      void updateLastFmNowPlaying(track, prefs.lastfmSession.sessionKey)
    }

    // Discord Rich Presence update
    if (prefs.discordRpc) {
      void updateDiscordPresence(track, autoPlay, 0)
    }

    // Podcast position resume check
    const episodeId = track.videoId || track.id
    if (episodeId) {
      try {
        const progress = await db.podcastProgress.get(episodeId)
        if (progress && !progress.completed) {
          const posSec = progress.positionSeconds ?? (progress.positionMs ? progress.positionMs / 1000 : 0)
          const durSec = progress.durationSeconds ?? (progress.durationMs ? progress.durationMs / 1000 : 0)
          if (posSec > 5 && durSec > 0 && posSec / durSec < 0.95) {
            this.seek(posSec)
          }
        }
      } catch {
        // Non-fatal
      }
    }

    if (track.sponsorBlockSegments && track.sponsorBlockSegments.length > 0) {
      this.sponsorBlock.setManualSegments(
        track.sponsorBlockSegments.map((s) => ({
          category: 'music_offtopic',
          start: s.start,
          end: s.end,
        })),
      )
    } else {
      const vid = track.videoId || track.id
      if (vid && /^[a-zA-Z0-9_-]{11}$/.test(vid)) {
        void this.sponsorBlock.loadSegmentsForVideo(vid)
      }
    }

    this.lastErrorMessage = null
    this.metrics.tracksLoadedCount++
    this.emitState()
  }

  /**
   * Evaluates whether Data Saver is active from user preference or browser network policy.
   */
  public isDataSaverActive(): boolean {
    return isDataSaverActive()
  }

  /**
   * Evaluates whether the client is currently connected over a metered/cellular network.
   */
  public isMeteredConnection(): boolean {
    return isMeteredConnection()
  }

  /**
   * Evaluates the effective streaming audio quality ceiling under live network conditions.
   */
  public getEffectiveAudioQuality(): import('../types/domain.ts').AudioQuality {
    return getEffectiveAudioQuality(useEchoStore.getState().preferences)
  }

  private async handlePrebuffer(): Promise<void> {
    if (this.isDataSaverActive()) {
      // Data Saver suspends background track preloading to minimize network/bandwidth usage
      return
    }

    const nextTrack = this.queueManager.peekNext()
    if (!nextTrack) {
      this.checkAutoRadio()
      return
    }

    // Preload extension stream for nextTrack in background without duplicating queue resolution
    const prefs = useEchoStore.getState().preferences
    if (prefs.extensionSourcePriority !== 'youtube-first' && extensionManager.hasEnabledAddons()) {
      void extensionManager.preloadExtensionStream(nextTrack).catch(() => {})
    }

    try {
      const streamUrl = await this.resolveStreamUrl(nextTrack)
      this.deckController.prebufferStandby(nextTrack, streamUrl)
    } catch {
      // Prebuffer failure is non-fatal
    }
  }

  private createObjectUrl(blob: Blob): string {
    const url = URL.createObjectURL(blob)
    this.objectUrls.add(url)
    // Keep the registry bounded: revoke the oldest URL if it grows past twice the stream
    // cache cap (a URL may still be attached to the active deck after its cache entry goes).
    if (this.objectUrls.size > AudioEngine.STREAM_CACHE_MAX * 2) {
      for (const old of this.objectUrls) {
        this.objectUrls.delete(old)
        URL.revokeObjectURL(old)
        break
      }
    }
    return url
  }

  private isUrlExpired(url: string): boolean {
    try {
      const match = /[?&]expire=(\d+)/i.exec(url)
      if (match?.[1]) {
        const expireSeconds = Number.parseInt(match[1], 10)
        if (Number.isFinite(expireSeconds) && Date.now() / 1000 >= expireSeconds - 30) {
          return true
        }
      }
    } catch {
      // Ignore URL parsing errors
    }
    return false
  }

  private async resolveStreamInfo(track: Track): Promise<{ url: string; mimeType?: string | undefined }> {
    if (track.streamUrl && !this.isUrlExpired(track.streamUrl)) {
      const cached = this.streamCache.get(track.id)
      return {
        url: track.streamUrl,
        mimeType: cached?.mimeType,
      }
    }

    // Check offline storage: local imported files
    if (track.id.startsWith('local_')) {
      const localRec = await db.localFiles.get(track.id)
      if (localRec?.audioBlob) {
        const objectUrl = this.createObjectUrl(localRec.audioBlob)
        track.streamUrl = objectUrl
        const mimeType = localRec.mimeType || localRec.audioBlob.type || undefined
        const streamInfo = { url: objectUrl, mimeType }
        this.streamCache.set(track.id, streamInfo)
        return streamInfo
      }
    }

    const cached = this.streamCache.get(track.id)
    if (cached && !this.isUrlExpired(cached.url)) {
      // LRU refresh
      this.streamCache.delete(track.id)
      this.streamCache.set(track.id, cached)
      track.streamUrl = cached.url
      return cached
    }

    const prefs = useEchoStore.getState().preferences
    const isExtensionFirst =
      prefs.extensionSourcePriority !== 'youtube-first' && prefs.preferExtensionAudio !== false
    const effectiveQuality = getEffectiveAudioQuality(prefs)

    // Attempt custom extension audio provider resolution when extension-first is enabled
    // and network quality tier permits (non-low)
    if (isExtensionFirst && effectiveQuality !== 'low' && extensionManager.hasEnabledAddons()) {
      try {
        const extStream = await extensionManager.resolveTrackExtension(track)
        if (extStream?.streamUrl) {
          this.activeExtensionStream = extStream
          const streamInfo = { url: extStream.streamUrl, mimeType: extStream.mimeType }
          this.streamCache.set(track.id, streamInfo)
          track.streamUrl = extStream.streamUrl
          return streamInfo
        }
      } catch {
        // Fall back seamlessly to YouTube resolution
      }
    }

    const videoId = track.videoId || track.id
    if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      try {
        // Uses effective quality tier reflecting Wi-Fi vs metered/cellular ceilings and data saver policies
        const res = await fetch(
          `/api/stream/resolve?videoId=${encodeURIComponent(videoId)}&quality=${encodeURIComponent(effectiveQuality)}`,
        )
        if (res.ok) {
          const data = (await res.json()) as StreamResolutionResult
          if (data.streamUrl) {
            this.activeExtensionStream = null
            this.lastStreamFormat = data.format
            const mimeType =
              data.format.mimeType?.split(';')[0]?.trim() || data.format.mimeType || undefined
            const streamInfo = { url: data.streamUrl, mimeType }
            this.streamCache.set(track.id, streamInfo)
            if (this.streamCache.size > AudioEngine.STREAM_CACHE_MAX) {
              const oldest = this.streamCache.keys().next().value
              if (oldest !== undefined) this.streamCache.delete(oldest)
            }
            track.streamUrl = data.streamUrl
            if (data.durationMs && !track.durationMs) {
              track.durationMs = data.durationMs
            }
            return streamInfo
          }
        }
      } catch (err) {
        if (!isExtensionFirst && !this.isDataSaverActive() && extensionManager.hasEnabledAddons()) {
          try {
            const extStream = await extensionManager.resolveTrackExtension(track)
            if (extStream?.streamUrl) {
              this.activeExtensionStream = extStream
              const streamInfo = { url: extStream.streamUrl, mimeType: extStream.mimeType }
              this.streamCache.set(track.id, streamInfo)
              track.streamUrl = extStream.streamUrl
              return streamInfo
            }
          } catch {}
        }
        throw new Error(
          `Failed to resolve live audio stream for "${track.title}": ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    if (!isExtensionFirst && !this.isDataSaverActive() && extensionManager.hasEnabledAddons()) {
      try {
        const extStream = await extensionManager.resolveTrackExtension(track)
        if (extStream?.streamUrl) {
          this.activeExtensionStream = extStream
          const streamInfo = { url: extStream.streamUrl, mimeType: extStream.mimeType }
          this.streamCache.set(track.id, streamInfo)
          track.streamUrl = extStream.streamUrl
          return streamInfo
        }
      } catch {}
    }

    throw new Error(
      `Could not resolve stream URL for track "${track.title}" (ID: ${track.id}). Network stream resolution is required.`,
    )
  }

  private async resolveStreamUrl(track: Track): Promise<string> {
    const info = await this.resolveStreamInfo(track)
    return info.url
  }

  private checkAutoRadio(): void {
    if (!this.autoRadioEnabled || this.isFetchingRadioContinuation) return
    // Under Data Saver / constrained network policy, suspend speculative background queue prefetching
    if (this.isDataSaverActive()) return

    const current = this.queueManager.currentTrack
    if (!current) return

    const upNext = this.queueManager.upNext
    const radioQueue = this.queueManager.radioQueue
    const continuationState = this.queueManager.getContinuationState()

    if (upNext.length === 0 && radioQueue.length < 3 && continuationState.hasMore) {
      void this.fetchRadioContinuation(current.videoId || current.id)
    }
  }

  private async fetchRadioContinuation(videoId: string): Promise<void> {
    if (this.isFetchingRadioContinuation && this.inFlightRadioVideoId === videoId) return
    if (!videoId) return

    // Cancel prior fetch if videoId changed
    if (this.radioAbortController) {
      this.radioAbortController.abort()
      this.radioAbortController = null
    }

    const abortController = new AbortController()
    this.radioAbortController = abortController
    this.isFetchingRadioContinuation = true
    this.inFlightRadioVideoId = videoId

    try {
      const prefs = useEchoStore.getState().preferences
      const region = prefs.contentRegion || 'US'
      const showExplicit = prefs.showExplicit ?? true
      const continuationState = this.queueManager.getContinuationState()
      const token = continuationState.continuationToken

      const queryParams = new URLSearchParams()
      if (token) {
        queryParams.set('continuation', token)
      } else {
        queryParams.set('videoId', videoId)
      }
      queryParams.set('gl', region)
      queryParams.set('explicit', String(showExplicit))

      const res = await fetch(
        `/api/radio/continuation?${queryParams.toString()}`,
        { signal: abortController.signal },
      )
      if (res.ok) {
        const data = (await res.json()) as { tracks: Track[]; continuationToken?: string }
        if (Array.isArray(data.tracks) && data.tracks.length > 0) {
          const filtered = showExplicit ? data.tracks : data.tracks.filter((t) => !t.explicit)
          if (filtered.length > 0) {
            this.queueManager.addRadioTracks(filtered, data.continuationToken ?? null)
            this.emit('queueChange')
            this.emitState()
          } else if (data.continuationToken) {
            this.queueManager.setContinuationToken(data.continuationToken, true)
          }
        } else if (data.continuationToken) {
          this.queueManager.setContinuationToken(data.continuationToken, true)
        } else {
          this.queueManager.setContinuationToken(null, false)
        }
      }
    } catch {
      // Radio continuation fetch failures are non-fatal
    } finally {
      if (this.inFlightRadioVideoId === videoId) {
        this.isFetchingRadioContinuation = false
        this.inFlightRadioVideoId = null
      }
      if (this.radioAbortController === abortController) {
        this.radioAbortController = null
      }
    }
  }

  private setupUserInteractionListener(): void {
    const resumeContext = () => {
      void this.graph.resume()
      if (this.deckController.state === 'REQUIRES_USER_INTERACTION') {
        void this.deckController.play()
      }
    }

    window.addEventListener('pointerdown', resumeContext, { passive: true })
    window.addEventListener('keydown', resumeContext, { passive: true })

    this.userInteractionCleanup = () => {
      window.removeEventListener('pointerdown', resumeContext)
      window.removeEventListener('keydown', resumeContext)
    }
  }

  private emit<K extends AudioEngineEvent>(
    event: K,
    ...args: Parameters<AudioEngineEventMap[K]>
  ): void {
    this.metrics.eventsEmittedCount++
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      for (const handler of handlers) {
        handler(...args)
      }
    }
  }

  private emitState(): void {
    this.stateVersion++
    this.metrics.stateEmissionsCount++
    const state = this.getState()
    for (const listener of this.listeners) {
      listener(state)
    }
  }
}
