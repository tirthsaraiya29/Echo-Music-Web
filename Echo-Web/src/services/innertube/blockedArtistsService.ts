import { z } from 'zod'
import type { Track, Album, Artist, PlaylistSummary, HomeShelf, SearchResultCatalog } from '../../types/domain.ts'

export const blockedArtistEntrySchema = z.string().trim().min(1)

export const blockedArtistsMetricsSchema = z.object({
  totalEvaluated: z.number().nonnegative(),
  blockedDetected: z.number().nonnegative(),
  itemsFiltered: z.number().nonnegative(),
  shelvesFiltered: z.number().nonnegative(),
})

export type BlockedArtistsMetrics = z.infer<typeof blockedArtistsMetricsSchema>

const metrics: BlockedArtistsMetrics = {
  totalEvaluated: 0,
  blockedDetected: 0,
  itemsFiltered: 0,
  shelvesFiltered: 0,
}

export function getBlockedArtistsMetrics(): BlockedArtistsMetrics {
  return { ...metrics }
}

export function resetBlockedArtistsMetrics(): void {
  metrics.totalEvaluated = 0
  metrics.blockedDetected = 0
  metrics.itemsFiltered = 0
  metrics.shelvesFiltered = 0
}

/**
 * Formats artist ID and name into upstream storage format: "id||name".
 */
export function formatBlockedArtistEntry(id: string, name: string): string {
  const cleanId = id.trim()
  const cleanName = name.trim() || 'Unknown Artist'
  return `${cleanId}||${cleanName}`
}

/**
 * Parses upstream storage format into structured object.
 */
export function parseBlockedArtistEntry(entry: string): { id: string; name: string } {
  if (entry.includes('||')) {
    const [id, ...rest] = entry.split('||')
    return {
      id: id?.trim() || '',
      name: rest.join('||').trim() || 'Unknown Artist',
    }
  }
  return { id: entry.trim(), name: entry.trim() }
}

/**
 * Normalizes a blocked artist list into fast-lookup ID and Name sets.
 */
export function extractBlockedSets(blockedArtists: string[]): {
  blockedIds: Set<string>
  blockedNames: Set<string>
} {
  const blockedIds = new Set<string>()
  const blockedNames = new Set<string>()

  if (!Array.isArray(blockedArtists)) return { blockedIds, blockedNames }

  for (const entry of blockedArtists) {
    if (!entry) continue
    const parsed = parseBlockedArtistEntry(entry)
    if (parsed.id) blockedIds.add(parsed.id)
    if (parsed.name) blockedNames.add(parsed.name.toLowerCase())
  }

  return { blockedIds, blockedNames }
}

/**
 * Checks whether an artist is blocked by ID or Name.
 */
export function isArtistBlocked(
  artistId: string,
  artistName: string | undefined,
  blockedArtists: string[],
): boolean {
  if (!blockedArtists || blockedArtists.length === 0) return false
  metrics.totalEvaluated++

  const { blockedIds, blockedNames } = extractBlockedSets(blockedArtists)
  if (artistId && blockedIds.has(artistId)) return true
  if (artistName && blockedNames.has(artistName.trim().toLowerCase())) return true

  return false
}

/**
 * Checks whether a track belongs to a blocked artist.
 */
export function isTrackBlocked(track: Track, blockedArtists: string[]): boolean {
  if (!blockedArtists || blockedArtists.length === 0) return false
  metrics.totalEvaluated++

  const { blockedIds, blockedNames } = extractBlockedSets(blockedArtists)

  if (track.artistId && blockedIds.has(track.artistId)) return true
  if (track.artistName && blockedNames.has(track.artistName.trim().toLowerCase())) return true

  if (Array.isArray(track.artists)) {
    for (const art of track.artists) {
      if (art.id && blockedIds.has(art.id)) return true
      if (art.name && blockedNames.has(art.name.trim().toLowerCase())) return true
    }
  }

  return false
}

/**
 * Checks whether an album belongs to a blocked artist.
 */
