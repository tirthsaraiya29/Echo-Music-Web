/**
 * Desktop player view schemas, validation, and telemetry metrics.
 */

import { z } from 'zod'

export const desktopPlayerPropsSchema = z.object({
  isOpen: z.boolean(),
  initialTab: z.enum(['player', 'lyrics']).optional().default('player'),
})

export type DesktopPlayerProps = z.infer<typeof desktopPlayerPropsSchema>

export const playbackRateSchema = z
  .number()
  .refine((rate) => [0.5, 0.75, 1.0, 1.25, 1.5, 2.0].includes(rate), {
    message: 'Unsupported playback rate',
  })

export const desktopPlayerMetricsSchema = z.object({
  opens: z.number().int().nonnegative(),
  closes: z.number().int().nonnegative(),
  fullscreenToggles: z.number().int().nonnegative(),
  speedChanges: z.number().int().nonnegative(),
  shareClicks: z.number().int().nonnegative(),
  keyboardShortcutsTriggered: z.number().int().nonnegative(),
})

export type DesktopPlayerMetrics = z.infer<typeof desktopPlayerMetricsSchema>

let metrics: DesktopPlayerMetrics = {
  opens: 0,
  closes: 0,
  fullscreenToggles: 0,
  speedChanges: 0,
  shareClicks: 0,
  keyboardShortcutsTriggered: 0,
}

export function getDesktopPlayerMetrics(): DesktopPlayerMetrics {
  return { ...metrics }
}

export function resetDesktopPlayerMetrics(): void {
  metrics = {
    opens: 0,
    closes: 0,
    fullscreenToggles: 0,
    speedChanges: 0,
    shareClicks: 0,
    keyboardShortcutsTriggered: 0,
  }
}

export function recordDesktopPlayerMetric(metric: keyof DesktopPlayerMetrics): void {
  metrics[metric]++
}
