/**
 * Spotify Playlist Detail Service for Echo Music Web
 *
 * Implements playlist metadata, track pagination, track playback resolution,
 * and library import matching upstream Echo Music architecture:
 * - SpotifyPlaylistDetailViewModel.kt
 * - SpotifyPlaylistDetailScreen.kt
 * - SpotifyQueue.kt
 */

import { z } from 'zod'
import { matchSingleTrack, type TrackMatch } from './spotifyMatchingService.ts'
import { getStoredSpotifySession } from './spotifyLibraryService.ts'
import { useEchoStore } from '../../stores/useEchoStore.ts'
import type { Track } from '../../types/domain.ts'

// ============================================================================
// Schemas
// ============================================================================

export const spotifyPlaylistTrackSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  artist: z.string().min(1),
  album: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  isrc: z.string().optional(),
  artworkUrl: z.string().optional(),
})

export type SpotifyPlaylistTrack = z.infer<typeof spotifyPlaylistTrackSchema>

export const spotifyPlaylistDetailSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  coverUrl: z.string().optional(),
  ownerName: z.string().optional(),
  totalTracks: z.number().nonnegative(),
  offset: z.number().nonnegative().default(0),
  limit: z.number().nonnegative().default(50),
  hasMore: z.boolean().default(false),
  tracks: z.array(spotifyPlaylistTrackSchema).default([]),
})

export type SpotifyPlaylistDetail = z.infer<typeof spotifyPlaylistDetailSchema>

export const spotifyPlaylistDetailMetricsSchema = z.object({
  detailLoadsCount: z.number().nonnegative(),
  tracksFetchedCount: z.number().nonnegative(),
  tracksResolvedCount: z.number().nonnegative(),
  playAllTriggersCount: z.number().nonnegative(),
  shuffleTriggersCount: z.number().nonnegative(),
  importsCount: z.number().nonnegative(),
})

export type SpotifyPlaylistDetailMetrics = z.infer<typeof spotifyPlaylistDetailMetricsSchema>

// ============================================================================
// Telemetry State
// ============================================================================

let detailMetrics: SpotifyPlaylistDetailMetrics = {
  detailLoadsCount: 0,
  tracksFetchedCount: 0,
  tracksResolvedCount: 0,
  playAllTriggersCount: 0,
  shuffleTriggersCount: 0,
  importsCount: 0,
}

export function recordSpotifyPlaylistDetailMetric(
  key: keyof SpotifyPlaylistDetailMetrics,
  delta = 1,
): void {
  if (key in detailMetrics) {
    detailMetrics[key] += delta
  }
}

export function getSpotifyPlaylistDetailMetrics(): SpotifyPlaylistDetailMetrics {
  return { ...detailMetrics }
}

export function resetSpotifyPlaylistDetailMetrics(): void {
  detailMetrics = {
    detailLoadsCount: 0,
    tracksFetchedCount: 0,
    tracksResolvedCount: 0,
    playAllTriggersCount: 0,
    shuffleTriggersCount: 0,
    importsCount: 0,
  }
}

// ============================================================================
// Playlist Detail Fetching
// ============================================================================

export interface FetchSpotifyPlaylistOptions {
  offset?: number | undefined
  limit?: number | undefined
  token?: string | undefined
}

