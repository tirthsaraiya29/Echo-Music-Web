import { z } from 'zod'
import type { Album, Artist, HomeShelf, PlaylistSummary, Track } from '../../types/domain.ts'
import type { SponsorSegment } from '../../types/audio.ts'
import type { StreamResolutionResult } from '../../types/innertube.ts'
import { apiFetch } from '../api.ts'
import {
  parseAlbumDetails,
  parseArtistDetails,
  parseHomeFeed,
  parseSearchResults,
} from './parser.ts'
import {
  filterShortsFromShelves,
  filterShortsFromSearchResults,
  isShortsFilterEnabled,
} from './shortsFilterService.ts'
import { fetchWithCache } from '../cache/metadataCache.ts'
import { useEchoStore, cacheTracks } from '../../stores/useEchoStore.ts'

export const searchQuerySchema = z.string().trim().min(1).max(250)
export const browseIdSchema = z.string().trim().min(1)

export interface InnerTubeClientMetrics {
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  cacheHits: number
  lastError: string | null
}

const clientMetrics: InnerTubeClientMetrics = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  cacheHits: 0,
  lastError: null,
}

export const SEARCH_FILTERS = {
  songs: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D',
  albums: 'EgWKAQIBAWoKEAkQBRAKEAMQBA%3D%3D',
  artists: 'EgWKAQIgAWoKEAkQBRAKEAMQBA%3D%3D',
  playlists: 'EgWKAQIoAWoKEAkQBRAKEAMQBA%3D%3D',
  videos: 'EgWKAQIQAWoKEAkQBRAKEAMQBA%3D%3D',
  podcasts: 'EgWKAQJQAWoKEAkQBRAKEAMQBA%3D%3D',
} as const

export type SearchFilterKey = keyof typeof SEARCH_FILTERS | 'all'

export interface SearchResultCatalog {
  tracks: Track[]
  albums: Album[]
  artists: Artist[]
  playlists: PlaylistSummary[]
}

export class InnerTubeClient {
  public static getMetrics(): InnerTubeClientMetrics {
    return { ...clientMetrics }
  }

  public static resetMetrics(): void {
    clientMetrics.totalRequests = 0
    clientMetrics.successfulRequests = 0
    clientMetrics.failedRequests = 0
    clientMetrics.cacheHits = 0
    clientMetrics.lastError = null
  }

  public static getClientContext(): Record<string, unknown> {
    const prefs = useEchoStore.getState().preferences
    const gl = prefs.contentRegion || 'US'
    const showExplicit = prefs.showExplicit ?? true
    return {
      client: {
        gl,
        hl: 'en',
      },
      user: {
        lockedSafetyMode: !showExplicit,
      },
    }
  }

  public static async fetchHomeFeed(options?: { signal?: AbortSignal }): Promise<HomeShelf[]> {
    clientMetrics.totalRequests++
    const prefs = useEchoStore.getState().preferences
    const region = prefs.contentRegion || 'US'
    const showExplicit = prefs.showExplicit ?? true
    const filterShorts = isShortsFilterEnabled(prefs)
    const cacheKey = `shelf:home:${region}:${showExplicit ? 'exp' : 'clean'}:${filterShorts ? 'noShorts' : 'withShorts'}`

    return await fetchWithCache(
      cacheKey,
      'shelf',
      async () => {
        try {
          const context = InnerTubeClient.getClientContext()
          const fetchInit: RequestInit = {
            method: 'POST',
            body: JSON.stringify({ browseId: 'FEmusic_home', context }),
          }
          if (options?.signal) fetchInit.signal = options.signal

          const data = await apiFetch<Record<string, unknown>>('/api/innertube/browse', fetchInit)
          let shelves = parseHomeFeed(data)
          for (const shelf of shelves) {
            if (!showExplicit) {
              shelf.items = shelf.items.filter((item) => !('explicit' in item && item.explicit))
            }
          }
          shelves = filterShortsFromShelves(shelves, filterShorts)
          for (const shelf of shelves) {
            const tracks = shelf.items.filter((i): i is Track => 'durationSeconds' in i)
            if (tracks.length > 0) cacheTracks(tracks)
          }
          clientMetrics.successfulRequests++
          return shelves
        } catch (err) {
          clientMetrics.failedRequests++
          clientMetrics.lastError = err instanceof Error ? err.message : String(err)
          throw err
        }
      },
      30 * 60 * 1000, // 30 mins
    )
  }

