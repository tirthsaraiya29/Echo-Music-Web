import { z } from 'zod'
import type { Track, PodcastShow, SearchResultCatalog } from '../../types/domain.ts'
import { InnerTubeClient } from '../innertube/client.ts'

export const podcastCategorySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  query: z.string().min(1),
  description: z.string().optional(),
})

export type PodcastCategory = z.infer<typeof podcastCategorySchema>

export const podcastShowSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  author: z.string().min(1),
  description: z.string().optional(),
  artworkUrl: z.string().default(''),
  episodeCount: z.number().int().nonnegative().optional(),
  isFollowed: z.boolean().optional(),
  browseId: z.string().optional(),
})

export const podcastDiscoveryMetricsSchema = z.object({
  totalQueries: z.number().nonnegative(),
  cacheHits: z.number().nonnegative(),
  episodesReturned: z.number().nonnegative(),
  showsReturned: z.number().nonnegative(),
})

export type PodcastDiscoveryMetrics = z.infer<typeof podcastDiscoveryMetricsSchema>

const discoveryMetrics: PodcastDiscoveryMetrics = {
  totalQueries: 0,
  cacheHits: 0,
  episodesReturned: 0,
  showsReturned: 0,
}

export function getPodcastDiscoveryMetrics(): PodcastDiscoveryMetrics {
  return { ...discoveryMetrics }
}

export function resetPodcastDiscoveryMetrics(): void {
  discoveryMetrics.totalQueries = 0
  discoveryMetrics.cacheHits = 0
  discoveryMetrics.episodesReturned = 0
  discoveryMetrics.showsReturned = 0
}

export const PODCAST_CATEGORIES: PodcastCategory[] = [
  {
    id: 'all',
    label: 'All Podcasts',
    query: 'popular podcasts full episodes',
    description: 'Trending and top-rated podcasts across all genres',
  },
  {
    id: 'tech',
    label: 'Technology',
    query: 'technology podcasts full episodes',
    description: 'Software, AI, startups, gadgets, and engineering',
  },
  {
    id: 'crime',
    label: 'True Crime',
    query: 'true crime podcasts full episodes',
    description: 'Investigative mysteries, cold cases, and trials',
  },
  {
    id: 'comedy',
    label: 'Comedy',
    query: 'comedy podcasts full episodes',
    description: 'Stand-up, hilarious interviews, and comedic discussions',
  },
  {
    id: 'news',
    label: 'News & Politics',
    query: 'daily news podcasts full episodes',
    description: 'In-depth reporting, global events, and political analysis',
  },
  {
    id: 'science',
    label: 'Science & Nature',
    query: 'science podcasts full episodes',
    description: 'Astronomy, neuroscience, biology, and the physical universe',
  },
  {
    id: 'business',
    label: 'Business & Finance',
    query: 'business entrepreneurship podcasts full episodes',
    description: 'Markets, leadership, venture capital, and economic insights',
  },
  {
    id: 'society',
    label: 'Society & Culture',
    query: 'society culture philosophy podcasts full episodes',
    description: 'Human behavior, philosophy, sociology, and modern life',
  },
  {
    id: 'sports',
    label: 'Sports & Fitness',
    query: 'sports talk fitness podcasts full episodes',
    description: 'Athlete stories, game analysis, and training science',
  },
  {
    id: 'health',
    label: 'Health & Wellness',
    query: 'health wellness mental health podcasts full episodes',
    description: 'Nutrition, mental wellbeing, longevity, and medicine',
  },
  {
    id: 'music',
    label: 'Music & Arts',
    query: 'music podcasts musician interviews full episodes',
    description: 'Songwriting deep dives, music history, and artist stories',
  },
  {
    id: 'education',
    label: 'History & Education',
    query: 'history education documentary podcasts full episodes',
    description: 'Historical narratives, ancient civilizations, and learning',
  },
]

