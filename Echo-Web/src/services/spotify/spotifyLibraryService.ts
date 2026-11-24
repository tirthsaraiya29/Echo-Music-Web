/**
 * Spotify Live Library Service for Echo Music Web
 *
 * Implements authentication, profile discovery, liked songs counting,
 * user saved playlists retrieval, and sorting matching upstream Echo Music
 * architecture:
 * - LibrarySpotifyViewModel.kt
 * - LibrarySpotifyScreen.kt
 * - Spotify.kt
 */

import { z } from 'zod'

// ============================================================================
// Schemas
// ============================================================================

export const spotifyUserProfileSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().optional(),
  avatarUrl: z.string().optional(),
  product: z.string().optional(), // 'premium', 'free', etc.
  followers: z.number().nonnegative().optional(),
})

export type SpotifyUserProfile = z.infer<typeof spotifyUserProfileSchema>

export const spotifyLibraryPlaylistSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  coverUrl: z.string().optional(),
  trackCount: z.number().nonnegative().default(0),
  ownerName: z.string().optional(),
  isPublic: z.boolean().optional(),
})

export type SpotifyLibraryPlaylist = z.infer<typeof spotifyLibraryPlaylistSchema>

export const spotifyLibraryUiStateSchema = z.object({
  isAuthenticated: z.boolean(),
  accountName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  product: z.string().nullable().optional(),
  playlists: z.array(spotifyLibraryPlaylistSchema),
  likedSongsCount: z.number().nullable(),
  isLoading: z.boolean(),
  error: z.string().nullable(),
})

export type SpotifyLibraryUiState = z.infer<typeof spotifyLibraryUiStateSchema>

export const spotifyLibraryMetricsSchema = z.object({
  authSuccessCount: z.number().nonnegative(),
  authFailureCount: z.number().nonnegative(),
  profileLoadsCount: z.number().nonnegative(),
  playlistsLoadedCount: z.number().nonnegative(),
  likedSongsLoadedCount: z.number().nonnegative(),
  syncOperationsCount: z.number().nonnegative(),
})

export type SpotifyLibraryMetrics = z.infer<typeof spotifyLibraryMetricsSchema>

export type SpotifyPlaylistSortType = 'DEFAULT' | 'NAME' | 'SONG_COUNT'

export const SPOTIFY_LIKED_SONGS_COVER = 'https://misc.scdn.co/liked-songs/liked-songs-640.png'

// ============================================================================
// Telemetry Metrics
// ============================================================================

let spotifyMetrics: SpotifyLibraryMetrics = {
  authSuccessCount: 0,
  authFailureCount: 0,
  profileLoadsCount: 0,
  playlistsLoadedCount: 0,
  likedSongsLoadedCount: 0,
  syncOperationsCount: 0,
}

export function recordSpotifyLibraryMetric(key: keyof SpotifyLibraryMetrics, delta = 1): void {
  if (key in spotifyMetrics) {
    spotifyMetrics[key] += delta
  }
}

export function getSpotifyLibraryMetrics(): SpotifyLibraryMetrics {
  return { ...spotifyMetrics }
}

export function resetSpotifyLibraryMetrics(): void {
  spotifyMetrics = {
    authSuccessCount: 0,
    authFailureCount: 0,
    profileLoadsCount: 0,
    playlistsLoadedCount: 0,
    likedSongsLoadedCount: 0,
    syncOperationsCount: 0,
  }
}

// ============================================================================
// Local Storage Session Management
// ============================================================================

const SPOTIFY_SESSION_KEY = 'echo_spotify_live_session'

export interface StoredSpotifySession {
  token: string
  profile?: SpotifyUserProfile | undefined
  savedAt: number
}

