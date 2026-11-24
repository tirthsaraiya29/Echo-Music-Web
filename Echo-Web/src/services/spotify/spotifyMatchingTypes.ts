/**
 * Spotify track matching runtime schemas, types, and telemetry metrics.
 */

import { z } from 'zod'
import type { Track } from '../../types/domain.ts'

export const spotifyTrackTargetSchema = z.object({
  title: z.string().trim().min(1, 'Track title cannot be empty').max(300),
  artist: z.string().trim().min(1, 'Artist name cannot be empty').max(300),
  album: z.string().trim().max(300).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  isrc: z.string().trim().max(50).optional(),
})

export type SpotifyTrackTarget = z.infer<typeof spotifyTrackTargetSchema>

export const confidenceLevelSchema = z.enum(['high', 'medium', 'low'])
export type ConfidenceLevel = z.infer<typeof confidenceLevelSchema>

export const trackMatchSchema = z.object({
  track: z.custom<Track>((val) => typeof val === 'object' && val !== null && 'id' in val && 'title' in val),
  score: z.number().min(0).max(100),
  confidence: confidenceLevelSchema,
})

export type TrackMatch = z.infer<typeof trackMatchSchema>

export const matchingBatchOptionsSchema = z.object({
  concurrency: z.number().int().min(1).max(10).default(3),
  timeoutMs: z.number().int().min(1000).max(30000).default(8000),
  minAcceptableScore: z.number().min(0).max(100).default(45),
})

export type MatchingBatchOptions = z.infer<typeof matchingBatchOptionsSchema>

export const spotifyMatchingMetricsSchema = z.object({
  matchesEvaluated: z.number().int().nonnegative(),
  highConfidenceMatches: z.number().int().nonnegative(),
  mediumConfidenceMatches: z.number().int().nonnegative(),
  lowConfidenceMatches: z.number().int().nonnegative(),
  rejectedMatches: z.number().int().nonnegative(),
  isrcExactMatches: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
  inFlightDeduplications: z.number().int().nonnegative(),
  cancellations: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
})

export type SpotifyMatchingMetrics = z.infer<typeof spotifyMatchingMetricsSchema>

let metrics: SpotifyMatchingMetrics = {
  matchesEvaluated: 0,
  highConfidenceMatches: 0,
  mediumConfidenceMatches: 0,
  lowConfidenceMatches: 0,
  rejectedMatches: 0,
  isrcExactMatches: 0,
  cacheHits: 0,
  inFlightDeduplications: 0,
  cancellations: 0,
  errors: 0,
}

export function getSpotifyMatchingMetrics(): SpotifyMatchingMetrics {
  return { ...metrics }
}

export function resetSpotifyMatchingMetrics(): void {
  metrics = {
    matchesEvaluated: 0,
    highConfidenceMatches: 0,
    mediumConfidenceMatches: 0,
    lowConfidenceMatches: 0,
    rejectedMatches: 0,
    isrcExactMatches: 0,
    cacheHits: 0,
    inFlightDeduplications: 0,
    cancellations: 0,
    errors: 0,
  }
}

export function recordSpotifyMatchingMetric(metric: keyof SpotifyMatchingMetrics): void {
  metrics[metric]++
}
