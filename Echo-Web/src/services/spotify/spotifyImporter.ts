import { InnerTubeClient } from '../innertube/client.ts'
import type { Track } from '../../types/domain.ts'

export interface SpotifyTrackTarget {
  title: string
  artist: string
  album?: string | undefined
  durationMs?: number | undefined
  isrc?: string | undefined
}

export interface TrackMatch {
  track: Track
  score: number
  confidence: 'high' | 'medium' | 'low'
}

export const MIN_ACCEPTABLE_SCORE = 45

const VERSION_KEYWORDS = [
  'remix',
  'live',
  'acoustic',
  'instrumental',
  'karaoke',
  'cover',
  'slowed',
  'reverb',
  'sped up',
  'radio edit',
  'extended',
]

function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripSecondaryMetadata(text: string): string {
  return text
    .replace(/\(feat\..*?\)/gi, '')
    .replace(/\[feat\..*?\]/gi, '')
    .replace(/\(ft\..*?\)/gi, '')
    .replace(/\[ft\..*?\]/gi, '')
    .replace(/\(with.*?\)/gi, '')
    .replace(/\[with.*?\]/gi, '')
    .replace(/\(remaster.*?\)/gi, '')
    .replace(/\[remaster.*?\]/gi, '')
    .replace(/\(official.*?\)/gi, '')
    .replace(/\[official.*?\]/gi, '')
    .replace(/\(audio.*?\)/gi, '')
    .replace(/\[audio.*?\]/gi, '')
    .replace(/\(video.*?\)/gi, '')
    .replace(/\[video.*?\]/gi, '')
    .trim()
}

export function scoreCandidate(target: SpotifyTrackTarget, candidate: Track): number {
  // If ISRCs match exactly, instant 100
  if (
    target.isrc &&
    candidate.isrc &&
    target.isrc.trim().toUpperCase() === candidate.isrc.trim().toUpperCase()
  ) {
    return 100
  }

  let score = 0
  const targetTitleNorm = normalizeText(target.title)
  const candidateTitleNorm = normalizeText(candidate.title || '')

  const targetTitleCore = normalizeText(stripSecondaryMetadata(target.title))
  const candidateTitleCore = normalizeText(stripSecondaryMetadata(candidate.title || ''))

  // 1. Title match (up to 40 points)
  if (targetTitleNorm === candidateTitleNorm) {
    score += 40
  } else if (targetTitleCore && targetTitleCore === candidateTitleCore) {
    score += 35
  } else if (targetTitleCore && candidateTitleNorm.includes(targetTitleCore)) {
    score += 25
  } else if (candidateTitleCore && targetTitleNorm.includes(candidateTitleCore)) {
    score += 20
  } else {
    // Token overlap
    const targetWords = new Set(targetTitleCore.split(' ').filter(Boolean))
    const candWords = new Set(candidateTitleCore.split(' ').filter(Boolean))
    let intersection = 0
    for (const w of targetWords) {
      if (candWords.has(w)) intersection++
    }
    const union = new Set([...targetWords, ...candWords]).size
    if (union > 0) {
      score += Math.round((intersection / union) * 20)
    }
  }

  // 2. Artist match (up to 30 points)
  const targetArtistNorm = normalizeText(target.artist)
  const candidateArtistNorm = normalizeText(candidate.artistName || '')

  if (targetArtistNorm === candidateArtistNorm) {
    score += 30
  } else if (
    (targetArtistNorm && candidateArtistNorm.includes(targetArtistNorm)) ||
    (candidateArtistNorm && targetArtistNorm.includes(candidateArtistNorm))
  ) {
    score += 25
  } else {
    const targetPrimary = targetArtistNorm.split(/\band\b|&|,|\bfeat\b|\bft\b/)[0]?.trim()
    const candidatePrimary = candidateArtistNorm.split(/\band\b|&|,|\bfeat\b|\bft\b/)[0]?.trim()
    if (
      targetPrimary &&
      candidatePrimary &&
      (targetPrimary === candidatePrimary || candidateArtistNorm.includes(targetPrimary))
    ) {
      score += 20
    }
  }

  // 3. Duration match (up to 20 points, or penalty)
  const targetDurationSec =
    target.durationMs && target.durationMs > 0 ? target.durationMs / 1000 : undefined
  const candidateDurationSec =
    candidate.durationSeconds ||
    (candidate.durationMs && candidate.durationMs > 0 ? candidate.durationMs / 1000 : undefined)

  if (
    targetDurationSec !== undefined &&
    candidateDurationSec !== undefined &&
    targetDurationSec > 0 &&
    candidateDurationSec > 0
  ) {
    const delta = Math.abs(targetDurationSec - candidateDurationSec)
    if (delta <= 3) {
      score += 20
    } else if (delta <= 8) {
      score += 15
    } else if (delta <= 15) {
      score += 10
    } else if (delta <= 30) {
      score += 5
    } else if (delta > 60) {
      score -= 30
    }
  }

  // 4. Version Keyword Consistency Check
  for (const kw of VERSION_KEYWORDS) {
    const targetHasKw = targetTitleNorm.includes(kw)
    const candidateHasKw = candidateTitleNorm.includes(kw)

    if (!targetHasKw && candidateHasKw) {
      // Target was not remix/live/etc., but candidate is
      score -= 35
    } else if (targetHasKw && !candidateHasKw) {
      score -= 20
    } else if (targetHasKw && candidateHasKw) {
      score += 10
    }
  }

  return Math.max(0, score)
}