  public static async fetchCharts(
    countryCode?: string,
    options?: { signal?: AbortSignal },
  ): Promise<HomeShelf[]> {
    clientMetrics.totalRequests++
    const prefs = useEchoStore.getState().preferences
    const region = countryCode || prefs.contentRegion || 'US'
    const showExplicit = prefs.showExplicit ?? true
    const filterShorts = isShortsFilterEnabled(prefs)
    const key = `shelf:charts:${region}:${showExplicit ? 'exp' : 'clean'}:${filterShorts ? 'noShorts' : 'withShorts'}`

    return await fetchWithCache(
      key,
      'shelf',
      async () => {
        try {
          const context = InnerTubeClient.getClientContext()
          const fetchInit: RequestInit = {
            method: 'POST',
            body: JSON.stringify({
              browseId: 'FEmusic_charts',
              context,
              formData: { selectedValues: [region] },
            }),
          }
          if (options?.signal) fetchInit.signal = options.signal

          const data = await apiFetch<Record<string, unknown>>('/api/innertube/browse', fetchInit)
          let shelves = parseHomeFeed(data)
          for (const shelf of shelves) {
            if (!showExplicit) {
              shelf.items = shelf.items.filter((item) => !('explicit' in item && item.explicit))
            }
          }
          shelves = filterShortsFromShelves(shelves, filterShorts)
          for (const shelf of shelves) {
            const tracks = shelf.items.filter((i): i is Track => 'durationSeconds' in i)
            if (tracks.length > 0) cacheTracks(tracks)
          }
          clientMetrics.successfulRequests++
          return shelves
        } catch (err) {
          clientMetrics.failedRequests++
          clientMetrics.lastError = err instanceof Error ? err.message : String(err)
          throw err
        }
      },
      60 * 60 * 1000, // 1 hour
    )
  }

  public static async fetchMoodsAndGenres(options?: { signal?: AbortSignal }): Promise<HomeShelf[]> {
    clientMetrics.totalRequests++
    const prefs = useEchoStore.getState().preferences
    const region = prefs.contentRegion || 'US'
    const key = `shelf:moods:${region}`

    return await fetchWithCache(
      key,
      'shelf',
      async () => {
        try {
          const context = InnerTubeClient.getClientContext()
          const fetchInit: RequestInit = {
            method: 'POST',
            body: JSON.stringify({ browseId: 'FEmusic_moods_and_genres', context }),
          }
          if (options?.signal) fetchInit.signal = options.signal

          const data = await apiFetch<Record<string, unknown>>('/api/innertube/browse', fetchInit)
          const res = parseHomeFeed(data)
          clientMetrics.successfulRequests++
          return res
        } catch (err) {
          clientMetrics.failedRequests++
          clientMetrics.lastError = err instanceof Error ? err.message : String(err)
          throw err
        }
      },
      120 * 60 * 1000, // 2 hours
    )
  }

  public static async fetchTrending(options?: { signal?: AbortSignal }): Promise<HomeShelf[]> {
    clientMetrics.totalRequests++
    const prefs = useEchoStore.getState().preferences
    const region = prefs.contentRegion || 'US'
    const showExplicit = prefs.showExplicit ?? true
    const key = `shelf:trending:${region}:${showExplicit ? 'exp' : 'clean'}`

    return await fetchWithCache(
      key,
      'shelf',
      async () => {
        try {
          const context = InnerTubeClient.getClientContext()
          const fetchInit: RequestInit = {
            method: 'POST',
            body: JSON.stringify({ browseId: 'FEmusic_trending', context }),
          }
          if (options?.signal) fetchInit.signal = options.signal

          const data = await apiFetch<Record<string, unknown>>('/api/innertube/browse', fetchInit)
          const shelves = parseHomeFeed(data)
          for (const shelf of shelves) {
            if (!showExplicit) {
              shelf.items = shelf.items.filter((item) => !('explicit' in item && item.explicit))
            }
            const tracks = shelf.items.filter((i): i is Track => 'durationSeconds' in i)
            if (tracks.length > 0) cacheTracks(tracks)
          }
          clientMetrics.successfulRequests++
          return shelves
        } catch (err) {
          clientMetrics.failedRequests++
          clientMetrics.lastError = err instanceof Error ? err.message : String(err)
          throw err
        }
      },
      30 * 60 * 1000,
    )
  }

