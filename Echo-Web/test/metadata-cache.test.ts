import test from 'node:test'
import assert from 'node:assert'
import {
  getCachedMetadata,
  setCachedMetadata,
  fetchWithCache,
  invalidateMetadata,
  getMetadataCacheMetrics,
  resetMetadataCacheMetrics,
  cacheKeySchema,
  cacheKindSchema,
  cacheRecordSchema,
  metadataCacheMetricsSchema,
} from '../src/services/cache/metadataCache.ts'

test('MetadataCache: setCachedMetadata stores in memory cache and getCachedMetadata retrieves it', async () => {
  const key = 'test:artist:1'
  const mockArtist = { id: 'art-1', name: 'Radiohead' }

  await setCachedMetadata(key, 'artist', mockArtist, 60_000)

  const cached = await getCachedMetadata<typeof mockArtist>(key)
  assert.ok(cached !== null)
  assert.strictEqual(cached.data.id, 'art-1')
  assert.strictEqual(cached.data.name, 'Radiohead')
  assert.strictEqual(cached.isStale, false)
})

test('MetadataCache: expired TTL marks record as stale', async () => {
  const key = 'test:album:stale'
  const mockAlbum = { id: 'alb-1', title: 'OK Computer' }

  // Set with -100ms TTL so it expires immediately
  await setCachedMetadata(key, 'album', mockAlbum, -100)

  const cached = await getCachedMetadata<typeof mockAlbum>(key)
  assert.ok(cached !== null)
  assert.strictEqual(cached.data.id, 'alb-1')
  assert.strictEqual(cached.isStale, true, 'Record should be flagged stale past its TTL')
})

test('MetadataCache: in-flight request deduplication collapses concurrent identical fetches', async () => {
  const key = 'test:dedup:concurrent'
  let invocationCount = 0

  const slowFetcher = async () => {
    invocationCount++
    await new Promise((resolve) => setTimeout(resolve, 50))
    return { payload: 'resolved_data', count: invocationCount }
  }

  // Fire 4 identical calls concurrently
  const [r1, r2, r3, r4] = await Promise.all([
    fetchWithCache(key, 'shelf', slowFetcher, 60_000),
    fetchWithCache(key, 'shelf', slowFetcher, 60_000),
    fetchWithCache(key, 'shelf', slowFetcher, 60_000),
    fetchWithCache(key, 'shelf', slowFetcher, 60_000),
  ])

  assert.strictEqual(invocationCount, 1, 'Underlying fetcher should only be called once for concurrent calls')
  assert.strictEqual(r1.payload, 'resolved_data')
  assert.strictEqual(r2.payload, 'resolved_data')
  assert.strictEqual(r3.payload, 'resolved_data')
  assert.strictEqual(r4.payload, 'resolved_data')
})

test('MetadataCache: invalidateMetadata clears cached records', async () => {
  const key = 'test:invalidate:1'
  await setCachedMetadata(key, 'playlist', { id: 'pl-1' }, 60_000)

  let cached = await getCachedMetadata(key)
  assert.ok(cached !== null)

  await invalidateMetadata(key)

  cached = await getCachedMetadata(key)
  assert.strictEqual(cached, null, 'Cache record should be null after invalidation')
})

test('MetadataCache: stale background revalidation is deduplicated across concurrent callers [BUG-19]', async () => {
  const key = 'test:stale:dedup'
  const staleData = { id: 'stale-1', count: 0 }
  const freshData = { id: 'stale-1', count: 99 }

  // Set with -100ms TTL so it is already stale
  await setCachedMetadata(key, 'artist', staleData, -100)

  let revalidationCount = 0
  const slowFetcher = async () => {
    revalidationCount++
    await new Promise((resolve) => setTimeout(resolve, 60))
    return freshData
  }

  // Fire 5 concurrent calls when cache is stale
  const results = await Promise.all([
    fetchWithCache(key, 'artist', slowFetcher, 60_000),
    fetchWithCache(key, 'artist', slowFetcher, 60_000),
    fetchWithCache(key, 'artist', slowFetcher, 60_000),
    fetchWithCache(key, 'artist', slowFetcher, 60_000),
    fetchWithCache(key, 'artist', slowFetcher, 60_000),
  ])

  // All 5 should immediately receive the stale data without waiting
  for (const res of results) {
    assert.strictEqual(res.count, 0)
  }

  // Exactly 1 background fetch should have been spawned, not 5
  assert.strictEqual(revalidationCount, 1, 'Only one background revalidation should be initiated for stale cache')

  // Wait for background revalidation to finish
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Subsequent read should get the fresh data
  const updated = await getCachedMetadata<typeof freshData>(key)
  assert.ok(updated !== null)
  assert.strictEqual(updated.data.count, 99)
  assert.strictEqual(updated.isStale, false)
})

