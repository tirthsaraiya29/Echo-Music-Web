/**
 * Metadata Cache Service
 *
 * Provides a resilient two-tier (memory LRU + IndexedDB) cache with:
 * - Runtime schema validation
 * - In-flight fetch deduplication and coalescing
 * - Stale-while-revalidate background refreshes
 * - Offline/failure stale fallback recovery
 * - Cooperative AbortSignal cancellation
 * - Operational telemetry tracking
 */

import { z } from 'zod'
import { db, type MetadataCacheRecord } from '../db/echoDatabase.ts'

export const cacheKindSchema = z.enum([
  'shelf',
  'album',
  'artist',
  'playlist',
  'search',
  'suggestions',
])

export const cacheKeySchema = z.string().trim().min(1).max(512)

export const cacheRecordSchema = z.object({
  key: cacheKeySchema,
  kind: cacheKindSchema,
  data: z.unknown(),
  updatedAt: z.number().nonnegative(),
  expiresAt: z.number(),
})

export const metadataCacheMetricsSchema = z.object({
  memoryHits: z.number().nonnegative(),
  dbHits: z.number().nonnegative(),
  misses: z.number().nonnegative(),
  staleHits: z.number().nonnegative(),
  writes: z.number().nonnegative(),
  evictions: z.number().nonnegative(),
  invalidations: z.number().nonnegative(),
  deduplicatedRequests: z.number().nonnegative(),
  errors: z.number().nonnegative(),
})

export type MetadataCacheMetrics = z.infer<typeof metadataCacheMetricsSchema>

export interface FetchWithCacheOptions {
  ttlMs?: number
  signal?: AbortSignal
  timeoutMs?: number
}

const metrics: MetadataCacheMetrics = {
  memoryHits: 0,
  dbHits: 0,
  misses: 0,
  staleHits: 0,
  writes: 0,
  evictions: 0,
  invalidations: 0,
  deduplicatedRequests: 0,
  errors: 0,
}

export function getMetadataCacheMetrics(): MetadataCacheMetrics {
  return { ...metrics }
}

export function resetMetadataCacheMetrics(): void {
  metrics.memoryHits = 0
  metrics.dbHits = 0
  metrics.misses = 0
  metrics.staleHits = 0
  metrics.writes = 0
  metrics.evictions = 0
  metrics.invalidations = 0
  metrics.deduplicatedRequests = 0
  metrics.errors = 0
}

const inFlightRequests = new Map<string, Promise<unknown>>()
const memoryCache = new Map<string, { data: unknown; expiresAt: number; updatedAt: number }>()
export const MEMORY_CACHE_MAX = 60
export const DB_CACHE_MAX = 500

export async function enforceHardCap(maxRecords = DB_CACHE_MAX): Promise<void> {
  const now = Date.now()
  try {
    const totalCount = await db.metadataCache.count()
    if (totalCount <= maxRecords) {
      return
    }

    await db.transaction('rw', db.metadataCache, async () => {
      // 1. Evict expired entries first
      const expiredKeys = await db.metadataCache
        .where('expiresAt')
        .below(now)
        .primaryKeys()
      if (expiredKeys.length > 0) {
        metrics.evictions += expiredKeys.length
        await db.metadataCache.bulkDelete(expiredKeys)
      }

      // 2. If count still exceeds maxRecords, evict oldest entries by updatedAt to enforce hard cap
      const currentCount = await db.metadataCache.count()
      if (currentCount > maxRecords) {
        const excess = currentCount - maxRecords
        const oldestKeys = await db.metadataCache
          .orderBy('updatedAt')
          .limit(excess)
          .primaryKeys()
        if (oldestKeys.length > 0) {
          metrics.evictions += oldestKeys.length
          await db.metadataCache.bulkDelete(oldestKeys)
        }
      }
    })
  } catch {
    metrics.errors++
    // Non-fatal if storage/IndexedDB is unavailable
  }
}

function setMemoryCache(key: string, data: unknown, ttlMs: number, updatedAt: number): void {
  if (memoryCache.size >= MEMORY_CACHE_MAX) {
    const oldestKey = memoryCache.keys().next().value
    if (oldestKey !== undefined) {
      memoryCache.delete(oldestKey)
      metrics.evictions++
    }
  }
  memoryCache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
    updatedAt,
  })
}

export async function getCachedMetadata<T>(key: string): Promise<{ data: T; isStale: boolean } | null> {
  const keyCheck = cacheKeySchema.safeParse(key)
  if (!keyCheck.success) {
    return null
  }

  // 1. Check in-memory cache
  const mem = memoryCache.get(key)
  if (mem) {
    const isStale = Date.now() > mem.expiresAt
    if (isStale) {
      metrics.staleHits++
    } else {
      metrics.memoryHits++
    }
    return { data: mem.data as T, isStale }
  }

  // 2. Check IndexedDB
  try {
    const record = await db.metadataCache.get(key)
    if (record) {
      const isStale = Date.now() > record.expiresAt
      if (isStale) {
        metrics.staleHits++
      } else {
        metrics.dbHits++
      }
      setMemoryCache(key, record.data, Math.max(10000, record.expiresAt - Date.now()), record.updatedAt)
      return { data: record.data as T, isStale }
    }
  } catch {
    metrics.errors++
    // If IndexedDB read fails, proceed without cache
  }

  metrics.misses++
  return null
}