  public static async search(
    query: string,
    filter?: SearchFilterKey,
    options?: { signal?: AbortSignal },
  ): Promise<SearchResultCatalog> {
    const validation = searchQuerySchema.safeParse(query)
    if (!validation.success) {
      return { tracks: [], albums: [], artists: [], playlists: [] }
    }
    const trimmed = validation.data

    clientMetrics.totalRequests++
    const prefs = useEchoStore.getState().preferences
    const region = prefs.contentRegion || 'US'
    const showExplicit = prefs.showExplicit ?? true
    const filterShorts = isShortsFilterEnabled(prefs)
    const explicitFlag = showExplicit ? 'exp' : 'clean'
    const shortsFlag = filterShorts ? 'noShorts' : 'withShorts'
    const key = `search:${trimmed.toLowerCase()}:${filter || 'all'}:${region}:${explicitFlag}:${shortsFlag}`

    return await fetchWithCache(
      key,
      'search',
      async () => {
        try {
          const context = InnerTubeClient.getClientContext()
          const payload: {
            query: string
            params?: string
            context?: Record<string, unknown>
          } = {
            query: trimmed,
            context,
          }
          if (filter && filter !== 'all' && SEARCH_FILTERS[filter]) {
            payload.params = SEARCH_FILTERS[filter]
          }

          const fetchInit: RequestInit = {
            method: 'POST',
            body: JSON.stringify(payload),
          }
          if (options?.signal) fetchInit.signal = options.signal

          const data = await apiFetch<Record<string, unknown>>('/api/innertube/search', fetchInit)
          let catalog = parseSearchResults(data)
          if (!showExplicit) {
            catalog.tracks = catalog.tracks.filter((t) => !t.explicit)
          }
          catalog = filterShortsFromSearchResults(catalog, filterShorts)
          if (catalog.tracks.length > 0) {
            cacheTracks(catalog.tracks)
          }
          clientMetrics.successfulRequests++
          return catalog
        } catch (err) {
          clientMetrics.failedRequests++
          clientMetrics.lastError = err instanceof Error ? err.message : String(err)
          throw err
        }
      },
      15 * 60 * 1000, // 15 mins
    )
  }

  public static async fetchSuggestions(
    query: string,
    options?: { signal?: AbortSignal },
  ): Promise<string[]> {
    const trimmed = query.trim()
    if (!trimmed) return []

    clientMetrics.totalRequests++
    const prefs = useEchoStore.getState().preferences
    const region = prefs.contentRegion || 'US'
    const key = `suggestions:${trimmed.toLowerCase()}:${region}`
    return await fetchWithCache(
      key,
      'suggestions',
      async () => {
        try {
          const fetchInit: RequestInit = {}
          if (options?.signal) fetchInit.signal = options.signal
          const res = await apiFetch<string[]>(
            `/api/innertube/suggestions?q=${encodeURIComponent(trimmed)}&gl=${encodeURIComponent(region)}`,
            fetchInit,
          )
          clientMetrics.successfulRequests++
          return res
        } catch (err) {
          clientMetrics.failedRequests++
          clientMetrics.lastError = err instanceof Error ? err.message : String(err)
          throw err
        }
      },
      10 * 60 * 1000,
    )
  }

  public static async fetchAlbum(
    browseId: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ album: Album; tracks: Track[] }> {
    const validation = browseIdSchema.safeParse(browseId)
    if (!validation.success) {
      throw new Error(`Invalid browseId: '${browseId}'`)
    }
    const validBrowseId = validation.data

    clientMetrics.totalRequests++
    const prefs = useEchoStore.getState().preferences
    const region = prefs.contentRegion || 'US'
    const showExplicit = prefs.showExplicit ?? true
    const key = `album:${validBrowseId}:${region}:${showExplicit ? 'exp' : 'clean'}`

    return await fetchWithCache(
      key,
      'album',
      async () => {
        try {
          const context = InnerTubeClient.getClientContext()
          const fetchInit: RequestInit = {
            method: 'POST',
            body: JSON.stringify({ browseId: validBrowseId, context }),
          }
          if (options?.signal) fetchInit.signal = options.signal

          const data = await apiFetch<Record<string, unknown>>('/api/innertube/browse', fetchInit)
          const result = parseAlbumDetails(data)
          if (!showExplicit) {
            result.tracks = result.tracks.filter((t) => !t.explicit)
          }
          if (result.tracks.length > 0) {
            cacheTracks(result.tracks)
          }
          clientMetrics.successfulRequests++
          return result
        } catch (err) {
          clientMetrics.failedRequests++
          clientMetrics.lastError = err instanceof Error ? err.message : String(err)
          throw err
        }
      },
      24 * 60 * 60 * 1000, // 24 hours
    )
  }