export function isAlbumBlocked(album: Album, blockedArtists: string[]): boolean {
  if (!blockedArtists || blockedArtists.length === 0) return false
  metrics.totalEvaluated++

  const { blockedIds, blockedNames } = extractBlockedSets(blockedArtists)

  if (album.artistId && blockedIds.has(album.artistId)) return true
  if (album.artistName && blockedNames.has(album.artistName.trim().toLowerCase())) return true

  if (Array.isArray(album.artists)) {
    for (const art of album.artists) {
      if (art.id && blockedIds.has(art.id)) return true
      if (art.name && blockedNames.has(art.name.trim().toLowerCase())) return true
    }
  }

  return false
}

/**
 * Checks whether a playlist author is a blocked artist.
 */
export function isPlaylistBlocked(playlist: PlaylistSummary, blockedArtists: string[]): boolean {
  if (!blockedArtists || blockedArtists.length === 0) return false
  metrics.totalEvaluated++

  const { blockedNames } = extractBlockedSets(blockedArtists)
  if (playlist.author && blockedNames.has(playlist.author.trim().toLowerCase())) return true

  return false
}

/**
 * Filters out tracks by blocked artists.
 */
export function filterBlockedArtistsFromTracks(tracks: Track[], blockedArtists: string[]): Track[] {
  if (!blockedArtists || blockedArtists.length === 0 || !Array.isArray(tracks)) {
    return tracks || []
  }

  return tracks.filter((track) => {
    const blocked = isTrackBlocked(track, blockedArtists)
    if (blocked) {
      metrics.blockedDetected++
      metrics.itemsFiltered++
    }
    return !blocked
  })
}

/**
 * Filters out blocked artists, their albums, tracks, and playlists from shelves.
 * Drops shelves that become empty after filtering.
 */
export function filterBlockedArtistsFromShelves(
  shelves: HomeShelf[],
  blockedArtists: string[],
): HomeShelf[] {
  if (!blockedArtists || blockedArtists.length === 0 || !Array.isArray(shelves)) {
    return shelves || []
  }

  const { blockedIds, blockedNames } = extractBlockedSets(blockedArtists)
  const result: HomeShelf[] = []

  for (const shelf of shelves) {
    const filteredItems = shelf.items.filter((item) => {
      let blocked = false
      if ('durationSeconds' in item || 'durationMs' in item) {
        blocked = isTrackBlocked(item as Track, blockedArtists)
      } else if ('type' in item || 'year' in item) {
        blocked = isAlbumBlocked(item as Album, blockedArtists)
      } else if ('verified' in item) {
        const art = item as unknown as Artist
        blocked = Boolean(
          (art.id && blockedIds.has(art.id)) ||
            (art.name && blockedNames.has(art.name.toLowerCase())),
        )
      } else if ('author' in item) {
        blocked = isPlaylistBlocked(item as PlaylistSummary, blockedArtists)
      }

      if (blocked) {
        metrics.blockedDetected++
        metrics.itemsFiltered++
      }
      return !blocked
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
 * Filters blocked artists, tracks, albums, and playlists from search results.
 */
export function filterBlockedArtistsFromSearchResults(
  catalog: SearchResultCatalog,
  blockedArtists: string[],
): SearchResultCatalog {
  if (!blockedArtists || blockedArtists.length === 0) return catalog

  const { blockedIds, blockedNames } = extractBlockedSets(blockedArtists)

  return {
    tracks: filterBlockedArtistsFromTracks(catalog.tracks, blockedArtists),
    albums: catalog.albums.filter((album) => !isAlbumBlocked(album, blockedArtists)),
    artists: catalog.artists.filter((artist) => {
      const blocked =
        (artist.id && blockedIds.has(artist.id)) ||
        (artist.name && blockedNames.has(artist.name.trim().toLowerCase()))
      if (blocked) {
        metrics.blockedDetected++
        metrics.itemsFiltered++
      }
      return !blocked
    }),
    playlists: catalog.playlists.filter((playlist) => !isPlaylistBlocked(playlist, blockedArtists)),
  }
}

/**
 * Filters tracks by blocked artists from an active playback queue.
 */
export function filterBlockedArtistsFromQueue(queue: Track[], blockedArtists: string[]): Track[] {
  return filterBlockedArtistsFromTracks(queue, blockedArtists)
}