export async function fetchSpotifyPlaylistDetail(
  rawPlaylistId: string,
  options: FetchSpotifyPlaylistOptions = {},
): Promise<SpotifyPlaylistDetail> {
  const playlistId = rawPlaylistId.replace(/^spotify_/, '').trim()
  if (!playlistId) {
    throw new Error('Valid playlist ID is required')
  }

  recordSpotifyPlaylistDetailMetric('detailLoadsCount')

  const offset = options.offset ?? 0
  const limit = Math.min(options.limit ?? 50, 100)
  const session = getStoredSpotifySession()
  const token = options.token || session?.token

  // Case 1: Liked songs playlist
  if (playlistId === 'liked' || playlistId === 'spotify-liked') {
    if (!token) {
      throw new Error('Authentication required for Spotify Liked Songs')
    }

    const res = await fetch(`/api/spotify/me/tracks?offset=${offset}&limit=${limit}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      throw new Error(`Failed to load liked songs: ${res.statusText}`)
    }

    const data = await res.json()
    const tracks: SpotifyPlaylistTrack[] = (data.tracks || []).map((t: any, idx: number) => ({
      id: `liked_${offset + idx}_${t.title}`,
      title: t.title,
      artist: t.artist,
      album: t.album,
      durationMs: t.durationMs,
      isrc: t.isrc,
    }))

    recordSpotifyPlaylistDetailMetric('tracksFetchedCount', tracks.length)

    return spotifyPlaylistDetailSchema.parse({
      id: 'liked',
      title: 'Liked Songs',
      description: 'Your saved tracks from Spotify',
      coverUrl: 'https://misc.scdn.co/liked-songs/liked-songs-640.png',
      ownerName: session?.profile?.displayName || 'You',
      totalTracks: data.total || tracks.length,
      offset,
      limit,
      hasMore: data.hasMore ?? offset + tracks.length < (data.total || 0),
      tracks,
    })
  }

  // Case 2: Standard Spotify playlist by ID or URL
  const targetUrl = `https://open.spotify.com/playlist/${playlistId}`
  const authHeaders: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}

  const res = await fetch(
    `/api/spotify/resolve?url=${encodeURIComponent(targetUrl)}&offset=${offset}&limit=${limit}`,
    { headers: authHeaders },
  )

  if (!res.ok) {
    throw new Error(`Failed to load Spotify playlist: ${res.statusText}`)
  }

  const data = await res.json()
  const tracks: SpotifyPlaylistTrack[] = (data.tracks || []).map((t: any, idx: number) => ({
    id: `track_${offset + idx}_${t.title}`,
    title: t.title,
    artist: t.artist,
    album: t.album,
    durationMs: t.durationMs,
    isrc: t.isrc,
  }))

  recordSpotifyPlaylistDetailMetric('tracksFetchedCount', tracks.length)

  return spotifyPlaylistDetailSchema.parse({
    id: playlistId,
    title: data.title || 'Spotify Playlist',
    description: data.description,
    coverUrl: data.coverUrl,
    ownerName: data.ownerName || 'Spotify',
    totalTracks: data.totalTracks || tracks.length,
    offset,
    limit,
    hasMore: data.hasMore ?? offset + tracks.length < (data.totalTracks || 0),
    tracks,
  })
}

// ============================================================================
// Playback Resolution
// ============================================================================

const resolvedTrackCache = new Map<string, Track>()

export async function resolveSpotifyTrack(
  track: SpotifyPlaylistTrack,
): Promise<Track | null> {
  const cacheKey = `${track.title}__${track.artist}`.toLowerCase()
  const cached = resolvedTrackCache.get(cacheKey)
  if (cached) {
    return cached
  }

  try {
    const match: TrackMatch | null = await matchSingleTrack({
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationMs: track.durationMs,
      isrc: track.isrc,
    })

    if (match && match.track) {
      resolvedTrackCache.set(cacheKey, match.track)
      recordSpotifyPlaylistDetailMetric('tracksResolvedCount')
      return match.track
    }
  } catch {
    // Non-fatal
  }

  // Fallback synthetic track representation if matching is unavailable
  const fallbackTrack: Track = {
    id: `sp_${track.id}`,
    videoId: `sp_${track.id}`,
    title: track.title,
    artistName: track.artist,
    artistId: `sp_art_${track.artist.toLowerCase().replace(/\s+/g, '_')}`,
    albumId: 'spotify_album',
    albumTitle: track.album || 'Spotify Track',
    albumImage: track.artworkUrl || '',
    artwork: track.artworkUrl || '',
    durationMs: track.durationMs || 180000,
    durationSeconds: Math.round((track.durationMs || 180000) / 1000),
    explicit: false,
    playCount: 0,
  }

  return fallbackTrack
}

// ============================================================================
// Library Import
// ============================================================================

export function importSpotifyPlaylistToLibrary(
  playlistDetail: SpotifyPlaylistDetail,
  tracks: Track[],
): string {
  recordSpotifyPlaylistDetailMetric('importsCount')
  const store = useEchoStore.getState()
  const playlistId = store.createPlaylist(
    playlistDetail.title,
    playlistDetail.description || 'Imported from Spotify',
  )

  for (const track of tracks) {
    store.addTrackToPlaylist(playlistId, track)
  }

  return playlistId
}
