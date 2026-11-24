/**
 * Music DNA domain types, runtime schemas, and metrics instrumentation.
 */

import { z } from 'zod'

export const musicDnaQuerySchema = z.object({
  title: z.string().trim().min(1, 'Title cannot be empty').max(300),
  artist: z.string().trim().max(300).default(''),
})

export type MusicDnaQueryInput = z.infer<typeof musicDnaQuerySchema>

export const geniusLoreSchema = z.object({
  songId: z.number().optional(),
  description: z.string().optional(),
  releaseDate: z.string().optional(),
  producer: z.string().optional(),
  writer: z.string().optional(),
  annotationHighlights: z.array(z.string()).optional(),
})

export const wikiExtractSchema = z.object({
  title: z.string(),
  extract: z.string(),
  thumbnailUrl: z.string().optional(),
  pageUrl: z.string().optional(),
})

export const musicDnaDataSchema = z.object({
  trackTitle: z.string(),
  artistName: z.string(),
  genius: geniusLoreSchema.optional(),
  wikipedia: wikiExtractSchema.optional(),
  artistWikipedia: wikiExtractSchema.optional(),
})

export type MusicDnaData = z.infer<typeof musicDnaDataSchema>

export const musicDnaMetricsSchema = z.object({
  requests: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
  cacheMisses: z.number().int().nonnegative(),
  inFlightDeduplications: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  cancellations: z.number().int().nonnegative(),
})

export type MusicDnaMetrics = z.infer<typeof musicDnaMetricsSchema>

let dnaMetrics: MusicDnaMetrics = {
  requests: 0,
  cacheHits: 0,
  cacheMisses: 0,
  inFlightDeduplications: 0,
  retries: 0,
  errors: 0,
  cancellations: 0,
}

export function getMusicDnaMetrics(): MusicDnaMetrics {
  return { ...dnaMetrics }
}

export function resetMusicDnaMetrics(): void {
  dnaMetrics = {
    requests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    inFlightDeduplications: 0,
    retries: 0,
    errors: 0,
    cancellations: 0,
  }
}

export function recordMusicDnaMetric(metric: keyof MusicDnaMetrics): void {
  dnaMetrics[metric]++
}

export function isReducedMotionPreferred(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
