/**
 * Podcast Skip Controls Service for Echo Music Web
 *
 * Implements configurable skip backward / forward controls and intro / outro skip
 * matching upstream Echo Music architecture (PodcastProgress.kt / MediaLibrarySessionCallback.kt).
 *
 * Upstream Reference:
 * - SKIP_BACK_MS = 15_000L (-15 seconds)
 * - SKIP_FORWARD_MS = 30_000L (+30 seconds)
 * - MediaSessionConstants.ACTION_EPISODE_SKIP_BACK / ACTION_EPISODE_SKIP_FORWARD
 */

import { z } from 'zod'

// ============================================================================
// Upstream Constants & Defaults
// ============================================================================

export const UPSTREAM_SKIP_BACK_MS = 15_000
export const UPSTREAM_SKIP_FORWARD_MS = 30_000

export const DEFAULT_SKIP_BACKWARD_SECONDS = 15
export const DEFAULT_SKIP_FORWARD_SECONDS = 30
export const DEFAULT_INTRO_SKIP_SECONDS = 0
export const DEFAULT_OUTRO_SKIP_SECONDS = 0

export const SKIP_BACKWARD_PRESETS = [5, 10, 15, 30, 45, 60] as const
export const SKIP_FORWARD_PRESETS = [10, 15, 30, 45, 60, 90] as const
export const INTRO_SKIP_PRESETS = [0, 15, 30, 45, 60, 90, 120] as const
export const OUTRO_SKIP_PRESETS = [0, 15, 30, 45, 60, 90] as const

// ============================================================================
// Zod Schemas
// ============================================================================

export const podcastSkipConfigSchema = z.object({
  skipBackwardSeconds: z.number().int().min(5).max(120).default(DEFAULT_SKIP_BACKWARD_SECONDS),
  skipForwardSeconds: z.number().int().min(5).max(120).default(DEFAULT_SKIP_FORWARD_SECONDS),
  introSkipSeconds: z.number().int().min(0).max(300).default(DEFAULT_INTRO_SKIP_SECONDS),
  outroSkipSeconds: z.number().int().min(0).max(300).default(DEFAULT_OUTRO_SKIP_SECONDS),
})

export type PodcastSkipConfig = z.infer<typeof podcastSkipConfigSchema>

export const skipOperationSchema = z.object({
  direction: z.enum(['backward', 'forward', 'intro', 'outro']),
  offsetSeconds: z.number().nonnegative(),
  fromPosition: z.number().nonnegative(),
  toPosition: z.number().nonnegative(),
  duration: z.number().nonnegative(),
  timestamp: z.number().positive(),
})

export type SkipOperation = z.infer<typeof skipOperationSchema>

export const podcastSkipMetricsSchema = z.object({
  skipBackwardCount: z.number().nonnegative(),
  skipForwardCount: z.number().nonnegative(),
  introSkipCount: z.number().nonnegative(),
  outroSkipCount: z.number().nonnegative(),
  totalSecondsSkipped: z.number().nonnegative(),
})

export type PodcastSkipMetrics = z.infer<typeof podcastSkipMetricsSchema>

// ============================================================================
// Telemetry State
// ============================================================================

let skipMetrics: PodcastSkipMetrics = {
  skipBackwardCount: 0,
  skipForwardCount: 0,
  introSkipCount: 0,
  outroSkipCount: 0,
  totalSecondsSkipped: 0,
}

export function recordPodcastSkipMetric(key: keyof PodcastSkipMetrics, delta = 1): void {
  if (key in skipMetrics) {
    skipMetrics[key] += delta
  }
}

export function getPodcastSkipMetrics(): PodcastSkipMetrics {
  return { ...skipMetrics }
}

export function resetPodcastSkipMetrics(): void {
  skipMetrics = {
    skipBackwardCount: 0,
    skipForwardCount: 0,
    introSkipCount: 0,
    outroSkipCount: 0,
    totalSecondsSkipped: 0,
  }
}

// ============================================================================
// Calculation Helpers
// ============================================================================

/**
 * Calculates the target position after skipping backward.
 * Clamps safely to >= 0.
 */
export function calculateSkipBackward(
  currentPosition: number,
  skipSeconds = DEFAULT_SKIP_BACKWARD_SECONDS,
): number {
  if (!Number.isFinite(currentPosition) || currentPosition < 0) return 0
  const safeSkip = Number.isFinite(skipSeconds) && skipSeconds > 0 ? skipSeconds : DEFAULT_SKIP_BACKWARD_SECONDS
  return Math.max(0, currentPosition - safeSkip)
}

/**
 * Calculates the target position after skipping forward.
 * Clamps safely to <= duration (or raw target if duration is undefined / unknown).
 */
export function calculateSkipForward(
  currentPosition: number,
  duration = 0,
  skipSeconds = DEFAULT_SKIP_FORWARD_SECONDS,
): number {
  if (!Number.isFinite(currentPosition) || currentPosition < 0) return 0
  const safeSkip = Number.isFinite(skipSeconds) && skipSeconds > 0 ? skipSeconds : DEFAULT_SKIP_FORWARD_SECONDS
  const target = currentPosition + safeSkip
  if (Number.isFinite(duration) && duration > 0) {
    return Math.min(duration, target)
  }
  return target
}

/**
 * Evaluates whether an episode start should be skipped past introductory branding or sponsors.
 * Applies when starting near position 0 (<= 2 seconds) and introSkipSeconds > 0.
 */
export function shouldApplyIntroSkip(
  position: number,
  introSkipSeconds: number,
  duration = 0,
): { shouldSkip: boolean; targetPosition: number } {
  if (
    !Number.isFinite(introSkipSeconds) ||
    introSkipSeconds <= 0 ||
    !Number.isFinite(position) ||
    position > 2 // only trigger at cold start
  ) {
    return { shouldSkip: false, targetPosition: position }
  }

  // Prevent skipping past entire short track
  if (duration > 0 && introSkipSeconds >= duration - 5) {
    return { shouldSkip: false, targetPosition: position }
  }

  return { shouldSkip: true, targetPosition: introSkipSeconds }
}

/**
 * Evaluates whether an episode is within the designated outro skip window.
 * Triggers track advancement before lengthy credits / sponsor plugs.
 */
export function shouldApplyOutroSkip(
  position: number,
  duration: number,
  outroSkipSeconds: number,
): { shouldSkip: boolean; remainingSeconds: number } {
  if (
    !Number.isFinite(outroSkipSeconds) ||
    outroSkipSeconds <= 0 ||
    !Number.isFinite(duration) ||
    duration <= outroSkipSeconds * 2 ||
    !Number.isFinite(position)
  ) {
    return { shouldSkip: false, remainingSeconds: Math.max(0, duration - position) }
  }

  const remaining = duration - position
  if (remaining <= outroSkipSeconds && remaining >= 0) {
    return { shouldSkip: true, remainingSeconds: remaining }
  }

  return { shouldSkip: false, remainingSeconds: remaining }
}
