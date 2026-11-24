/**
 * Podcast Metadata & Chapter Service for Echo Music Web
 *
 * Implements podcast metadata retrieval, description and show notes rendering,
 * and timestamped chapter parsing matching upstream Echo Music architecture:
 * - EpisodeDetails.kt
 *
 * Upstream Reference:
 * CHAPTER_LINE = Regex("""^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–—:.]?\s+(.+)$""")
 */

import { z } from 'zod'
import { formatDuration } from '../../utils/format.ts'

// ============================================================================
// Schemas
// ============================================================================

export const episodeChapterSchema = z.object({
  startMs: z.number().nonnegative(),
  title: z.string().min(1),
  formattedTime: z.string().optional(),
})

export type EpisodeChapter = z.infer<typeof episodeChapterSchema>

export const podcastEpisodeMetadataSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  showTitle: z.string().optional(),
  showBrowseId: z.string().optional(),
  author: z.string().optional(),
  description: z.string().optional(),
  publishedText: z.string().optional(),
  publishedAt: z.number().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  artworkUrl: z.string().optional(),
  chapters: z.array(episodeChapterSchema).default([]),
})

export type PodcastEpisodeMetadata = z.infer<typeof podcastEpisodeMetadataSchema>

export const podcastMetadataMetricsSchema = z.object({
  metadataLoadsCount: z.number().nonnegative(),
  chaptersParsedCount: z.number().nonnegative(),
  chapterJumpsCount: z.number().nonnegative(),
})

export type PodcastMetadataMetrics = z.infer<typeof podcastMetadataMetricsSchema>

// ============================================================================
// Telemetry State
// ============================================================================

let metadataMetrics: PodcastMetadataMetrics = {
  metadataLoadsCount: 0,
  chaptersParsedCount: 0,
  chapterJumpsCount: 0,
}

export function recordPodcastMetadataMetric(key: keyof PodcastMetadataMetrics, delta = 1): void {
  if (key in metadataMetrics) {
    metadataMetrics[key] += delta
  }
}

export function getPodcastMetadataMetrics(): PodcastMetadataMetrics {
  return { ...metadataMetrics }
}

export function resetPodcastMetadataMetrics(): void {
  metadataMetrics = {
    metadataLoadsCount: 0,
    chaptersParsedCount: 0,
    chapterJumpsCount: 0,
  }
}

// ============================================================================
// Chapter Parsing Logic (Matching upstream EpisodeDetails.kt)
// ============================================================================

const CHAPTER_LINE = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–—:.]?\s+(.+)$/

/**
 * Parses timestamped chapter markers from an episode's description or show notes.
 * Matches upstream Echo Music rules:
 * - Lines like "12:23 Discussion", "01:15:30 Q&A Session", "0:00 Intro"
 * - Requires at least 2 chapters in monotonically increasing start order.
 */
export function parseEpisodeChapters(description?: string | null): EpisodeChapter[] {
  if (!description || description.trim().length === 0) {
    return []
  }

  const lines = description.split('\n')
  const chapters: EpisodeChapter[] = []

  for (const line of lines) {
    const match = CHAPTER_LINE.exec(line)
    if (!match) continue

    const hours = match[1] ? Number.parseInt(match[1], 10) : 0
    const minutes = Number.parseInt(match[2]!, 10)
    const seconds = Number.parseInt(match[3]!, 10)
    const title = match[4]!.trim()

    if (Number.isNaN(minutes) || Number.isNaN(seconds) || !title) continue

    const totalSeconds = hours * 3600 + minutes * 60 + seconds
    const startMs = totalSeconds * 1000

    chapters.push({
      startMs,
      title,
      formattedTime: formatDuration(totalSeconds),
    })
  }

  // Verify chapters are ordered in strictly increasing chronological order
  const isOrdered = chapters.every((ch, i, arr) => i === 0 || ch.startMs > arr[i - 1]!.startMs)

  if (chapters.length >= 2 && isOrdered) {
    recordPodcastMetadataMetric('chaptersParsedCount', chapters.length)
    return chapters
  }

  return []
}

// ============================================================================
// Episode Metadata Fetching
// ============================================================================

const metadataCache = new Map<string, PodcastEpisodeMetadata>()

export async function fetchEpisodeMetadata(
  episodeId: string,
  fallbackTitle?: string,
  fallbackArtist?: string,
): Promise<PodcastEpisodeMetadata> {
  if (!episodeId) {
    throw new Error('Episode ID is required')
  }

  recordPodcastMetadataMetric('metadataLoadsCount')

  const cached = metadataCache.get(episodeId)
  if (cached) {
    return cached
  }

  try {
    if (typeof fetch !== 'undefined') {
      const init: RequestInit = {}
      if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
        init.signal = AbortSignal.timeout(4000)
      }
      const res = await fetch(`/api/podcast/episode?id=${encodeURIComponent(episodeId)}`, init)
      if (res.ok) {
        const json = await res.json()
        const parsed = podcastEpisodeMetadataSchema.safeParse(json)
        if (parsed.success) {
          if (!parsed.data.chapters || parsed.data.chapters.length === 0) {
            parsed.data.chapters = parseEpisodeChapters(parsed.data.description)
          }
          metadataCache.set(episodeId, parsed.data)
          return parsed.data
        }
      }
    }
  } catch {
    // Network fallback
  }

  // Construct structured metadata object
  const defaultMeta: PodcastEpisodeMetadata = {
    id: episodeId,
    title: fallbackTitle || 'Episode Details',
    showTitle: fallbackArtist || 'Podcast Show',
    author: fallbackArtist || 'Host',
    description: 'Listen to the full episode and navigate through chapter markers.',
    publishedText: 'Recently published',
    chapters: [],
  }

  metadataCache.set(episodeId, defaultMeta)
  return defaultMeta
}
