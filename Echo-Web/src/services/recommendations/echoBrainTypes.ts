import { z } from 'zod'
import { TrackSchema } from '../../engine/QueueManager.ts'
import type { Track } from '../../types/audio.ts'

export type SessionMomentumState = 'focused' | 'exploring' | 'restless' | 'neutral'

export const momentumSignalSchema = z.object({
  trackId: z.string().min(1),
  trackTitle: z.string().min(1),
  artistName: z.string().min(1),
  artistId: z.string().optional(),
  completed: z.boolean(),
  skipped: z.boolean(),
  durationPlayedMs: z.number().nonnegative(),
  trackDurationMs: z.number().nonnegative(),
  liked: z.boolean().default(false),
  timestamp: z.number().positive(),
})

export type MomentumSignal = z.infer<typeof momentumSignalSchema>

export const sessionMomentumContextSchema = z.object({
  recentSignals: z.array(momentumSignalSchema),
  currentTrack: TrackSchema.nullable().optional(),
  likedTrackIds: z.array(z.string()).default([]),
  excludedTrackIds: z.array(z.string()).default([]),
})

export type SessionMomentumContext = {
  recentSignals: MomentumSignal[]
  currentTrack?: Track | null | undefined
  likedTrackIds: string[]
  excludedTrackIds: string[]
}

export const echoBrainTelemetrySchema = z.object({
  momentumEvaluations: z.number().nonnegative(),
  momentumInjections: z.number().nonnegative(),
  skipsDetected: z.number().nonnegative(),
  completionsDetected: z.number().nonnegative(),
  recoveryTriggers: z.number().nonnegative(),
  lastMomentumState: z.enum(['focused', 'exploring', 'restless', 'neutral']),
  lastGeneratedCount: z.number().nonnegative(),
  lastDurationMs: z.number().nonnegative(),
})

export type EchoBrainTelemetry = z.infer<typeof echoBrainTelemetrySchema>

export interface EchoBrainOptions {
  momentumWindowSize?: number
  targetQueueSize?: number
  enableAutoInjection?: boolean
}
