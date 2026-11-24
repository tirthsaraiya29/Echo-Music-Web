import type { Track } from '../../types/domain.ts'
import {
  spotifyUrlInputSchema,
  spotifyResolvedDataSchema,
  recordSpotifyUrlMetric,
  type SpotifyResolvedData,
} from './spotifyUrlTypes.ts'
import {
  scoreCandidate,
  findBestTrackMatch,
  matchSingleTrack,
  matchTrackBatch,
  clearSpotifyMatchingCache,
  MIN_ACCEPTABLE_SCORE,
  type SpotifyTrackTarget,
  type TrackMatch,
} from './spotifyMatchingService.ts'

export {
  spotifyUrlInputSchema,
  spotifyResolvedDataSchema,
  type SpotifyResolvedData,
  scoreCandidate,
  findBestTrackMatch,
  matchSingleTrack,
  matchTrackBatch,
  clearSpotifyMatchingCache,
  MIN_ACCEPTABLE_SCORE,
  type SpotifyTrackTarget,
  type TrackMatch,
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

const spotifyResolveCache = new Map<string, SpotifyResolvedData>()
const inFlightResolutions = new Map<string, Promise<SpotifyResolvedData>>()
const MAX_SPOTIFY_CACHE = 100

export function clearSpotifyResolveCache(): void {
  spotifyResolveCache.clear()
  inFlightResolutions.clear()
}

export function isSpotifyUrl(url: string): boolean {
  return spotifyUrlInputSchema.safeParse(url).success
}

export interface ResolveSpotifyUrlOptions {
  signal?: AbortSignal | undefined
  timeoutMs?: number | undefined
  offset?: number | undefined
  limit?: number | undefined
  skipRetry?: boolean | undefined
}

export async function resolveSpotifyUrl(
  spotifyUrl: string,
  options: ResolveSpotifyUrlOptions = {},
): Promise<SpotifyResolvedData> {
  const parseResult = spotifyUrlInputSchema.safeParse(spotifyUrl)
  if (!parseResult.success) {
    recordSpotifyUrlMetric('resolutionsFailed')
    throw new Error(parseResult.error.issues[0]?.message || 'Invalid Spotify URL')
  }

  const cleanUrl = parseResult.data
  const offset = options.offset ?? 0
  const limit = options.limit ?? 100
  const cacheKey = `${cleanUrl}__${offset}__${limit}`

  const cached = spotifyResolveCache.get(cacheKey)
  if (cached) {
    spotifyResolveCache.delete(cacheKey)
    spotifyResolveCache.set(cacheKey, cached)
    recordSpotifyUrlMetric('resolutionsCached')
    return cached
  }

  recordSpotifyUrlMetric('resolutionsRequested')

  const inFlight = inFlightResolutions.get(cacheKey)
  if (inFlight) {
    recordSpotifyUrlMetric('inFlightDeduplications')
    return inFlight
  }

  const execute = async (): Promise<SpotifyResolvedData> => {
    const timeoutMs = options.timeoutMs ?? 10000
    const timeoutController = new AbortController()
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs)

    const onAbort = () => timeoutController.abort()
    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true })
    }

    try {
      const fetchOnce = async () => {
        const query = new URLSearchParams({
          url: cleanUrl,
          offset: String(offset),
          limit: String(limit),
        })
        const res = await fetch(`/api/spotify/resolve?${query.toString()}`, {
          signal: timeoutController.signal,
        })
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          throw new Error(
            errData.error || errData.message || `Failed to resolve Spotify URL (HTTP ${res.status})`,
          )
        }
        return res.json()
      }

      let raw: unknown
      try {
        raw = await fetchOnce()
      } catch (err: unknown) {
        if (options.signal?.aborted || timeoutController.signal.aborted) {
          throw err
        }
        if (!options.skipRetry) {
          recordSpotifyUrlMetric('retries')
          const jitter = Math.floor(Math.random() * 100) + 50
          await new Promise((r) => setTimeout(r, jitter))
          raw = await fetchOnce()
        } else {
          throw err
        }
      }

      const parsed = spotifyResolvedDataSchema.safeParse(raw)
      if (!parsed.success) {
        recordSpotifyUrlMetric('resolutionsFailed')
        throw new Error('Malformed Spotify resolution payload received from server')
      }

      const data = parsed.data
      spotifyResolveCache.set(cacheKey, data)
      if (spotifyResolveCache.size > MAX_SPOTIFY_CACHE) {
        const oldest = spotifyResolveCache.keys().next().value
        if (oldest !== undefined) spotifyResolveCache.delete(oldest)
      }

      recordSpotifyUrlMetric('resolutionsSucceeded')
      return data
    } catch (err: unknown) {
      if (options.signal?.aborted) {
        recordSpotifyUrlMetric('cancellations')
      } else {
        recordSpotifyUrlMetric('resolutionsFailed')
      }
      throw err
    } finally {
      clearTimeout(timer)
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort)
      }
      inFlightResolutions.delete(cacheKey)
    }
  }

  const promise = execute()
  inFlightResolutions.set(cacheKey, promise)
  return promise
}

export async function importFromSpotify(
  spotifyUrl: string,
  onProgress?: (progress: SpotifyImportProgress) => void,
  signal?: AbortSignal,
): Promise<SpotifyImportResult> {
  const spotifyData = await resolveSpotifyUrl(
    spotifyUrl,
    signal ? { signal, offset: 0, limit: 100 } : { offset: 0, limit: 100 },
  )

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
      const pageData = await resolveSpotifyUrl(
        spotifyUrl,
        signal
          ? {
              signal,
              offset: currentOffset,
              limit: 100,
            }
          : {
              offset: currentOffset,
              limit: 100,
            },
      )
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

  const { matchedTracks, unmatchedTitles } = await matchTrackBatch(allSpotifyTracks, {
    signal,
    onProgress: (p) => {
      onProgress?.({
        current: p.current,
        total,
        currentTitle: p.currentTitle,
        matchedCount: p.matchedCount,
      })
    },
    concurrency: 3,
  })

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
