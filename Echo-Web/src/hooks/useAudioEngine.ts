import { useEffect, useState } from 'react'
import { AudioEngine } from '../engine/AudioEngine.ts'
import type { AudioEngineState, RepeatMode, Track } from '../types/audio.ts'
import { getCachedTrack, useEchoStore } from '../stores/useEchoStore.ts'

export const audioEngineActions = {
  play: (track?: Track) => AudioEngine.getInstance().play(track),
  playQueue: (tracks: Track[], startIndex?: number) => AudioEngine.getInstance().playQueue(tracks, startIndex),
  pause: () => AudioEngine.getInstance().pause(),
  togglePlayback: () => AudioEngine.getInstance().togglePlayback(),
  next: () => AudioEngine.getInstance().next(),
  previous: () => AudioEngine.getInstance().previous(),
  seek: (seconds: number) => AudioEngine.getInstance().seek(seconds),
  seekTo: (seconds: number) => AudioEngine.getInstance().seekTo(seconds),
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
  setVolume: (volume: number) => AudioEngine.getInstance().setVolume(volume),
  setMuted: (muted: boolean) => AudioEngine.getInstance().setMuted(muted),
  setShuffle: (shuffle: boolean) => AudioEngine.getInstance().setShuffle(shuffle),
  setRepeatMode: (mode: RepeatMode) => AudioEngine.getInstance().setRepeatMode(mode),
  setCrossfadeDuration: (seconds: number) => AudioEngine.getInstance().setCrossfadeDuration(seconds),
  setVolumeNormalization: (enabled: boolean) => AudioEngine.getInstance().setVolumeNormalization(enabled),
  setStereoWidth: (width: number) => AudioEngine.getInstance().setStereoWidth(width),
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
  setPlaybackRate: (rate: number) => AudioEngine.getInstance().setPlaybackRate(rate),
  setAudioOutput: (sinkId: string) => AudioEngine.getInstance().setAudioOutput(sinkId),
  getAudioTelemetry: () => AudioEngine.getInstance().getAudioTelemetry(),
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
    equalizerGains: state.equalizerGains,
    playbackRate: state.playbackRate ?? 1.0,
    sleepTimerRemaining: state.sleepTimerRemaining,
    sleepTimerEndOfTrack: state.sleepTimerEndOfTrack,
    ...audioEngineActions,
  }
}

export function bridgeAudioEngineWithStore(): () => void {
  const engine = AudioEngine.getInstance()
  const echoStore = useEchoStore.getState()

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

  const startingTrack = echoStore.currentTrack || getCachedTrack(echoStore.currentTrackId)
  if (startingTrack && !engine.getState().currentTrack) {
    const queueTracks = echoStore.queueIds
      .map((id) => getCachedTrack(id))
      .filter((t): t is Track => Boolean(t))
    engine.setQueue([startingTrack, ...queueTracks], 0)
  }

  const unsubscribeEngine = engine.subscribe((engineState) => {
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
  })

  return () => {
    unsubscribeEngine()
  }
}
