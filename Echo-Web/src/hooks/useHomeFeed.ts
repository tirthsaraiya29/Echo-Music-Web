import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { InnerTubeClient } from '../services/innertube/client.ts'
import type { HomeShelf, PlaylistSummary } from '../types/domain.ts'

export const themedCategorySchema = z.object({
  id: z.enum(['bollywood', 'hollywood', 'romance', 'soothing']),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  query: z.string().min(1),
})

export const themedShelfSchema = z.object({
  id: z.enum(['bollywood', 'hollywood', 'romance', 'soothing']),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  items: z.array(z.record(z.string(), z.unknown())),
})

export const homeShelvesMetricsSchema = z.object({
  loadsCount: z.number().nonnegative(),
  failuresCount: z.number().nonnegative(),
  lastError: z.string().nullable(),
})

export type HomeShelvesMetrics = z.infer<typeof homeShelvesMetricsSchema>

const homeShelvesMetrics: HomeShelvesMetrics = {
  loadsCount: 0,
  failuresCount: 0,
  lastError: null,
}

export function getHomeShelvesMetrics(): HomeShelvesMetrics {
  return { ...homeShelvesMetrics }
}

export function resetHomeShelvesMetrics(): void {
  homeShelvesMetrics.loadsCount = 0
  homeShelvesMetrics.failuresCount = 0
  homeShelvesMetrics.lastError = null
}

export interface ThemedHomeCategory {
  id: 'bollywood' | 'hollywood' | 'romance' | 'soothing'
  title: string
  subtitle: string
  query: string
}

export const THEMED_HOME_CATEGORIES: ThemedHomeCategory[] = [
  {
    id: 'bollywood',
    title: 'Bollywood Essentials',
    subtitle: 'Timeless Hindi anthems, cinematic classics, and chartbusters',
    query: 'Bollywood Hits Playlists',
  },
  {
    id: 'hollywood',
    title: 'Hollywood & Global Pop',
    subtitle: 'International billboard hits, pop favorites, and global sounds',
    query: 'Hollywood Pop Hits Playlists',
  },
  {
    id: 'romance',
    title: 'Romantic Melodies',
    subtitle: 'Heartfelt love songs, warm acoustics, and timeless ballads',
    query: 'Romantic Love Songs Playlists',
  },
  {
    id: 'soothing',
    title: 'Soothing & Chill',
    subtitle: 'Gentle acoustic sessions, calm rhythms, and peaceful soundscapes',
    query: 'Soothing Acoustic Chill Playlists',
  },
]

export interface ThemedShelf {
  id: ThemedHomeCategory['id']
  title: string
  subtitle: string
  items: PlaylistSummary[]
}

export function useThemedHomeShelves() {
  return useQuery<ThemedShelf[], Error>({
    queryKey: ['themed-home-shelves'],
    queryFn: async ({ signal }) => {
      homeShelvesMetrics.loadsCount++
      try {
        const results = await Promise.all(
          THEMED_HOME_CATEGORIES.map(async (cat) => {
            const res = await InnerTubeClient.search(cat.query, 'playlists', { signal })
            return {
              id: cat.id,
              title: cat.title,
              subtitle: cat.subtitle,
              items: res.playlists.slice(0, 8),
            }
          }),
        )
        return results
      } catch (err) {
        homeShelvesMetrics.failuresCount++
        homeShelvesMetrics.lastError = err instanceof Error ? err.message : String(err)
        throw err
      }
    },
    staleTime: 30 * 60 * 1000,
  })
}

export function useHomeFeed() {
  return useQuery<HomeShelf[], Error>({
    queryKey: ['home', 'feed'],
    queryFn: ({ signal }) => InnerTubeClient.fetchHomeFeed({ signal }),
    staleTime: 10 * 60 * 1000, // 10 minutes
  })
}

export function useCharts(countryCode?: string) {
  return useQuery<HomeShelf[], Error>({
    queryKey: ['charts', countryCode || 'default'],
    queryFn: ({ signal }) => InnerTubeClient.fetchCharts(countryCode, { signal }),
    staleTime: 15 * 60 * 1000,
  })
}

export function useMoodsAndGenres() {
  return useQuery<HomeShelf[], Error>({
    queryKey: ['moods-and-genres'],
    queryFn: ({ signal }) => InnerTubeClient.fetchMoodsAndGenres({ signal }),
    staleTime: 30 * 60 * 1000,
  })
}

export function useTrending() {
  return useQuery<HomeShelf[], Error>({
    queryKey: ['trending'],
    queryFn: ({ signal }) => InnerTubeClient.fetchTrending({ signal }),
    staleTime: 10 * 60 * 1000,
  })
}
