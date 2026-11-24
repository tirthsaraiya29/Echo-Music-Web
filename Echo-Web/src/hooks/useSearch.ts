import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import {
  InnerTubeClient,
  type SearchFilterKey,
  type SearchResultCatalog,
} from '../services/innertube/client.ts'

export const searchFilterSchema = z.enum([
  'all',
  'songs',
  'videos',
  'albums',
  'artists',
  'playlists',
])

export const searchQueryInputSchema = z.string().trim().max(500)

export const recentSearchSchema = z.array(z.string().trim().min(1).max(500)).max(20)

export const searchMetricsSchema = z.object({
  searchesCount: z.number().nonnegative(),
  suggestionsCount: z.number().nonnegative(),
  failuresCount: z.number().nonnegative(),
  lastError: z.string().nullable(),
})

export type SearchMetrics = z.infer<typeof searchMetricsSchema>

const searchMetrics: SearchMetrics = {
  searchesCount: 0,
  suggestionsCount: 0,
  failuresCount: 0,
  lastError: null,
}

export function getSearchMetrics(): SearchMetrics {
  return { ...searchMetrics }
}

export function resetSearchMetrics(): void {
  searchMetrics.searchesCount = 0
  searchMetrics.suggestionsCount = 0
  searchMetrics.failuresCount = 0
  searchMetrics.lastError = null
}

export function useDebounce<T>(value: T, delayMs = 250): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = window.setTimeout(() => {
      setDebouncedValue(value)
    }, delayMs)

    return () => {
      window.clearTimeout(handler)
    }
  }, [value, delayMs])

  return debouncedValue
}

export function useSearch(query: string, filter: SearchFilterKey = 'all') {
  const trimmed = query.trim()
  const debounced = useDebounce(trimmed, 250)

  return useQuery<SearchResultCatalog, Error>({
    queryKey: ['search', debounced, filter],
    queryFn: async ({ signal }) => {
      searchMetrics.searchesCount++
      try {
        return await InnerTubeClient.search(debounced, filter, { signal })
      } catch (err) {
        searchMetrics.failuresCount++
        searchMetrics.lastError = err instanceof Error ? err.message : String(err)
        throw err
      }
    },
    enabled: debounced.length > 0,
    staleTime: 5 * 60 * 1000,
  })
}

export function useSearchSuggestions(query: string) {
  const trimmed = query.trim()
  const debounced = useDebounce(trimmed, 150)

  return useQuery<string[], Error>({
    queryKey: ['search', 'suggestions', debounced],
    queryFn: async ({ signal }) => {
      searchMetrics.suggestionsCount++
      try {
        return await InnerTubeClient.fetchSuggestions(debounced, { signal })
      } catch (err) {
        searchMetrics.failuresCount++
        searchMetrics.lastError = err instanceof Error ? err.message : String(err)
        throw err
      }
    },
    enabled: debounced.length > 0,
    staleTime: 60 * 1000, // 1 minute
    gcTime: 5 * 60 * 1000, // 5 minutes
  })
}

const RECENT_SEARCHES_KEY = 'echo_recent_searches_v1'
const inMemoryRecentSearches: string[] = []

export function getStoredRecentSearches(): string[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(RECENT_SEARCHES_KEY)
      if (raw) {
        const parsed: unknown = JSON.parse(raw)
        const valid = recentSearchSchema.safeParse(parsed)
        if (valid.success) {
          return valid.data
        }
      }
    }
  } catch {
    // Non-fatal
  }
  return [...inMemoryRecentSearches]
}

export function saveRecentSearch(query: string): string[] {
  const validated = searchQueryInputSchema.safeParse(query)
  if (!validated.success || !validated.data) {
    return getStoredRecentSearches()
  }
  const trimmed = validated.data

  const existing = getStoredRecentSearches().filter(
    (q) => q.toLowerCase() !== trimmed.toLowerCase(),
  )
  const updated = [trimmed, ...existing].slice(0, 10)
  inMemoryRecentSearches.length = 0
  inMemoryRecentSearches.push(...updated)

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated))
    }
  } catch {
    // Non-fatal
  }
  return updated
}

export function removeRecentSearch(queryToRemove: string): string[] {
  const existing = getStoredRecentSearches().filter(
    (q) => q.toLowerCase() !== queryToRemove.trim().toLowerCase(),
  )
  inMemoryRecentSearches.length = 0
  inMemoryRecentSearches.push(...existing)

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(existing))
    }
  } catch {
    // Non-fatal
  }
  return existing
}

export function clearAllRecentSearches(): void {
  inMemoryRecentSearches.length = 0
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(RECENT_SEARCHES_KEY)
    }
  } catch {
    // Non-fatal
  }
}