export function getStoredSpotifySession(): StoredSpotifySession | null {
  try {
    const raw = localStorage.getItem(SPOTIFY_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSpotifySession
    if (parsed && typeof parsed.token === 'string' && parsed.token.trim()) {
      return parsed
    }
  } catch {
    // Non-fatal
  }
  return null
}

export function setStoredSpotifySession(token: string, profile?: SpotifyUserProfile): void {
  try {
    const session: StoredSpotifySession = {
      token: token.trim(),
      profile,
      savedAt: Date.now(),
    }
    localStorage.setItem(SPOTIFY_SESSION_KEY, JSON.stringify(session))
    recordSpotifyLibraryMetric('authSuccessCount')
  } catch {
    // Non-fatal
  }
}

export function clearStoredSpotifySession(): void {
  try {
    localStorage.removeItem(SPOTIFY_SESSION_KEY)
  } catch {
    // Non-fatal
  }
}

// ============================================================================
// Spotify API Client Functions
// ============================================================================

function getAuthHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

export async function fetchSpotifyProfile(token: string): Promise<SpotifyUserProfile> {
  if (!token || !token.trim()) {
    throw new Error('Spotify access token is required')
  }

  recordSpotifyLibraryMetric('profileLoadsCount')

  // Try Echo-Web backend proxy first
  try {
    const res = await fetch('/api/spotify/me', {
      headers: { Authorization: `Bearer ${token.trim()}` },
    })
    if (res.ok) {
      const data = await res.json()
      return spotifyUserProfileSchema.parse({
        id: data.id || 'spotify_user',
        displayName: data.displayName || data.display_name || 'Spotify User',
        email: data.email,
        avatarUrl: data.avatarUrl || data.images?.[0]?.url,
        product: data.product,
        followers: data.followers,
      })
    }
  } catch {
    // Fall back to direct Spotify Web API
  }

  // Direct Spotify Web API fallback
  const directRes = await fetch('https://api.spotify.com/v1/me', {
    headers: getAuthHeaders(token.trim()),
  })

  if (!directRes.ok) {
    recordSpotifyLibraryMetric('authFailureCount')
    throw new Error(`Failed to fetch Spotify profile (${directRes.status}: ${directRes.statusText})`)
  }

  const raw = await directRes.json()
  return spotifyUserProfileSchema.parse({
    id: raw.id || 'spotify_user',
    displayName: raw.display_name || raw.id || 'Spotify User',
    email: raw.email,
    avatarUrl: raw.images?.[0]?.url,
    product: raw.product,
    followers: raw.followers?.total || 0,
  })
}

export async function fetchSpotifyLibraryPlaylists(
  token: string,
  offset = 0,
  limit = 50,
): Promise<{ total: number; items: SpotifyLibraryPlaylist[] }> {
  if (!token || !token.trim()) {
    throw new Error('Spotify access token is required')
  }

  recordSpotifyLibraryMetric('syncOperationsCount')

  // Try backend proxy first
  try {
    const res = await fetch(`/api/spotify/me/playlists?offset=${offset}&limit=${limit}`, {
      headers: { Authorization: `Bearer ${token.trim()}` },
    })
    if (res.ok) {
      const data = await res.json()
      const items = (data.items || []).map((p: any) =>
        spotifyLibraryPlaylistSchema.parse({
          id: p.id,
          title: p.title || p.name || 'Untitled Playlist',
          description: p.description,
          coverUrl: p.coverUrl || p.images?.[0]?.url,
          trackCount: p.trackCount ?? p.tracks?.total ?? 0,
          ownerName: p.owner?.display_name || p.ownerName,
          isPublic: p.public ?? p.isPublic,
        }),
      )
      recordSpotifyLibraryMetric('playlistsLoadedCount', items.length)
      return { total: data.total || items.length, items }
    }
  } catch {
    // Fall back to direct API
  }

  // Direct Spotify Web API fallback
  const directRes = await fetch(
    `https://api.spotify.com/v1/me/playlists?offset=${offset}&limit=${limit}`,
    { headers: getAuthHeaders(token.trim()) },
  )

  if (!directRes.ok) {
    throw new Error(`Failed to load playlists (${directRes.status}: ${directRes.statusText})`)
  }

  const data = await directRes.json()
  const items = (data.items || []).map((p: any) =>
    spotifyLibraryPlaylistSchema.parse({
      id: p.id,
      title: p.name || 'Untitled Playlist',
      description: p.description,
      coverUrl: p.images?.[0]?.url,
      trackCount: p.tracks?.total ?? 0,
      ownerName: p.owner?.display_name,
      isPublic: p.public,
    }),
  )

  recordSpotifyLibraryMetric('playlistsLoadedCount', items.length)
  return { total: data.total || items.length, items }
}

export async function fetchSpotifyLikedSongsCount(token: string): Promise<number> {
  if (!token || !token.trim()) return 0

  try {
    // Try backend proxy
    const res = await fetch('/api/spotify/me/tracks?offset=0&limit=1', {
      headers: { Authorization: `Bearer ${token.trim()}` },
    })
    if (res.ok) {
      const data = await res.json()
      const total = typeof data.total === 'number' ? data.total : 0
      recordSpotifyLibraryMetric('likedSongsLoadedCount', total)
      return total
    }
  } catch {
    // Direct API fallback
  }

  try {
    const directRes = await fetch('https://api.spotify.com/v1/me/tracks?limit=1', {
      headers: getAuthHeaders(token.trim()),
    })
    if (directRes.ok) {
      const data = await directRes.json()
      const total = typeof data.total === 'number' ? data.total : 0
      recordSpotifyLibraryMetric('likedSongsLoadedCount', total)
      return total
    }
  } catch {
    // Non-fatal
  }

  return 0
}

// ============================================================================
// Playlist Sorting Logic (Matching upstream SpotifyPlaylistSortType)
// ============================================================================

export function sortSpotifyPlaylists(
  playlists: SpotifyLibraryPlaylist[],
  sortType: SpotifyPlaylistSortType,
  sortDescending = false,
): SpotifyLibraryPlaylist[] {
  const copy = [...playlists]

  switch (sortType) {
    case 'NAME':
      copy.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
      break
    case 'SONG_COUNT':
      copy.sort((a, b) => a.trackCount - b.trackCount)
      break
    case 'DEFAULT':
    default:
      // Preserves original Spotify library ordering
      break
  }

  if (sortDescending) {
    copy.reverse()
  }

  return copy
}
