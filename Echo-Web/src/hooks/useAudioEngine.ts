import { useEffect, useState } from 'react'
import { AudioEngine } from '../engine/AudioEngine.ts'
import type { AudioEngineState, CrossfadeProfile, RepeatMode, Track } from '../types/audio.ts'
import { getCachedTrack, useEchoStore } from '../stores/useEchoStore.ts'

export const audioEngineActions = {
  play: (track?: Track) => AudioEngine.getInstance().play(track),
  playQueue: (tracks: Track[], startIndex = 0) => {
    if (!Array.isArray(tracks) || tracks.length === 0) return
    const clampedIndex = Math.max(0, Math.min(startIndex, tracks.length - 1))
    AudioEngine.getInstance().playQueue(tracks, clampedIndex)
  },
  pause: () => AudioEngine.getInstance().pause(),
  togglePlayback: () => AudioEngine.getInstance().togglePlayback(),
  next: () => AudioEngine.getInstance().next(),
  previous: () => AudioEngine.getInstance().previous(),
  seek: (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return
    AudioEngine.getInstance().seek(seconds)
  },
  seekTo: (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return
    AudioEngine.getInstance().seekTo(seconds)
  },
  getCurrentTime: () => AudioEngine.getInstance().getCurrentTime(),
  playNext: (track: Track) => AudioEngine.getInstance().playNext(track),
  addToQueue: (track: Track) => AudioEngine.getInstance().addToQueue(track),
  removeFromQueue: (index: number) => AudioEngine.getInstance().removeFromQueue(index),
  moveQueueItem: (from: number, to: number) => AudioEngine.getInstance().moveQueueItem(from, to),
  removeSourceQueueItem: (index: number) => AudioEngine.getInstance().removeSourceQueueItem(index),
  moveSourceQueueItem: (from: number, to: number) => AudioEngine.getInstance().moveSourceQueueItem(from, to),
  clearQueue: () => AudioEngine.getInstance().clearQueue(),
  clearSourceUpcoming: () => AudioEngine.getInstance().clearSourceUpcoming(),
  clearEntireQueue: () => AudioEngine.getInstance().clearEntireQueue(),
  clearHistory: () => AudioEngine.getInstance().clearHistory(),
  getDetailedQueue: () => AudioEngine.getInstance().getDetailedQueue(),
  setVolume: (volume: number) => {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.5))
    AudioEngine.getInstance().setVolume(clamped)
  },
  setMuted: (muted: boolean) => AudioEngine.getInstance().setMuted(muted),
  setShuffle: (shuffle: boolean) => AudioEngine.getInstance().setShuffle(shuffle),
  setRepeatMode: (mode: RepeatMode) => AudioEngine.getInstance().setRepeatMode(mode),
  setCrossfadeDuration: (seconds: number) => {
    const clamped = Math.max(0, Math.min(12, Number.isFinite(seconds) ? seconds : 3))
    AudioEngine.getInstance().setCrossfadeDuration(clamped)
  },
  setVolumeNormalization: (enabled: boolean) => AudioEngine.getInstance().setVolumeNormalization(enabled),
  setStereoWidth: (width: number) => {
    const clamped = Math.max(0, Math.min(2, Number.isFinite(width) ? width : 1))
    AudioEngine.getInstance().setStereoWidth(clamped)
  },
  setEqualizerGain: (band: number, gainDb: number) => AudioEngine.getInstance().setEqualizerGain(band, gainDb),
  setEqualizerBands: (gains: number[]) => AudioEngine.getInstance().setEqualizerBands(gains),
  setEqualizerPreset: (name: string) => AudioEngine.getInstance().setEqualizerPreset(name),
  resetEqualizer: () => AudioEngine.getInstance().resetEqualizer(),
  snapshotQueue: () => AudioEngine.getInstance().snapshotQueue(),
  restoreQueue: (
    snapshot: Parameters<ReturnType<typeof AudioEngine.getInstance>['restoreQueue']>[0],
    resume?: boolean,
  ) => AudioEngine.getInstance().restoreQueue(snapshot, resume),
  setPauseAtEndOfItems: (enable: boolean) => AudioEngine.getInstance().setPauseAtEndOfItems(enable),
  getVisualizerData: () => AudioEngine.getInstance().getVisualizerData(),
  getFrequencyData: (outputArray?: Uint8Array<ArrayBuffer>) =>
    AudioEngine.getInstance().getFrequencyData(outputArray),
  getBeatEnergy: () => AudioEngine.getInstance().getBeatEnergy(),
  startSleepTimer: (minutesOrOption: number | 'end_of_track') =>
    AudioEngine.getInstance().startSleepTimer(minutesOrOption),
  cancelSleepTimer: () => AudioEngine.getInstance().cancelSleepTimer(),
  setPlaybackRate: (rate: number) => {
    const clamped = Math.max(0.5, Math.min(2.0, Number.isFinite(rate) ? rate : 1.0))
    AudioEngine.getInstance().setPlaybackRate(clamped)
  },
  setAudioOutput: (sinkId: string) => AudioEngine.getInstance().setAudioOutput(sinkId),
  getAudioOutput: () => AudioEngine.getInstance().getAudioOutput(),
  getAudioTelemetry: () => AudioEngine.getInstance().getAudioTelemetry(),
  setGaplessPlayback: (enabled: boolean) => AudioEngine.getInstance().setGaplessPlayback(enabled),
  setCrossfadeProfile: (profile: CrossfadeProfile) =>
    AudioEngine.getInstance().setCrossfadeProfile(profile),
}

