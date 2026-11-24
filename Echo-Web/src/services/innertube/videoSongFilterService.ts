import { z } from 'zod'
import type { Track, HomeShelf, UserPreferences } from '../../types/domain.ts'
import type { SearchResultCatalog } from './client.ts'

export const videoSongFilterOptionsSchema = z.object({
  enabled: z.boolean().default(false),
})

export type VideoSongFilterOptions = z.infer<typeof videoSongFilterOptionsSchema>

export const videoSongFilterMetricsSchema = z.object({
  totalEvaluated: z.number().nonnegative(),
  videoSongsDetected: z.number().nonnegative(),
  itemsFiltered: z.number().nonnegative(),
  shelvesFiltered: z.number().nonnegative(),
})

export type VideoSongFilterMetrics = z.infer<typeof videoSongFilterMetricsSchema>

const metrics: VideoSongFilterMetrics = {
  totalEvaluated: 0,
  videoSongsDetected: 0,
  itemsFiltered: 0,
  shelvesFiltered: 0,
}

export function getVideoSongFilterMetrics(): VideoSongFilterMetrics {
  return { ...metrics }
}

export function resetVideoSongFilterMetrics(): void {
  metrics.totalEvaluated = 0
  metrics.videoSongsDetected = 0
  metrics.itemsFiltered = 0
  metrics.shelvesFiltered = 0
}

/**
 * Determines whether user preferences enable video song filtering.
 * Matches upstream EchoMusic: active when hideVideoSongs is true or dataSaver is true.
 */
export function isVideoSongFilterEnabled(preferences?: Partial<UserPreferences> | null): boolean {
  if (!preferences) return false
  if (preferences.hideVideoSongs === true) return true
  if (preferences.dataSaver === true) return true
  return false
}

/**
 * Checks whether an item is a video song.
 * Upstream rule:
 * musicVideoType != null && musicVideoType != MUSIC_VIDEO_TYPE_ATV (Audio Track Video)
 * Podcast episodes are kept because they are audio content.
 */
export function isVideoSong(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false
  metrics.totalEvaluated++

  const rec = item as Record<string, unknown>

  // Podcasts are audio content, never filter them out as video songs
  if (rec['isPodcast'] === true) {
    return false
  }

  // Explicit flags
  if (rec['isVideo'] === true || rec['isVideoSong'] === true) {
    return true
  }

  const musicVideoType = typeof rec['musicVideoType'] === 'string' ? rec['musicVideoType'] : ''
  if (musicVideoType) {
    if (musicVideoType === 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE') return false
    if (musicVideoType !== 'MUSIC_VIDEO_TYPE_ATV') return true
  }

  const title = typeof rec['title'] === 'string' ? rec['title'] : ''
  const albumId = typeof rec['albumId'] === 'string' ? rec['albumId'] : ''

  // Video indicators in title when not an official album track
  const hasVideoKeywords =
    /\b(official video|music video|official music video|lyric video|visualizer|performance video|live video)\b/i.test(
      title,
    )

  if (hasVideoKeywords && !albumId.startsWith('MPREb_')) {
    return true
  }

  return false
}

/**
 * Filters out video songs from a track list.
 */
export function filterVideoSongsFromTracks(tracks: Track[], enabled: boolean = false): Track[] {
  if (!enabled || !Array.isArray(tracks)) return tracks || []

  return tracks.filter((track) => {
    const video = isVideoSong(track)
    if (video) {
      metrics.videoSongsDetected++
      metrics.itemsFiltered++
    }
    return !video
  })
}

/**
 * Filters video songs from discovery and browse shelves.
 * Omit shelves that become empty after stripping video songs.
 */
export function filterVideoSongsFromShelves(
  shelves: HomeShelf[],
  enabled: boolean = false,
): HomeShelf[] {
  if (!enabled || !Array.isArray(shelves)) return shelves || []

  const result: HomeShelf[] = []

  for (const shelf of shelves) {
    // If shelf title explicitly denotes Videos or Music Videos, prune the entire shelf
    if (/^(music videos|trending videos|official videos)$/i.test(shelf.title.trim())) {
      metrics.shelvesFiltered++
      continue
    }

    const filteredItems = shelf.items.filter((item) => {
      const video = isVideoSong(item)
      if (video) {
        metrics.videoSongsDetected++
        metrics.itemsFiltered++
      }
      return !video
    })

    if (filteredItems.length > 0) {
      result.push({
        ...shelf,
        items: filteredItems,
      })
    } else {
      metrics.shelvesFiltered++
    }
  }

  return result
}

/**
 * Filters video songs from search result catalogs.
 */
export function filterVideoSongsFromSearchResults(
  catalog: SearchResultCatalog,
  enabled: boolean = false,
): SearchResultCatalog {
  if (!enabled) return catalog

  return {
    tracks: filterVideoSongsFromTracks(catalog.tracks, true),
    albums: catalog.albums,
    artists: catalog.artists,
    playlists: catalog.playlists,
  }
}