  public static async fetchArtist(
    browseId: string,
    options?: { signal?: AbortSignal },
  ): Promise<{
    artist: Artist
    topTracks: Track[]
    albums: Album[]
    singles: Album[]
    relatedArtists: Artist[]
  }> {
    const validation = browseIdSchema.safeParse(browseId)
    if (!validation.success) {
      throw new Error(`Invalid browseId: '${browseId}'`)
    }
    const validBrowseId = validation.data

    clientMetrics.totalRequests++
    const prefs = useEchoStore.getState().preferences
    const region = prefs.contentRegion || 'US'
    const showExplicit = prefs.showExplicit ?? true
    const key = `artist:${validBrowseId}:${region}:${showExplicit ? 'exp' : 'clean'}`

    return await fetchWithCache(
      key,
      'artist',
      async () => {
        try {
          const context = InnerTubeClient.getClientContext()
          const fetchInit: RequestInit = {
            method: 'POST',
            body: JSON.stringify({ browseId: validBrowseId, context }),
          }
          if (options?.signal) fetchInit.signal = options.signal

          const data = await apiFetch<Record<string, unknown>>('/api/innertube/browse', fetchInit)
          const result = parseArtistDetails(data)
          if (!showExplicit) {
            result.topTracks = result.topTracks.filter((t) => !t.explicit)
          }
          if (result.topTracks.length > 0) {
            cacheTracks(result.topTracks)
          }
          clientMetrics.successfulRequests++
          return result
        } catch (err) {
          clientMetrics.failedRequests++
          clientMetrics.lastError = err instanceof Error ? err.message : String(err)
          throw err
        }
      },
      24 * 60 * 60 * 1000, // 24 hours
    )
  }

  public static async resolveStream(
    videoId: string,
    quality: 'low' | 'medium' | 'high' | 'lossless' = 'high',
    signal?: AbortSignal,
  ): Promise<StreamResolutionResult> {
    const cleanId = videoId?.trim() || ''
    if (!cleanId || !/^[a-zA-Z0-9_-]{11}$/.test(cleanId)) {
      throw new Error(`Invalid videoId: '${videoId}'. Must be an 11-character YouTube video ID.`)
    }
    const validQuality = ['low', 'medium', 'high', 'lossless'].includes(quality) ? quality : 'high'
    const options: RequestInit = {}
    if (signal) options.signal = signal
    return await apiFetch<StreamResolutionResult>(
      `/api/stream/resolve?videoId=${encodeURIComponent(cleanId)}&quality=${encodeURIComponent(validQuality)}`,
      options,
    )
  }

  public static async fetchSponsorBlock(videoId: string): Promise<SponsorSegment[]> {
    return await apiFetch<SponsorSegment[]>(`/api/sponsorblock/${encodeURIComponent(videoId)}`)
  }

  public static async fetchRadioNext(
    videoId?: string,
    continuation?: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ tracks: Track[]; continuationToken?: string }> {
    clientMetrics.totalRequests++
    const prefs = useEchoStore.getState().preferences
    const region = prefs.contentRegion || 'US'
    const showExplicit = prefs.showExplicit ?? true
    const queryParams = new URLSearchParams()
    if (videoId) queryParams.set('videoId', videoId)
    if (continuation) queryParams.set('continuation', continuation)
    queryParams.set('gl', region)
    queryParams.set('explicit', String(showExplicit))

    const fetchInit: RequestInit = {}
    if (options?.signal) fetchInit.signal = options.signal

    try {
      const res = await apiFetch<{ tracks: Track[]; continuationToken?: string }>(
        `/api/radio/continuation?${queryParams.toString()}`,
        fetchInit,
      )
      clientMetrics.successfulRequests++
      return res
    } catch (err) {
      clientMetrics.failedRequests++
      clientMetrics.lastError = err instanceof Error ? err.message : String(err)
      throw err
    }
  }
}