test('MetadataCache: enforceHardCap evicts expired rows and oldest fresh rows to enforce hard limit [BUG-20]', async () => {
  const { db } = await import('../src/services/db/echoDatabase.ts')
  const { enforceHardCap } = await import('../src/services/cache/metadataCache.ts')

  // In-memory mock database records
  interface MockRecord {
    key: string
    updatedAt: number
    expiresAt: number
  }

  let store: MockRecord[] = [
    // 3 expired records
    { key: 'rec-1', updatedAt: 1000, expiresAt: Date.now() - 5000 },
    { key: 'rec-2', updatedAt: 2000, expiresAt: Date.now() - 3000 },
    { key: 'rec-3', updatedAt: 3000, expiresAt: Date.now() - 1000 },
    // 5 fresh records with different updatedAt timestamps
    { key: 'rec-4', updatedAt: 4000, expiresAt: Date.now() + 100000 },
    { key: 'rec-5', updatedAt: 5000, expiresAt: Date.now() + 100000 },
    { key: 'rec-6', updatedAt: 6000, expiresAt: Date.now() + 100000 },
    { key: 'rec-7', updatedAt: 7000, expiresAt: Date.now() + 100000 },
    { key: 'rec-8', updatedAt: 8000, expiresAt: Date.now() + 100000 },
  ]

  const originalMetadataCache = db.metadataCache
  const originalTransaction = db.transaction

  try {
    // Mock db.transaction to execute callback immediately
    db.transaction = (async (_mode: any, _table: any, fn: () => Promise<any>) => {
      return await fn()
    }) as any

    // Mock db.metadataCache operations
    db.metadataCache = {
      count: async () => store.length,
      where: (field: string) => ({
        below: (threshold: number) => ({
          primaryKeys: async () => {
            if (field === 'expiresAt') {
              return store.filter((r) => r.expiresAt < threshold).map((r) => r.key)
            }
            return []
          },
        }),
      }),
      orderBy: (field: string) => ({
        limit: (n: number) => ({
          primaryKeys: async () => {
            if (field === 'updatedAt') {
              const sorted = [...store].sort((a, b) => a.updatedAt - b.updatedAt)
              return sorted.slice(0, n).map((r) => r.key)
            }
            return []
          },
        }),
      }),
      bulkDelete: async (keys: string[]) => {
        const keySet = new Set(keys)
        store = store.filter((r) => !keySet.has(r.key))
      },
    } as any

    // Case 1: Cap at 4 records (currently 8 records: 3 expired, 5 fresh)
    // Eviction should delete 3 expired records (leaving 5), then 1 oldest fresh record ('rec-4'), leaving exactly 4: rec-5, rec-6, rec-7, rec-8
    await enforceHardCap(4)
    assert.strictEqual(store.length, 4)
    assert.deepStrictEqual(
      store.map((r) => r.key).sort(),
      ['rec-5', 'rec-6', 'rec-7', 'rec-8'],
    )

    // Case 2: Cap at 2 records (currently 4 fresh records)
    // Eviction has 0 expired records, so it must evict the 2 oldest fresh records ('rec-5' and 'rec-6')
    await enforceHardCap(2)
    assert.strictEqual(store.length, 2)
    assert.deepStrictEqual(
      store.map((r) => r.key).sort(),
      ['rec-7', 'rec-8'],
    )
  } finally {
    db.metadataCache = originalMetadataCache
    db.transaction = originalTransaction
  }
})

test('MetadataCache: schemas validate keys, kinds, and records correctly', () => {
  assert.strictEqual(cacheKeySchema.safeParse('album:123').success, true)
  assert.strictEqual(cacheKeySchema.safeParse('').success, false)
  assert.strictEqual(cacheKeySchema.safeParse('   ').success, false)

  assert.strictEqual(cacheKindSchema.safeParse('album').success, true)
  assert.strictEqual(cacheKindSchema.safeParse('invalid_kind').success, false)

  const validRecord = {
    key: 'artist:456',
    kind: 'artist',
    data: { name: 'Sample' },
    updatedAt: Date.now(),
    expiresAt: Date.now() + 60000,
  }
  assert.strictEqual(cacheRecordSchema.safeParse(validRecord).success, true)
})

test('MetadataCache: telemetry metrics track hits, writes, and deduplication', async () => {
  resetMetadataCacheMetrics()
  const initial = getMetadataCacheMetrics()
  assert.strictEqual(initial.writes, 0)
  assert.strictEqual(initial.memoryHits, 0)

  // Write and read
  await setCachedMetadata('metrics:test:1', 'shelf', { content: 'test' }, 60000)
  const cached = await getCachedMetadata('metrics:test:1')
  assert.ok(cached !== null)

  const updatedMetrics = getMetadataCacheMetrics()
  assert.strictEqual(updatedMetrics.writes, 1)
  assert.strictEqual(updatedMetrics.memoryHits, 1)

  // Validate metrics schema
  assert.strictEqual(metadataCacheMetricsSchema.safeParse(updatedMetrics).success, true)
  resetMetadataCacheMetrics()
  assert.strictEqual(getMetadataCacheMetrics().writes, 0)
})

test('MetadataCache: fetchWithCache respects AbortSignal and supports stale fallback', async () => {
  const key = 'test:abort:signal'
  const controller = new AbortController()
  controller.abort()

  // Abort with no cache throws error
  await assert.rejects(
    async () => {
      await fetchWithCache(key, 'album', async () => ({ title: 'Test' }), {
        signal: controller.signal,
      })
    },
    /aborted/,
  )

  // Prime cache
  await setCachedMetadata(key, 'album', { title: 'Cached Title' }, -100)

  // Abort with stale cache returns fallback without throwing
  const fallback = await fetchWithCache(key, 'album', async () => ({ title: 'Fresh Title' }), {
    signal: controller.signal,
  })
  assert.strictEqual(fallback.title, 'Cached Title')
})