export function findBestTrackMatch(
  target: SpotifyTrackTarget,
  candidates: Track[],
): TrackMatch | null {
  if (!candidates || candidates.length === 0) return null

  let bestMatch: TrackMatch | null = null

  for (const candidate of candidates) {
    const score = scoreCandidate(target, candidate)
    if (!bestMatch || score > bestMatch.score) {
      const confidence: 'high' | 'medium' | 'low' =
        score >= 70 ? 'high' : score >= MIN_ACCEPTABLE_SCORE ? 'medium' : 'low'
      bestMatch = { track: candidate, score, confidence }
    }
  }

  if (bestMatch && bestMatch.score >= MIN_ACCEPTABLE_SCORE) {
    return bestMatch
  }

  return null
}

export interface SpotifyImportProgress {
  current: number
  total: number
  currentTitle: string
  matchedCount: number
}

export interface SpotifyImportResult {
  title: string
  description: string
  coverUrl?: string | undefined
  totalSpotifyTracks: number
  matchedTracks: Track[]
  unmatchedTitles: string[]
}

export function isSpotifyUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim())
    return (
      (parsed.hostname === 'open.spotify.com' || parsed.hostname === 'spotify.link') &&
      Boolean(parsed.pathname)
    )
  } catch {
    return false
  }
}