export function useAudioEngine() {
  const engine = AudioEngine.getInstance()
  const [state, setState] = useState<AudioEngineState>(() => engine.getState())

  useEffect(() => {
    const unsubscribe = engine.subscribe((updatedState) => {
      setState(updatedState)
    })
    return () => {
      unsubscribe()
    }
  }, [engine])

  return {
    engine,
    state,
    isPlaying: state.playbackState === 'PLAYING',
    isBuffering: state.playbackState === 'BUFFERING',
    currentTrack: state.currentTrack,
    currentTime: state.currentTime,
    duration: state.duration,
    bufferedTime: state.bufferedTime,
    volume: state.volume,
    muted: state.muted,
    repeatMode: state.repeatMode,
    isShuffle: state.isShuffle,
    activeDeck: state.activeDeck,
    upNext: state.upNext,
    sourceQueue: state.sourceQueue,
    sourceUpcoming: state.sourceUpcoming,
    history: state.history,
    radioQueue: state.radioQueue,
    stereoWidth: state.stereoWidth,
    volumeNormalization: state.volumeNormalization,
    crossfadeDuration: state.crossfadeDuration,
    crossfadeProfile: state.crossfadeProfile ?? 'equalPower',
    gaplessPlayback: state.gaplessPlayback ?? true,
    equalizerGains: state.equalizerGains,
    playbackRate: state.playbackRate ?? 1.0,
    sleepTimerRemaining: state.sleepTimerRemaining,
    sleepTimerEndOfTrack: state.sleepTimerEndOfTrack,
    audioSinkId: state.audioSinkId ?? 'default',
    ...audioEngineActions,
  }
}

export interface BridgeMetrics {
  syncCount: number
  storeToEngineCount: number
  engineToStoreCount: number
  suppressedCyclesCount: number
  lastSyncDurationMs: number
}

const bridgeMetrics: BridgeMetrics = {
  syncCount: 0,
  storeToEngineCount: 0,
  engineToStoreCount: 0,
  suppressedCyclesCount: 0,
  lastSyncDurationMs: 0,
}

export function getBridgeMetrics(): Readonly<BridgeMetrics> {
  return { ...bridgeMetrics }
}

