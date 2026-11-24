import { z } from 'zod'
import type { Track, UserPreferences } from '../../types/domain.ts'

export const podcastSpeedSchema = z.number().min(0.5).max(2.5)

export const podcastSpeedMetricsSchema = z.object({
  speedChanges: z.number().nonnegative(),
  speedsCycled: z.number().nonnegative(),
})

export type PodcastSpeedMetrics = z.infer<typeof podcastSpeedMetricsSchema>

const speedMetrics: PodcastSpeedMetrics = {
  speedChanges: 0,
  speedsCycled: 0,
}

export function getPodcastSpeedMetrics(): PodcastSpeedMetrics {
  return { ...speedMetrics }
}

export function resetPodcastSpeedMetrics(): void {
  speedMetrics.speedChanges = 0
  speedMetrics.speedsCycled = 0
}

export function recordPodcastSpeedMetric(metric: 'speedChanges' | 'speedsCycled'): void {
  speedMetrics[metric]++
}

/**
 * Standard podcast speeds matching upstream Echo Music PodcastProgress.kt.
 */
export const PODCAST_SPEEDS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0] as const

/**
 * Formats a playback rate into human label ("1x", "1.25x", "1.5x").
 */
export function formatPodcastSpeed(speed: number): string {
  if (speed % 1 === 0) {
    return `${speed}x`
  }
  return `${speed.toFixed(2).replace(/\.?0+$/, '')}x`
}

/**
 * Cycles to the next available podcast speed, wrapping around.
 */
export function cyclePodcastSpeed(currentSpeed: number): number {
  speedMetrics.speedsCycled++
  const idx = PODCAST_SPEEDS.findIndex((s) => Math.abs(s - currentSpeed) < 0.05)
  if (idx === -1) {
    return 1.0
  }
  const nextIdx = (idx + 1) % PODCAST_SPEEDS.length
  return PODCAST_SPEEDS[nextIdx]!
}

/**
 * Resolves the effective playback rate for a given track based on whether it is a podcast.
 */
export function resolveEffectivePlaybackRate(
  track: Track | null | undefined,
  preferences?: Partial<UserPreferences> | null,
): number {
  if (track?.isPodcast) {
    const rate = preferences?.podcastPlaybackRate ?? 1.0
    return Math.max(0.5, Math.min(2.5, rate))
  }
  return 1.0
}