export const FEATURED_PODCAST_SHOWS: PodcastShow[] = [
  {
    id: 'show_huberman_lab',
    title: 'Huberman Lab',
    author: 'Dr. Andrew Huberman',
    description: 'Neuroscience and science-based tools for everyday life.',
    artworkUrl: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=600&auto=format&fit=crop&q=80',
    episodeCount: 180,
    browseId: 'MPSP_huberman_lab',
  },
  {
    id: 'show_the_daily',
    title: 'The Daily',
    author: 'The New York Times',
    description: 'This is what the news should sound like. Twenty minutes a day.',
    artworkUrl: 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=600&auto=format&fit=crop&q=80',
    episodeCount: 1500,
    browseId: 'MPSP_the_daily',
  },
  {
    id: 'show_lex_fridman',
    title: 'Lex Fridman Podcast',
    author: 'Lex Fridman',
    description: 'Conversations about science, tech, history, philosophy, and intelligence.',
    artworkUrl: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=600&auto=format&fit=crop&q=80',
    episodeCount: 420,
    browseId: 'MPSP_lex_fridman',
  },
  {
    id: 'show_radiolab',
    title: 'Radiolab',
    author: 'WNYC Studios',
    description: 'Investigating strange questions with sound, science, and storytelling.',
    artworkUrl: 'https://images.unsplash.com/photo-1478737270239-2f02b77fc618?w=600&auto=format&fit=crop&q=80',
    episodeCount: 350,
    browseId: 'MPSP_radiolab',
  },
  {
    id: 'show_smartless',
    title: 'SmartLess',
    author: 'Jason Bateman, Sean Hayes, Will Arnett',
    description: 'Connecting and uniting people from all walks of life to learn about a mystery guest.',
    artworkUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
    episodeCount: 220,
    browseId: 'MPSP_smartless',
  },
  {
    id: 'show_darknet_diaries',
    title: 'Darknet Diaries',
    author: 'Jack Rhysider',
    description: 'True stories from the dark side of the internet: hackers, breaches, shadow ops.',
    artworkUrl: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=600&auto=format&fit=crop&q=80',
    episodeCount: 145,
    browseId: 'MPSP_darknet_diaries',
  },
]

export interface PodcastDiscoveryResult {
  category?: PodcastCategory
  shows: PodcastShow[]
  episodes: Track[]
  query?: string
}

interface CacheEntry {
  result: PodcastDiscoveryResult
  expiresAt: number
}

const discoveryCache = new Map<string, CacheEntry>()
const MAX_CACHE_SIZE = 40
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

function getCachedResult(key: string): PodcastDiscoveryResult | null {
  const entry = discoveryCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    discoveryCache.delete(key)
    return null
  }
  return entry.result
}

function setCachedResult(key: string, result: PodcastDiscoveryResult): void {
  if (discoveryCache.size >= MAX_CACHE_SIZE) {
    const oldest = discoveryCache.keys().next().value
    if (oldest !== undefined) {
      discoveryCache.delete(oldest)
    }
  }
  discoveryCache.set(key, {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })
}

/**
 * Extracts structured shows and episodes from raw InnerTube search catalog.
 */