export function bridgeAudioEngineWithStore(): () => void {
  const engine = AudioEngine.getInstance()
  const echoStore = useEchoStore.getState()

  let isUpdatingFromEngine = false
  let isUpdatingFromStore = false

  const initialRepeat =
    echoStore.preferences.repeat === 'all'
      ? 'ALL'
      : echoStore.preferences.repeat === 'one'
        ? 'ONE'
        : 'OFF'

  engine.setRepeatMode(initialRepeat)
  engine.setShuffle(echoStore.preferences.shuffle)
  engine.setVolume(echoStore.preferences.volume / 100)
  engine.setMuted(echoStore.preferences.muted)
  engine.setVolumeNormalization(echoStore.preferences.volumeNormalization)
  if (typeof echoStore.preferences.crossfadeDuration === 'number') {
    engine.setCrossfadeDuration(echoStore.preferences.crossfadeDuration)
  }
  if (typeof echoStore.preferences.gaplessPlayback === 'boolean') {
    engine.setGaplessPlayback(echoStore.preferences.gaplessPlayback)
  }

  const startingTrack = echoStore.currentTrack || getCachedTrack(echoStore.currentTrackId)
  if (startingTrack && !engine.getState().currentTrack) {
    const queueTracks = echoStore.queueIds
      .map((id) => getCachedTrack(id))
      .filter((t): t is Track => Boolean(t))
    engine.setQueue([startingTrack, ...queueTracks], 0)
  }

  // Engine -> Store subscription
  const unsubscribeEngine = engine.subscribe((engineState) => {
    if (isUpdatingFromStore) {
      bridgeMetrics.suppressedCyclesCount++
      return
    }
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now()
    isUpdatingFromEngine = true
    try {
      const currentStore = useEchoStore.getState()

      if (engineState.currentTrack && engineState.currentTrack.id !== currentStore.currentTrackId) {
        useEchoStore.setState({
          currentTrack: engineState.currentTrack,
          currentTrackId: engineState.currentTrack.id,
        })
      }

      const isPlaying = engineState.playbackState === 'PLAYING'
      if (isPlaying !== currentStore.isPlaying) {
        useEchoStore.setState({ isPlaying })
      }

      const upNextIds = engineState.upNext.map((t) => t.id)
      if (
        upNextIds.length !== currentStore.queueIds.length ||
        upNextIds.some((id, idx) => id !== currentStore.queueIds[idx])
      ) {
        useEchoStore.setState({ queueIds: upNextIds })
      }

      bridgeMetrics.engineToStoreCount++
      bridgeMetrics.syncCount++
      bridgeMetrics.lastSyncDurationMs =
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start
    } finally {
      isUpdatingFromEngine = false
    }
  })

  // Store -> Engine subscription for dynamic preferences
  const unsubscribeStore = useEchoStore.subscribe((state, prevState) => {
    if (isUpdatingFromEngine) {
      bridgeMetrics.suppressedCyclesCount++
      return
    }
    const currPrefs = state.preferences
    const prevPrefs = prevState?.preferences
    if (!prevPrefs) return

    const start = typeof performance !== 'undefined' ? performance.now() : Date.now()
    isUpdatingFromStore = true
    try {
      let changed = false
      if (currPrefs.repeat !== prevPrefs.repeat) {
        const rep = currPrefs.repeat === 'all' ? 'ALL' : currPrefs.repeat === 'one' ? 'ONE' : 'OFF'
        engine.setRepeatMode(rep)
        changed = true
      }
      if (currPrefs.shuffle !== prevPrefs.shuffle) {
        engine.setShuffle(currPrefs.shuffle)
        changed = true
      }
      if (currPrefs.volume !== prevPrefs.volume) {
        engine.setVolume(currPrefs.volume / 100)
        changed = true
      }
      if (currPrefs.muted !== prevPrefs.muted) {
        engine.setMuted(currPrefs.muted)
        changed = true
      }
      if (currPrefs.volumeNormalization !== prevPrefs.volumeNormalization) {
        engine.setVolumeNormalization(currPrefs.volumeNormalization)
        changed = true
      }
      if (
        currPrefs.crossfadeDuration !== prevPrefs.crossfadeDuration &&
        typeof currPrefs.crossfadeDuration === 'number'
      ) {
        engine.setCrossfadeDuration(currPrefs.crossfadeDuration)
        changed = true
      }
      if (
        currPrefs.gaplessPlayback !== prevPrefs.gaplessPlayback &&
        typeof currPrefs.gaplessPlayback === 'boolean'
      ) {
        engine.setGaplessPlayback(currPrefs.gaplessPlayback)
        changed = true
      }
      if (
        currPrefs.crossfadeProfile !== prevPrefs.crossfadeProfile &&
        currPrefs.crossfadeProfile
      ) {
        engine.setCrossfadeProfile(currPrefs.crossfadeProfile)
        changed = true
      }

      if (changed) {
        bridgeMetrics.storeToEngineCount++
        bridgeMetrics.syncCount++
        bridgeMetrics.lastSyncDurationMs =
          (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start
      }
    } finally {
      isUpdatingFromStore = false
    }
  })

  return () => {
    unsubscribeEngine()
    unsubscribeStore()
  }
}
