/**
 * Echo Find recognition domain types, runtime schemas, and metrics instrumentation.
 */

import { z } from 'zod'
import type { Track } from '../../types/domain.ts'

export const recognitionTrackSchema = z.object({
  id: z.string(),
  videoId: z.string().optional(),
  title: z.string().min(1),
  artistName: z.string().min(1),
  artistId: z.string().default(''),
  albumTitle: z.string().default(''),
  albumId: z.string().default(''),
  albumImage: z.string().default(''),
  durationSeconds: z.number().nonnegative().optional(),
  durationMs: z.number().nonnegative().default(0),
  artwork: z.string().default(''),
  explicit: z.boolean().default(false),
  playCount: z.number().default(0),
})

export const recognitionResultSchema = z.object({
  matched: z.boolean(),
  configured: z.boolean().optional(),
  provider: z.string().optional(),
  confidence: z.number().min(0).max(100).optional(),
  track: recognitionTrackSchema.optional(),
  message: z.string().optional(),
  guidance: z.string().optional(),
  error: z.string().optional(),
})

export interface RecognitionResult {
  matched: boolean
  configured?: boolean | undefined
  provider?: string | undefined
  confidence?: number | undefined
  track?: Track | undefined
  message?: string | undefined
  guidance?: string | undefined
  error?: string | undefined
}

export const recognitionStatusSchema = z.object({
  configured: z.boolean(),
  provider: z.string(),
  isDefault: z.boolean().optional(),
  demoAvailable: z.boolean().optional(),
  guidance: z.string(),
})

export type RecognitionStatus = z.infer<typeof recognitionStatusSchema>

export const echoFindRecordingOptionsSchema = z.object({
  durationMs: z.number().int().min(1000).max(30000).default(6000),
  timeoutMs: z.number().int().min(1000).max(60000).default(12000),
})

export type EchoFindRecordingOptions = z.infer<typeof echoFindRecordingOptionsSchema>

export const echoFindMetricsSchema = z.object({
  recordingsStarted: z.number().int().nonnegative(),
  recordingsCompleted: z.number().int().nonnegative(),
  recordingsAborted: z.number().int().nonnegative(),
  identificationsMatched: z.number().int().nonnegative(),
  identificationsFailed: z.number().int().nonnegative(),
  unconfiguredAttempts: z.number().int().nonnegative(),
  defaultProviderRequests: z.number().int().nonnegative().default(0),
  customProviderRequests: z.number().int().nonnegative().default(0),
  errors: z.number().int().nonnegative(),
})

export type EchoFindMetrics = z.infer<typeof echoFindMetricsSchema>

let metrics: EchoFindMetrics = {
  recordingsStarted: 0,
  recordingsCompleted: 0,
  recordingsAborted: 0,
  identificationsMatched: 0,
  identificationsFailed: 0,
  unconfiguredAttempts: 0,
  defaultProviderRequests: 0,
  customProviderRequests: 0,
  errors: 0,
}

export function getEchoFindMetrics(): EchoFindMetrics {
  return { ...metrics }
}

export function resetEchoFindMetrics(): void {
  metrics = {
    recordingsStarted: 0,
    recordingsCompleted: 0,
    recordingsAborted: 0,
    identificationsMatched: 0,
    identificationsFailed: 0,
    unconfiguredAttempts: 0,
    defaultProviderRequests: 0,
    customProviderRequests: 0,
    errors: 0,
  }
}

export function recordEchoFindMetric(metric: keyof EchoFindMetrics): void {
  metrics[metric]++
}

export function isReducedMotionPreferred(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