export function extractPodcastShowsAndEpisodes(
  catalog: SearchResultCatalog,
  fallbackAuthor = 'Podcast Show',
): { shows: PodcastShow[]; episodes: Track[] } {
  const episodes: Track[] = []
  const shows: PodcastShow[] = []
  const seenEpisodeIds = new Set<string>()
  const seenShowIds = new Set<string>()

  // 1. Process tracks as podcast episodes
  for (const track of catalog.tracks || []) {
    if (seenEpisodeIds.has(track.id)) continue
    seenEpisodeIds.add(track.id)

    const showTitle = track.albumTitle && track.albumTitle !== 'Single' && !track.albumTitle.startsWith('album-')
      ? track.albumTitle
      : track.artistName || fallbackAuthor

    const episodeTrack: Track = {
      ...track,
      isPodcast: true,
      podcastShowId: track.podcastShowId || `show_${showTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      showTitle,
    }
    episodes.push(episodeTrack)
  }

  // 2. Process playlists as podcast shows
  for (const playlist of catalog.playlists || []) {
    if (seenShowIds.has(playlist.id)) continue
    seenShowIds.add(playlist.id)

    const show: PodcastShow = {
      id: playlist.id,
      title: playlist.title,
      author: playlist.author || fallbackAuthor,
      description: playlist.description,
      artworkUrl: playlist.thumbnailUrl || playlist.image,
      episodeCount: playlist.trackCount,
      browseId: playlist.id.startsWith('MPSP') ? playlist.id : `MPSP_${playlist.id}`,
    }
    shows.push(show)
  }

  return { shows, episodes }
}

/**
 * Discovers podcast episodes and shows for a given category.
 */
export async function discoverPodcasts(
  categoryId: string,
  options?: { signal?: AbortSignal; forceRefresh?: boolean },
): Promise<PodcastDiscoveryResult> {
  const category = PODCAST_CATEGORIES.find((c) => c.id === categoryId) || PODCAST_CATEGORIES[0]!
  const cacheKey = `category_${category.id}`

  discoveryMetrics.totalQueries++

  if (!options?.forceRefresh) {
    const cached = getCachedResult(cacheKey)
    if (cached) {
      discoveryMetrics.cacheHits++
      return cached
    }
  }

  try {
    const catalog = await InnerTubeClient.search(category.query, 'podcasts')
    const { shows, episodes } = extractPodcastShowsAndEpisodes(catalog, category.label)

    // Blend in featured shows if category returns few show playlists
    const blendedShows = shows.length > 0
      ? shows
      : FEATURED_PODCAST_SHOWS.filter((s) => categoryId === 'all' || s.description?.toLowerCase().includes(category.id))

    const result: PodcastDiscoveryResult = {
      category,
      shows: blendedShows.length > 0 ? blendedShows : FEATURED_PODCAST_SHOWS,
      episodes,
    }

    discoveryMetrics.episodesReturned += episodes.length
    discoveryMetrics.showsReturned += result.shows.length

    setCachedResult(cacheKey, result)
    return result
  } catch (error) {
    if (options?.signal?.aborted) {
      throw error
    }
    // Resilient fallback with featured shows
    const fallback: PodcastDiscoveryResult = {
      category,
      shows: FEATURED_PODCAST_SHOWS,
      episodes: [],
    }
    return fallback
  }
}

/**
 * Searches podcasts by user query on YouTube Music.
 */
export async function searchPodcasts(
  query: string,
  options?: { signal?: AbortSignal },
): Promise<PodcastDiscoveryResult> {
  const cleanQuery = query.trim()
  if (!cleanQuery) {
    return discoverPodcasts('all', options)
  }

  const cacheKey = `search_${cleanQuery.toLowerCase()}`
  discoveryMetrics.totalQueries++

  const cached = getCachedResult(cacheKey)
  if (cached) {
    discoveryMetrics.cacheHits++
    return cached
  }

  try {
    const catalog = await InnerTubeClient.search(cleanQuery, 'podcasts')
    const { shows, episodes } = extractPodcastShowsAndEpisodes(catalog, 'Podcast')

    const result: PodcastDiscoveryResult = {
      query: cleanQuery,
      shows,
      episodes,
    }

    discoveryMetrics.episodesReturned += episodes.length
    discoveryMetrics.showsReturned += shows.length

    setCachedResult(cacheKey, result)
    return result
  } catch (error) {
    if (options?.signal?.aborted) {
      throw error
    }
    return {
      query: cleanQuery,
      shows: [],
      episodes: [],
    }
  }
}

/**
 * Returns list of trending/featured podcast shows.
 */
export function getTrendingPodcastShows(): PodcastShow[] {
  return [...FEATURED_PODCAST_SHOWS]
}