export async function importFromSpotify(
  spotifyUrl: string,
  onProgress?: (progress: SpotifyImportProgress) => void,
  signal?: AbortSignal,
): Promise<SpotifyImportResult> {
  const resolveRes = await fetch(
    `/api/spotify/resolve?url=${encodeURIComponent(spotifyUrl.trim())}`,
    {
      ...(signal ? { signal } : {}),
    },
  )
  if (!resolveRes.ok) {
    const errData = await resolveRes.json().catch(() => ({}))
    throw new Error(
      errData.error ||
        errData.message ||
        `Failed to resolve Spotify URL (HTTP ${resolveRes.status})`,
    )
  }

  const spotifyData = (await resolveRes.json()) as {
    title: string
    description?: string | undefined
    coverUrl?: string | undefined
    totalTracks?: number | undefined
    hasMore?: boolean | undefined
    tracks: Array<{
      title: string
      artist: string
      album?: string | undefined
      durationMs?: number | undefined
      isrc?: string | undefined
    }>
  }

  const allSpotifyTracks = [...(spotifyData.tracks || [])]
  let currentOffset = allSpotifyTracks.length

  // Paginate if more tracks exist
  while (
    spotifyData.hasMore &&
    (!spotifyData.totalTracks || allSpotifyTracks.length < spotifyData.totalTracks) &&
    currentOffset < 1000
  ) {
    if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError')
    try {
      const pageRes = await fetch(
        `/api/spotify/resolve?url=${encodeURIComponent(spotifyUrl.trim())}&offset=${currentOffset}&limit=100`,
        { ...(signal ? { signal } : {}) },
      )
      if (!pageRes.ok) break
      const pageData = (await pageRes.json()) as {
        tracks?: typeof allSpotifyTracks
        hasMore?: boolean
      }
      if (pageData.tracks && pageData.tracks.length > 0) {
        allSpotifyTracks.push(...pageData.tracks)
        currentOffset += pageData.tracks.length
        if (!pageData.hasMore) break
      } else {
        break
      }
    } catch {
      break
    }
  }

  if (allSpotifyTracks.length === 0) {
    throw new Error('No tracks found in the provided Spotify link')
  }

  const total = allSpotifyTracks.length
  const matchedTracks: Track[] = []
  const unmatchedTitles: string[] = []

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) {
      throw new DOMException('Import cancelled', 'AbortError')
    }
    const item = allSpotifyTracks[i]!
    const query = `${item.title} ${item.artist}`.trim()

    onProgress?.({
      current: i + 1,
      total,
      currentTitle: `${item.title} - ${item.artist}`,
      matchedCount: matchedTracks.length,
    })

    try {
      const searchCatalog = await InnerTubeClient.search(query, 'songs')
      if (searchCatalog.tracks && searchCatalog.tracks.length > 0) {
        const match = findBestTrackMatch(item, searchCatalog.tracks)
        if (match) {
          matchedTracks.push(match.track)
        } else {
          unmatchedTitles.push(query)
        }
      } else {
        unmatchedTitles.push(query)
      }
    } catch {
      if (signal?.aborted) {
        throw new DOMException('Import cancelled', 'AbortError')
      }
      unmatchedTitles.push(query)
    }

    if (i < total - 1) {
      await new Promise((r) => setTimeout(r, 120))
    }
  }

  return {
    title: spotifyData.title || 'Imported Spotify Playlist',
    description: `Imported from Spotify (${matchedTracks.length} of ${total} tracks matched)`,
    coverUrl: spotifyData.coverUrl,
    totalSpotifyTracks: total,
    matchedTracks,
    unmatchedTitles,
  }
}

export interface SpotifyUserPlaylist {
  id: string
  title: string
  description?: string | undefined
  coverUrl?: string | undefined
  trackCount: number
}

export interface SpotifyPaginatedResponse<T> {
  total: number
  offset: number
  limit: number
  hasMore: boolean
  items: T[]
}

export async function fetchSpotifyUserPlaylists(
  token: string,
  offset = 0,
  limit = 50,
): Promise<SpotifyPaginatedResponse<SpotifyUserPlaylist>> {
  const res = await fetch(`/api/spotify/me/playlists?offset=${offset}&limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch Spotify playlists (HTTP ${res.status})`)
  }
  return (await res.json()) as SpotifyPaginatedResponse<SpotifyUserPlaylist>
}

export async function fetchSpotifyUserSavedTracks(
  token: string,
  offset = 0,
  limit = 50,
): Promise<SpotifyPaginatedResponse<SpotifyTrackTarget>> {
  const res = await fetch(`/api/spotify/me/tracks?offset=${offset}&limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch Spotify saved tracks (HTTP ${res.status})`)
  }
  const data = (await res.json()) as {
    total: number
    offset: number
    limit: number
    hasMore: boolean
    tracks: SpotifyTrackTarget[]
  }
  return {
    total: data.total,
    offset: data.offset,
    limit: data.limit,
    hasMore: data.hasMore,
    items: data.tracks,
  }
}
