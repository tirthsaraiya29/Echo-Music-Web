import { z } from 'zod'
import type { Track, PlaylistSummary, HomeShelf, UserPreferences } from '../../types/domain.ts'
import type { SearchResultCatalog } from './client.ts'

export const shortsFilterOptionsSchema = z.object({
  enabled: z.boolean().default(true),
  maxDurationSeconds: z.number().int().positive().optional().default(60),
})

export type ShortsFilterOptions = z.infer<typeof shortsFilterOptionsSchema>

export const shortsFilterMetricsSchema = z.object({
  totalEvaluated: z.number().nonnegative(),
  shortsDetected: z.number().nonnegative(),
  itemsFiltered: z.number().nonnegative(),
  shelvesFiltered: z.number().nonnegative(),
})

export type ShortsFilterMetrics = z.infer<typeof shortsFilterMetricsSchema>

const metrics: ShortsFilterMetrics = {
  totalEvaluated: 0,
  shortsDetected: 0,
  itemsFiltered: 0,
  shelvesFiltered: 0,
}

export function getShortsFilterMetrics(): ShortsFilterMetrics {
  return { ...metrics }
}

export function resetShortsFilterMetrics(): void {
  metrics.totalEvaluated = 0
  metrics.shortsDetected = 0
  metrics.itemsFiltered = 0
  metrics.shelvesFiltered = 0
}

/**
 * Determines whether user preferences enable YouTube Shorts filtering.
 * Defaults to true for a clean discovery experience.
 */
export function isShortsFilterEnabled(preferences?: Partial<UserPreferences> | null): boolean {
  if (!preferences) return true
  if (typeof preferences.hideYoutubeShorts === 'boolean') {
    return preferences.hideYoutubeShorts
  }
  if (typeof preferences.filterShorts === 'boolean') {
    return preferences.filterShorts
  }
  return true
}

/**
 * Evaluates whether an item is a YouTube Short based on metadata, IDs, duration, and titles.
 */
export function isYouTubeShort(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false
  metrics.totalEvaluated++

  const rec = item as Record<string, unknown>

  // 1. Explicit short flag
  if (rec['isShort'] === true || rec['isShorts'] === true) {
    return true
  }

  const id = typeof rec['id'] === 'string' ? rec['id'] : ''
  const browseId = typeof rec['browseId'] === 'string' ? rec['browseId'] : ''
  const videoId = typeof rec['videoId'] === 'string' ? rec['videoId'] : ''
  const title = typeof rec['title'] === 'string' ? rec['title'] : ''
  const streamUrl = typeof rec['streamUrl'] === 'string' ? rec['streamUrl'] : ''

  // 2. Upstream YouTube Shorts prefix: Playlists or shelves starting with "SS"
  if (id.startsWith('SS') || browseId.startsWith('SS')) {
    return true
  }

  // 3. Navigation endpoints or renderer models specific to YouTube Shorts
  const navEndpoint = rec['navigationEndpoint'] as Record<string, unknown> | undefined
  if (
    navEndpoint &&
    ('reelWatchEndpoint' in navEndpoint ||
      'shortsLockupViewModel' in navEndpoint ||
      'reelItemRenderer' in navEndpoint)
  ) {
    return true
  }

  // 4. URL path contains /shorts/
  if (streamUrl.includes('/shorts/')) {
    return true
  }

  // 5. Playlist title strictly representing Shorts
  if (/^#?shorts$/i.test(title.trim()) || /^youtube shorts$/i.test(title.trim())) {
    return true
  }

  // 6. Title contains explicit hashtag or bracket for Shorts
  const hasShortsTag = /(?:^|\s|[#([/])shorts(?:\s|[#)\]/]|$)/i.test(title)

  // Duration in seconds
  const durationSec =
    typeof rec['durationSeconds'] === 'number'
      ? rec['durationSeconds']
      : typeof rec['durationMs'] === 'number'
        ? Math.round(rec['durationMs'] / 1000)
        : 0

  // Tagged as shorts and under 120s
  if (hasShortsTag && durationSec > 0 && durationSec <= 120) {
    return true
  }

  // YouTube Shorts: strictly <= 60 seconds, lacking official album release, and with short tags/patterns
  const isOfficialAlbum = typeof rec['albumId'] === 'string' && rec['albumId'].startsWith('MPREb_')
  const isPodcast = rec['isPodcast'] === true
  const artistId = typeof rec['artistId'] === 'string' ? rec['artistId'] : ''

  if (!isPodcast && !isOfficialAlbum && durationSec > 0 && durationSec <= 60) {
    if (
      hasShortsTag ||
      title.includes('#') ||
      !artistId ||
      artistId === `artist-${id}` ||
      artistId === `artist-${videoId}`
    ) {
      return true
    }
  }

  return false
}

/**
 * Filters out YouTube Shorts from a list of tracks.
 */
export function filterShortsFromTracks(tracks: Track[], enabled: boolean = true): Track[] {
  if (!enabled || !Array.isArray(tracks)) return tracks || []

  return tracks.filter((track) => {
    const short = isYouTubeShort(track)
    if (short) {
      metrics.shortsDetected++
      metrics.itemsFiltered++
    }
    return !short
  })
}

/**
 * Filters out YouTube Shorts playlists and shelves from playlist summaries.
 */
export function filterShortsFromPlaylists(
  playlists: PlaylistSummary[],
  enabled: boolean = true,
): PlaylistSummary[] {
  if (!enabled || !Array.isArray(playlists)) return playlists || []

  return playlists.filter((playlist) => {
    const short =
      isYouTubeShort(playlist) || playlist.id.startsWith('SS') || /^shorts$/i.test(playlist.title)
    if (short) {
      metrics.shortsDetected++
      metrics.itemsFiltered++
    }
    return !short
  })
}

/**
 * Filters YouTube Shorts from browse and discovery shelves.
 * Excludes entire shorts shelves and strips individual short items.
 * Omit shelves that become completely empty (matching upstream ifEmpty { null }).
 */
export function filterShortsFromShelves(shelves: HomeShelf[], enabled: boolean = true): HomeShelf[] {
  if (!enabled || !Array.isArray(shelves)) return shelves || []

  const result: HomeShelf[] = []

  for (const shelf of shelves) {
    // If shelf title explicitly denotes Shorts, discard the shelf
    if (
      /^#?shorts$/i.test(shelf.title.trim()) ||
      /^youtube shorts$/i.test(shelf.title.trim()) ||
      shelf.title.toLowerCase().includes('trending shorts')
    ) {
      metrics.shelvesFiltered++
      continue
    }

    const filteredItems = shelf.items.filter((item) => {
      const short = isYouTubeShort(item)
      if (short) {
        metrics.shortsDetected++
        metrics.itemsFiltered++
      }
      return !short
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
 * Filters YouTube Shorts from search result catalogs.
 */
export function filterShortsFromSearchResults(
  catalog: SearchResultCatalog,
  enabled: boolean = true,
): SearchResultCatalog {
  if (!enabled) return catalog

  return {
    tracks: filterShortsFromTracks(catalog.tracks, true),
    albums: catalog.albums,
    artists: catalog.artists,
    playlists: filterShortsFromPlaylists(catalog.playlists, true),
  }
}
