/**
 * Last.fm scrobbling schemas, types, and telemetry metrics.
 */

import { z } from 'zod'

export const lastFmSessionSchema = z.object({
  sessionKey: z.string().trim().min(1, 'Session key cannot be empty').max(100),
  username: z.string().trim().min(1, 'Username cannot be empty').max(100),
})

export type LastFmSession = z.infer<typeof lastFmSessionSchema>

export const lastFmTrackPayloadSchema = z.object({
  sessionKey: z.string().trim().min(1),
  track: z.string().trim().min(1, 'Track title cannot be empty').max(300),
  artist: z.string().trim().min(1, 'Artist name cannot be empty').max(300),
  album: z.string().trim().max(300).optional(),
  duration: z.number().int().nonnegative().optional(),
  timestamp: z.number().int().positive().optional(),
})

export type LastFmTrackPayload = z.infer<typeof lastFmTrackPayloadSchema>

export const lastFmMetricsSchema = z.object({
  nowPlayingUpdates: z.number().int().nonnegative(),
  scrobblesQueued: z.number().int().nonnegative(),
  scrobblesSucceeded: z.number().int().nonnegative(),
  scrobblesFailed: z.number().int().nonnegative(),
  deduplications: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
  cancellations: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
})

export type LastFmMetrics = z.infer<typeof lastFmMetricsSchema>

let metrics: LastFmMetrics = {
  nowPlayingUpdates: 0,
  scrobblesQueued: 0,
  scrobblesSucceeded: 0,
  scrobblesFailed: 0,
  deduplications: 0,
  retries: 0,
  cancellations: 0,
  errors: 0,
}

export function getLastFmMetrics(): LastFmMetrics {
  return { ...metrics }
}

export function resetLastFmMetrics(): void {
  metrics = {
    nowPlayingUpdates: 0,
    scrobblesQueued: 0,
    scrobblesSucceeded: 0,
    scrobblesFailed: 0,
    deduplications: 0,
    retries: 0,
    cancellations: 0,
    errors: 0,
  }
}

export function recordLastFmMetric(metric: keyof LastFmMetrics): void {
  metrics[metric]++
}
