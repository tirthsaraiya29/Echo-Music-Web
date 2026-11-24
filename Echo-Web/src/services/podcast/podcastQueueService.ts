/**
 * Podcast Queue Service for Echo Music Web
 *
 * Implements segregated episode queueing, next-episode show sequencing,
 * and music radio filtering matching upstream Echo Music architecture:
 * - YouTubeQueue.kt (isEpisodeRadio filtering)
 * - MediaLibrarySessionCallback.kt (show group queueing)
 *
 * Upstream Reference:
 * "Started from an episode: YouTube's radio mixes in music, which must not follow it."
 * val songs = if (isEpisodeRadio) filtered.filter { it.isPodcastEpisode } else filtered
 */

import { z } from 'zod'
import type { Track } from '../../types/domain.ts'

// ============================================================================
// Types & Schemas
// ============================================================================

export const podcastQueueItemSchema = z.object({
  trackId: z.string().min(1),
  title: z.string().min(1),
  showTitle: z.string().optional(),
  showBrowseId: z.string().optional(),
  isPodcast: z.boolean().default(true),
  episodeIndex: z.number().int().nonnegative().optional(),
  publishedAt: z.string().optional(),
})

export type PodcastQueueItem = z.infer<typeof podcastQueueItemSchema>

export const podcastQueuePolicySchema = z.object({
  segregateSpokenAudio: z.boolean().default(true),
  autoQueueNextEpisode: z.boolean().default(true),
  disallowMusicRadioContinuation: z.boolean().default(true),
})

export type PodcastQueuePolicy = z.infer<typeof podcastQueuePolicySchema>

export const podcastQueueMetricsSchema = z.object({
  episodesQueuedCount: z.number().nonnegative(),
  musicTracksFilteredCount: z.number().nonnegative(),
  nextEpisodesAutoQueued: z.number().nonnegative(),
  queueSegregationEnforcements: z.number().nonnegative(),
})

export type PodcastQueueMetrics = z.infer<typeof podcastQueueMetricsSchema>

// ============================================================================
// Telemetry State
// ============================================================================

let queueMetrics: PodcastQueueMetrics = {
  episodesQueuedCount: 0,
  musicTracksFilteredCount: 0,
  nextEpisodesAutoQueued: 0,
  queueSegregationEnforcements: 0,
}

export function recordPodcastQueueMetric(key: keyof PodcastQueueMetrics, delta = 1): void {
  if (key in queueMetrics) {
    queueMetrics[key] += delta
  }
}

export function getPodcastQueueMetrics(): PodcastQueueMetrics {
  return { ...queueMetrics }
}

export function resetPodcastQueueMetrics(): void {
  queueMetrics = {
    episodesQueuedCount: 0,
    musicTracksFilteredCount: 0,
    nextEpisodesAutoQueued: 0,
    queueSegregationEnforcements: 0,
  }
}

// ============================================================================
// Podcast & Spoken Audio Detection
// ============================================================================

/**
 * Accurately determines if a track represents a podcast episode / spoken audio,
 * matching upstream Echo Music rules (PodcastProgress.kt / YouTubeQueue.kt).
 */
export function isPodcastTrack(track: Track | null | undefined): boolean {
  if (!track) return false
  if (track.isPodcast === true) return true
  if (typeof track.showTitle === 'string' && track.showTitle.trim().length > 0) return true
  if (track.albumTitle?.toLowerCase().includes('podcast')) return true
  return false
}

// ============================================================================
// Queue Filtering & Segregation
// ============================================================================

/**
 * Enforces spoken audio segregation matching upstream YouTubeQueue:
 * "Started from an episode: YouTube's radio mixes in music, which must not follow it."
 */
export function filterSpokenAudioTracks(
  tracks: Track[],
  activeIsPodcast: boolean,
): { podcastTracks: Track[]; filteredMusicTracks: Track[] } {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return { podcastTracks: [], filteredMusicTracks: [] }
  }

  if (!activeIsPodcast) {
    return { podcastTracks: tracks, filteredMusicTracks: [] }
  }

  const podcastTracks: Track[] = []
  const filteredMusicTracks: Track[] = []

  for (const track of tracks) {
    if (isPodcastTrack(track)) {
      podcastTracks.push(track)
    } else {
      filteredMusicTracks.push(track)
    }
  }

  if (filteredMusicTracks.length > 0) {
    recordPodcastQueueMetric('musicTracksFilteredCount', filteredMusicTracks.length)
    recordPodcastQueueMetric('queueSegregationEnforcements')
  }

  return { podcastTracks, filteredMusicTracks }
}

/**
 * Finds the next chronological or list episode for the current show,
 * prioritizing uninterrupted episode progression over music radio.
 */
export function findNextShowEpisode(currentEpisode: Track, availableEpisodes: Track[]): Track | null {
  if (!currentEpisode || !Array.isArray(availableEpisodes) || availableEpisodes.length === 0) {
    return null
  }

  const currentId = currentEpisode.videoId || currentEpisode.id
  const currentIndex = availableEpisodes.findIndex((e) => (e.videoId || e.id) === currentId)

  if (currentIndex === -1) {
    // Current not in list; if same show, pick first unplayed or first item
    const matchingShow = availableEpisodes.filter(
      (e) => e.showTitle && e.showTitle === currentEpisode.showTitle,
    )
    return matchingShow[0] || null
  }

  // Next episode in sequence
  if (currentIndex + 1 < availableEpisodes.length) {
    const next = availableEpisodes[currentIndex + 1]!
    recordPodcastQueueMetric('nextEpisodesAutoQueued')
    return next
  }

  return null
}

/**
 * Assembles a dedicated podcast episode queue from show items.
 */
export function buildPodcastEpisodeQueue(
  currentEpisode: Track,
  showEpisodes: Track[],
  startIndex?: number,
): Track[] {
  if (!Array.isArray(showEpisodes) || showEpisodes.length === 0) {
    return [currentEpisode]
  }

  const currentId = currentEpisode.videoId || currentEpisode.id
  const idx =
    typeof startIndex === 'number' && startIndex >= 0
      ? startIndex
      : showEpisodes.findIndex((e) => (e.videoId || e.id) === currentId)

  const items = idx >= 0 ? showEpisodes.slice(idx) : [currentEpisode, ...showEpisodes]
  recordPodcastQueueMetric('episodesQueuedCount', items.length)
  return items
}
