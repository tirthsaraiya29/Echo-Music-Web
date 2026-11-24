import { z } from 'zod'
import type { Track } from './domain.ts'
export type { Track } from './domain.ts'

export const audioDeviceSchema = z.object({
  deviceId: z.string().min(1),
  label: z.string().min(1),
})

export type AudioDeviceItem = z.infer<typeof audioDeviceSchema>

export type PlaybackState =
  | 'IDLE'
  | 'BUFFERING'
  | 'PLAYING'
  | 'PAUSED'
  | 'SEEKING'
  | 'ENDED'
  | 'ERROR'
  | 'REQUIRES_USER_INTERACTION'

export type RepeatMode = 'OFF' | 'ALL' | 'ONE'

export type DeckId = 'A' | 'B'
export type CrossfadeProfile = 'equalPower' | 'linear' | 'logarithmic' | 'scurve'
export type RadioContinuationStatus = 'idle' | 'fetching' | 'retrying' | 'error' | 'exhausted'

export interface RadioContinuationMetrics {
  totalAttempts: number
  successCount: number
  retryAttempts: number
  successAfterRetryCount: number
  failureCount: number
  lastErrorReason: string | null
  lastDurationMs: number
}

export interface RadioContinuationState {
  status: RadioContinuationStatus
  attempt: number
  maxRetries: number
  nextRetryDelayMs: number | null
  lastError: string | null
  metrics: RadioContinuationMetrics
}

export interface SponsorSegment {
  category: 'music_offtopic' | 'intro' | 'outro' | 'preview' | string
  start: number
  end: number
  uuid?: string | undefined
}

export interface ContinuationPagingState {
  continuationToken: string | null
  pageIndex: number
  hasMore: boolean
  lastFetchedAt: number | null
}

export interface QueueSnapshot {
  id: string
  timestamp: number
  owner?: string | undefined
  ownerToken?: string | undefined
  continuationState?: ContinuationPagingState | undefined
  history: Track[]
  currentTrack: Track | null
  upNext: Track[]
  sourceQueue: Track[]
  radioQueue: Track[]
  shuffledSourceQueue: Track[]
  currentTime: number
  activeDeck: DeckId
  repeatMode: RepeatMode
  isShuffle: boolean
  pauseAtEndOfItems: boolean
  currentSourceIndex?: number
  activeTrackSource?: 'upNext' | 'sourceQueue' | 'radio' | 'direct' | undefined
}

export interface RestoreQueueOptions {
  ownerToken?: string | undefined
  force?: boolean | undefined
}

export type EqualizerFilterType =
  'lowpass' | 'highpass' | 'bandpass' | 'lowshelf' | 'highshelf' | 'peaking' | 'notch' | 'allpass'

export interface EqualizerBand {
  index: number
  frequency: number
  gain: number
  type: EqualizerFilterType
  q: number
}

export interface EqualizerPreset {
  name: string
  gains: number[]
}

export const bluetoothReconnectTelemetrySchema = z.object({
  deviceChangeEvents: z.number().int().nonnegative(),
  devicesConnectedCount: z.number().int().nonnegative(),
  devicesDisconnectedCount: z.number().int().nonnegative(),
  resumesTriggered: z.number().int().nonnegative(),
  resumesFailed: z.number().int().nonnegative(),
  lastReconnectedDevice: z.string().nullable(),
  lastEventTimestamp: z.number().nullable(),
})

export type BluetoothReconnectTelemetry = z.infer<typeof bluetoothReconnectTelemetrySchema>

export interface AudioEngineConfig {
  crossfadeDuration: number
  prebufferWindowMs: number
  sponsorBlockEnabled: boolean
  sponsorBlockCategories: string[]
  autoRadio: boolean
  volumeNormalization: boolean
  stereoWidth: number
}

export interface AudioEngineState {
  playbackState: PlaybackState
  currentTrack: Track | null
  currentTime: number
  duration: number
  bufferedTime: number
  volume: number
  muted: boolean
  repeatMode: RepeatMode
  isShuffle: boolean
  activeDeck: DeckId
  upNext: Track[]
  sourceQueue: Track[]
  sourceUpcoming: Track[]
  history: Track[]
  radioQueue: Track[]
  equalizerGains: number[]
  stereoWidth: number
  volumeNormalization: boolean
  crossfadeDuration: number
  crossfadeProfile?: CrossfadeProfile | undefined
  gaplessPlayback?: boolean | undefined
  varispeedEnabled?: boolean | undefined
  pitchShiftSemitones?: number | undefined
  pauseOnMute?: boolean | undefined
  bluetoothResumeEnabled?: boolean | undefined
  bluetoothTelemetry?: BluetoothReconnectTelemetry | undefined
  continuationState?: ContinuationPagingState | undefined
  radioContinuationState?: RadioContinuationState | undefined
  echoBrainTelemetry?: import('../services/recommendations/echoBrainTypes.ts').EchoBrainTelemetry | undefined
  playbackRate?: number
  sleepTimerRemaining?: number | null
  sleepTimerEndOfTrack?: boolean
  audioSinkId?: string | undefined
  isLoading?: boolean
  hasError?: boolean
  lastErrorMessage?: string | null
  stateVersion?: number
}

export type AudioEngineEventMap = {
  playbackStateChange: (state: PlaybackState) => void
  trackChange: (track: Track | null) => void
  timeUpdate: (currentTime: number, duration: number) => void
  bufferedUpdate: (bufferedTime: number) => void
  volumeChange: (volume: number, muted: boolean) => void
  queueChange: () => void
  deckSwap: (activeDeck: DeckId) => void
  segmentSkip: (segment: SponsorSegment) => void
  error: (error: Error) => void
}

export type AudioEngineEvent = keyof AudioEngineEventMap

export const verifiedStreamTelemetrySchema = z.object({
  codec: z.string().min(1),
  bitrate: z.string().min(1),
  numericBitrate: z.number().nonnegative().optional(),
  sampleRate: z.string().min(1),
  sourceSampleRate: z.string().optional(),
  outputSampleRate: z.string().min(1),
  bitDepth: z.string().min(1),
  dspBitDepth: z.string().min(1),
  channels: z.number().int().positive().default(2),
  source: z.string().min(1),
  isLossless: z.boolean(),
  isHighBitrate: z.boolean(),
  container: z.string().optional(),
  verified: z.boolean().default(true),
})

export type VerifiedStreamTelemetry = z.infer<typeof verifiedStreamTelemetrySchema>
