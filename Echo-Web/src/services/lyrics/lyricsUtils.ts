/**
 * Lyrics UI utilities and real-time synchronization helpers.
 */

import { z } from 'zod'
import type { LyricLine } from '../../types/lyrics.ts'

// --- Runtime Schemas ---

export const syncOffsetPayloadSchema = z.object({
  trackId: z.string().min(1),
  offsetMs: z.number().int().min(-60000).max(60000),
  updatedAt: z.number().nonnegative(),
})

export type SyncOffsetPayload = z.infer<typeof syncOffsetPayloadSchema>

export const lyricsPlayerUiPropsSchema = z.object({
  track: z
    .object({
      id: z.string().optional(),
      videoId: z.string().optional(),
      title: z.string().optional(),
      artistName: z.string().optional(),
    })
    .nullable(),
  isPlaying: z.boolean(),
  className: z.string().optional(),
  onSeek: z.function().optional(),
})

export const lyricsUiMetricsSchema = z.object({
  renders: z.number().int().nonnegative(),
  userSeeks: z.number().int().nonnegative(),
  syncOffsetAdjustments: z.number().int().nonnegative(),
  autoScrolls: z.number().int().nonnegative(),
  manualScrollPauses: z.number().int().nonnegative(),
  translationsTriggered: z.number().int().nonnegative(),
})

export type LyricsUiMetrics = z.infer<typeof lyricsUiMetricsSchema>

// Module-level telemetry metrics
let lyricsUiMetrics: LyricsUiMetrics = {
  renders: 0,
  userSeeks: 0,
  syncOffsetAdjustments: 0,
  autoScrolls: 0,
  manualScrollPauses: 0,
  translationsTriggered: 0,
}

export function getLyricsUiMetrics(): LyricsUiMetrics {
  return { ...lyricsUiMetrics }
}

export function resetLyricsUiMetrics(): void {
  lyricsUiMetrics = {
    renders: 0,
    userSeeks: 0,
    syncOffsetAdjustments: 0,
    autoScrolls: 0,
    manualScrollPauses: 0,
    translationsTriggered: 0,
  }
}

export function recordLyricsUiMetric(metric: keyof LyricsUiMetrics): void {
  lyricsUiMetrics[metric]++
}

export function clampSyncOffset(offsetMs: number): number {
  return Math.max(-60000, Math.min(60000, Math.round(offsetMs)))
}

/**
 * Binary search to find the active lyric line for a given playback timestamp.
 * Returns -1 if playback is before the first lyric line.
 * Time complexity: O(log N) instead of O(N) linear scan.
 */
export function findActiveLineIndex(lines: LyricLine[], adjustedMs: number): number {
  if (!lines || lines.length === 0) return -1
  if (adjustedMs < lines[0]!.startTimeMs) return -1

  let low = 0
  let high = lines.length - 1
  let candidate = -1

  while (low <= high) {
    const mid = (low + high) >> 1
    const line = lines[mid]!
    if (line.startTimeMs <= adjustedMs) {
      candidate = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  if (candidate === -1) return -1

  const currentLine = lines[candidate]!
  const nextLine = lines[candidate + 1]
  const lineEnd =
    currentLine.endTimeMs ?? (nextLine ? nextLine.startTimeMs : currentLine.startTimeMs + 4000)

  if (adjustedMs < lineEnd) {
    return candidate
  }

  return candidate
}
