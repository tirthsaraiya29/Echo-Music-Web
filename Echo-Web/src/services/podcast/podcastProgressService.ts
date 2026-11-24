import { z } from 'zod'
import {
  getPodcastProgress,
  savePodcastProgress,
  getAllPodcastProgress,
  dismissPodcastProgress,
  type PodcastProgressRecord,
} from '../db/echoDatabase.ts'
import type { Track } from '../../types/domain.ts'

export const episodeProgressSchema = z.object({
  episodeId: z.string().min(1),
  showTitle: z.string().min(1),
  episodeTitle: z.string().min(1),
  positionMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  positionSeconds: z.number().nonnegative().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  artworkUrl: z.string().optional(),
  completed: z.boolean(),
  dismissed: z.boolean(),
  updatedAt: z.number().nonnegative(),
})

export const podcastProgressMetricsSchema = z.object({
  resumesTriggered: z.number().nonnegative(),
  progressSaved: z.number().nonnegative(),
  episodesCompleted: z.number().nonnegative(),
  episodesDismissed: z.number().nonnegative(),
})

export type PodcastProgressMetrics = z.infer<typeof podcastProgressMetricsSchema>

const progressMetrics: PodcastProgressMetrics = {
  resumesTriggered: 0,
  progressSaved: 0,
  episodesCompleted: 0,
  episodesDismissed: 0,
}

export function getPodcastProgressMetrics(): PodcastProgressMetrics {
  return { ...progressMetrics }
}

export function resetPodcastProgressMetrics(): void {
  progressMetrics.resumesTriggered = 0
  progressMetrics.progressSaved = 0
  progressMetrics.episodesCompleted = 0
  progressMetrics.episodesDismissed = 0
}

export function recordPodcastProgressMetric(
  metric: 'resumesTriggered' | 'progressSaved' | 'episodesCompleted' | 'episodesDismissed',
): void {
  progressMetrics[metric]++
}

/**
 * Minimum position in milliseconds worth resuming (positions earlier start from beginning).
 * Upstream Echo Music constant: 30 seconds.
 */
export const MIN_POSITION_MS = 30_000

/**
 * Margin bounds near the end of an episode (1 to 3 minutes) that count as played.
 */
export const END_MARGIN_MIN_MS = 60_000
export const END_MARGIN_MAX_MS = 180_000

/**
 * Checks whether an episode position is near its end.
 * Closer than 5% of its length or within 1 to 3 minutes counts as played.
 */
export function isNearEnd(positionMs: number, durationMs: number): boolean {
  if (durationMs <= 0 || positionMs <= 0) return false
  const remainingMs = durationMs - positionMs
  if (remainingMs <= 0) return true

  const fivePercentMargin = durationMs / 20
  const effectiveMargin = Math.min(Math.max(fivePercentMargin, END_MARGIN_MIN_MS), END_MARGIN_MAX_MS)
  return remainingMs <= effectiveMargin
}

/**
 * Evaluates whether an episode should be resumed and calculates the seek offset.
 */
export function shouldResumeEpisode(
  record: Partial<PodcastProgressRecord> | null | undefined,
): { shouldResume: boolean; seekPositionSeconds: number } {
  if (!record || record.completed || record.dismissed) {
    return { shouldResume: false, seekPositionSeconds: 0 }
  }

  const posMs = record.positionMs ?? (record.positionSeconds ? record.positionSeconds * 1000 : 0)
  const durMs = record.durationMs ?? (record.durationSeconds ? record.durationSeconds * 1000 : 0)

  // Positions under 5 seconds (or early threshold) start from beginning
  if (posMs < 5000) {
    return { shouldResume: false, seekPositionSeconds: 0 }
  }

  // If near the end, treat as finished
  if (isNearEnd(posMs, durMs)) {
    return { shouldResume: false, seekPositionSeconds: 0 }
  }

  const seekPositionSeconds = Math.round(posMs / 1000)
  return { shouldResume: true, seekPositionSeconds }
}

/**
 * Calculates the progress fraction between 0 and 1.
 */
export function calculateEpisodeFraction(positionMs: number, durationMs: number): number {
  if (durationMs <= 0) return 0
  const ratio = positionMs / durationMs
  return Math.min(Math.max(ratio, 0), 1)
}

/**
 * Calculates the remaining time in seconds.
 */
export function calculateRemainingSeconds(positionMs: number, durationMs: number): number {
  if (durationMs <= 0) return 0
  const diffMs = Math.max(0, durationMs - positionMs)
  return Math.round(diffMs / 1000)
}

/**
 * Formats remaining seconds into friendly label ("45m left", "1h 12m left").
 */
export function formatRemainingTime(remainingSeconds: number): string {
  if (remainingSeconds <= 0) return 'Completed'
  const hours = Math.floor(remainingSeconds / 3600)
  const minutes = Math.floor((remainingSeconds % 3600) / 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m left`
  }
  if (minutes > 0) {
    return `${minutes}m left`
  }
  return `${remainingSeconds}s left`
}

/**
 * Converts a track and position to an episode progress record.
 */
export function createProgressRecord(
  track: Track,
  positionSeconds: number,
  durationSeconds: number,
): PodcastProgressRecord {
  const posSec = Math.max(0, Math.round(positionSeconds))
  const durSec = Math.max(0, Math.round(durationSeconds))
  const posMs = posSec * 1000
  const durMs = durSec * 1000
  const finished = isNearEnd(posMs, durMs)

  return {
    episodeId: track.videoId || track.id,
    showTitle: track.showTitle || track.artistName || 'Podcast Show',
    episodeTitle: track.title,
    positionSeconds: posSec,
    durationSeconds: durSec,
    positionMs: posMs,
    durationMs: durMs,
    artworkUrl: track.artwork || track.thumbnailUrl || track.albumImage,
    completed: finished,
    dismissed: false,
    updatedAt: Date.now(),
  }
}

export {
  getPodcastProgress,
  savePodcastProgress,
  getAllPodcastProgress,
  dismissPodcastProgress,
}
