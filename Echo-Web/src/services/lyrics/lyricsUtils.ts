import type { LyricLine } from '../../types/lyrics.ts'

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