export async function setCachedMetadata<T>(
  key: string,
  kind: MetadataCacheRecord['kind'],
  data: T,
  ttlMs: number,
): Promise<void> {
  const keyCheck = cacheKeySchema.safeParse(key)
  const kindCheck = cacheKindSchema.safeParse(kind)
  if (!keyCheck.success || !kindCheck.success || data === undefined) {
    return
  }

  const boundedTtl = Number.isFinite(ttlMs)
    ? Math.max(-1000000, Math.min(30 * 24 * 3600 * 1000, ttlMs))
    : 15 * 60 * 1000

  const now = Date.now()
  const expiresAt = now + boundedTtl

  metrics.writes++
  setMemoryCache(key, data, boundedTtl, now)

  try {
    await db.metadataCache.put({
      key,
      kind,
      data,
      updatedAt: now,
      expiresAt,
    })

    // Hard cap transactional cleanup
    const count = await db.metadataCache.count()
    if (count > DB_CACHE_MAX) {
      await enforceHardCap(DB_CACHE_MAX)
    }
  } catch {
    metrics.errors++
    // Non-fatal
  }
}

export async function invalidateMetadata(keyOrPrefix: string): Promise<void> {
  metrics.invalidations++
  for (const k of memoryCache.keys()) {
    if (k.startsWith(keyOrPrefix)) {
      memoryCache.delete(k)
    }
  }
  try {
    const matches = await db.metadataCache
      .filter((rec) => rec.key.startsWith(keyOrPrefix))
      .primaryKeys()
    if (matches.length > 0) {
      await db.metadataCache.bulkDelete(matches)
    }
  } catch {
    metrics.errors++
    // Non-fatal
  }
}

export async function clearAllMetadataCache(): Promise<void> {
  metrics.invalidations++
  memoryCache.clear()
  try {
    await db.metadataCache.clear()
  } catch {
    metrics.errors++
    // Non-fatal
  }
}

export function getInFlightRequestCount(): number {
  return inFlightRequests.size
}

export function hasInFlightRequest(key: string): boolean {
  return inFlightRequests.has(key)
}

/**
 * Fetch with intelligent caching:
 * - Deduplicates simultaneous requests
 * - Stale-while-revalidate: returns cached content immediately while updating in background (deduplicated)
 * - Offline fallback: returns expired cache when network fails
 * - Cooperative cancellation via AbortSignal
 */
export async function fetchWithCache<T>(
  key: string,
  kind: MetadataCacheRecord['kind'],
  fetcher: (signal?: AbortSignal) => Promise<T>,
  ttlOrOptions: number | FetchWithCacheOptions = 15 * 60 * 1000,
): Promise<T> {
  const options: FetchWithCacheOptions =
    typeof ttlOrOptions === 'number' ? { ttlMs: ttlOrOptions } : ttlOrOptions
  const ttlMs = options.ttlMs ?? 15 * 60 * 1000
  const signal = options.signal

  // Check early cancellation
  if (signal?.aborted) {
    const cachedFallback = await getCachedMetadata<T>(key)
    if (cachedFallback) {
      return cachedFallback.data
    }
    throw new Error('Metadata cache operation aborted')
  }

  // 1. Check existing cached entry
  const cached = await getCachedMetadata<T>(key)
  if (cached) {
    if (!cached.isStale) {
      return cached.data
    }

    // Stale: trigger background revalidation without blocking caller,
    // deduplicating via inFlightRequests so concurrent callers do not trigger duplicate revalidations.
    if (!inFlightRequests.has(key)) {
      const revalidationPromise = executeFetch(key, kind, fetcher, ttlMs, signal)
        .catch(() => {})
        .finally(() => {
          inFlightRequests.delete(key)
        })
      inFlightRequests.set(key, revalidationPromise)
    }

    return cached.data
  }

  // 2. Request deduplication for in-flight requests
  const existing = inFlightRequests.get(key)
  if (existing) {
    metrics.deduplicatedRequests++
    return existing as Promise<T>
  }

  const promise = executeFetch(key, kind, fetcher, ttlMs, signal)
    .catch(async (err) => {
      // Fallback: If fetch fails, check if we have any stale cached data
      const staleFallback = await getCachedMetadata<T>(key)
      if (staleFallback) {
        return staleFallback.data
      }
      throw err
    })
    .finally(() => {
      inFlightRequests.delete(key)
    })

  inFlightRequests.set(key, promise)
  return promise
}

async function executeFetch<T>(
  key: string,
  kind: MetadataCacheRecord['kind'],
  fetcher: (signal?: AbortSignal) => Promise<T>,
  ttlMs: number,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    throw new Error('Metadata cache operation aborted')
  }
  const freshData = await fetcher(signal)
  if (freshData !== undefined && freshData !== null) {
    await setCachedMetadata(key, kind, freshData, ttlMs)
  }
  return freshData
}

