/**
 * Canvas video rendering types, schemas, and metrics instrumentation.
 */

import { z } from 'zod'

export const canvasVideoPropsSchema = z.object({
  track: z
    .object({
      id: z.string().optional(),
      videoId: z.string().optional(),
      title: z.string().optional(),
      artistName: z.string().optional(),
      artwork: z.string().optional(),
      thumbnailUrl: z.string().optional(),
      albumImage: z.string().optional(),
    })
    .nullable(),
  className: z.string().optional(),
})

export type CanvasVideoPropsInput = z.infer<typeof canvasVideoPropsSchema>

export const canvasVideoMetricsSchema = z.object({
  renders: z.number().int().nonnegative(),
  videoLoadStarts: z.number().int().nonnegative(),
  videoLoadSuccesses: z.number().int().nonnegative(),
  videoLoadErrors: z.number().int().nonnegative(),
  reducedMotionSkips: z.number().int().nonnegative(),
})

export type CanvasVideoMetrics = z.infer<typeof canvasVideoMetricsSchema>

let videoMetrics: CanvasVideoMetrics = {
  renders: 0,
  videoLoadStarts: 0,
  videoLoadSuccesses: 0,
  videoLoadErrors: 0,
  reducedMotionSkips: 0,
}

export function getCanvasVideoMetrics(): CanvasVideoMetrics {
  return { ...videoMetrics }
}

export function resetCanvasVideoMetrics(): void {
  videoMetrics = {
    renders: 0,
    videoLoadStarts: 0,
    videoLoadSuccesses: 0,
    videoLoadErrors: 0,
    reducedMotionSkips: 0,
  }
}

export function recordCanvasVideoMetric(metric: keyof CanvasVideoMetrics): void {
  videoMetrics[metric]++
}

export function isReducedMotionPreferred(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
