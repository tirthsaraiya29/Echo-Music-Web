/**
 * SponsorBlock schemas, types, and telemetry metrics.
 */

import { z } from 'zod'

export const sponsorSegmentSchema = z.object({
  category: z.string().trim().min(1).max(64),
  start: z.number().nonnegative(),
  end: z.number().positive(),
  uuid: z.string().trim().max(128).optional(),
}).refine((seg) => seg.end > seg.start, {
  message: 'Segment end time must be greater than start time',
})

export type SponsorSegment = z.infer<typeof sponsorSegmentSchema>

export const sponsorblockOptionsSchema = z.object({
  enabled: z.boolean().default(true),
  categories: z
    .array(z.string().trim().min(1).max(64))
    .default(['music_offtopic', 'intro', 'outro', 'preview']),
  pollIntervalMs: z.number().int().min(50).max(5000).default(250),
  apiBaseUrl: z.string().default('/api/sponsorblock'),
})

export type SponsorBlockOptions = z.infer<typeof sponsorblockOptionsSchema>

export const sponsorblockMetricsSchema = z.object({
  segmentsLoaded: z.number().int().nonnegative(),
  segmentsSkipped: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
  cacheMisses: z.number().int().nonnegative(),
  fetchErrors: z.number().int().nonnegative(),
  cancellations: z.number().int().nonnegative(),
})

export type SponsorBlockMetrics = z.infer<typeof sponsorblockMetricsSchema>

let metrics: SponsorBlockMetrics = {
  segmentsLoaded: 0,
  segmentsSkipped: 0,
  cacheHits: 0,
  cacheMisses: 0,
  fetchErrors: 0,
  cancellations: 0,
}

export function getSponsorBlockMetrics(): SponsorBlockMetrics {
  return { ...metrics }
}

export function resetSponsorBlockMetrics(): void {
  metrics = {
    segmentsLoaded: 0,
    segmentsSkipped: 0,
    cacheHits: 0,
    cacheMisses: 0,
    fetchErrors: 0,
    cancellations: 0,
  }
}

export function recordSponsorBlockMetric(metric: keyof SponsorBlockMetrics): void {
  metrics[metric]++
}
