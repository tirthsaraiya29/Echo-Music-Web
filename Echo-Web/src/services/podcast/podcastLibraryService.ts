import { z } from 'zod'
import type { Playlist, PlaylistSummary } from '../../types/domain.ts'

export const followedPodcastSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  author: z.string().min(1),
  description: z.string().optional(),
  artworkUrl: z.string().default(''),
  episodeCount: z.number().int().nonnegative().optional(),
  isFollowed: z.boolean().default(true),
  browseId: z.string().optional(),
})

export const podcastLibraryMetricsSchema = z.object({
  totalFollowed: z.number().nonnegative(),
  followOperations: z.number().nonnegative(),
  unfollowOperations: z.number().nonnegative(),
})

export type PodcastLibraryMetrics = z.infer<typeof podcastLibraryMetricsSchema>

const libraryMetrics: PodcastLibraryMetrics = {
  totalFollowed: 0,
  followOperations: 0,
  unfollowOperations: 0,
}

export function getPodcastLibraryMetrics(): PodcastLibraryMetrics {
  return { ...libraryMetrics }
}

export function resetPodcastLibraryMetrics(): void {
  libraryMetrics.totalFollowed = 0
  libraryMetrics.followOperations = 0
  libraryMetrics.unfollowOperations = 0
}

export function recordPodcastLibraryMetric(
  operation: 'follow' | 'unfollow',
  currentTotal: number,
): void {
  if (operation === 'follow') {
    libraryMetrics.followOperations++
  } else {
    libraryMetrics.unfollowOperations++
  }
  libraryMetrics.totalFollowed = currentTotal
}

/**
 * Determines whether a playlist item is a podcast show.
 * Matches upstream Echo Music convention where shows have browseId starting with MPSP
 * or are explicitly marked isPodcast.
 */
export function isPodcastShow(playlist: Playlist | PlaylistSummary | { id: string; browseId?: string; isPodcast?: boolean }): boolean {
  if ('isPodcast' in playlist && playlist.isPodcast === true) return true
  if (playlist.id && playlist.id.startsWith('MPSP')) return true
  if ('browseId' in playlist && playlist.browseId && playlist.browseId.startsWith('MPSP')) return true
  return false
}

/**
 * Segregates music playlists from podcast shows, keeping user music playlists pure.
 */
export function segregatePlaylists(
  playlists: PlaylistSummary[],
  followedShowIds: Set<string>,
): { musicPlaylists: PlaylistSummary[]; podcastShows: PlaylistSummary[] } {
  const musicPlaylists: PlaylistSummary[] = []
  const podcastShows: PlaylistSummary[] = []

  for (const item of playlists) {
    if (isPodcastShow(item) || followedShowIds.has(item.id)) {
      podcastShows.push(item)
    } else {
      musicPlaylists.push(item)
    }
  }

  return { musicPlaylists, podcastShows }
}
