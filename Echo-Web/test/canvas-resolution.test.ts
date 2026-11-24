import test from 'node:test'
import assert from 'node:assert'

if (typeof globalThis.localStorage === 'undefined') {
  const mem = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, val: string) => mem.set(key, String(val)),
    removeItem: (key: string) => mem.delete(key),
    clear: () => mem.clear(),
    key: (i: number) => Array.from(mem.keys())[i] ?? null,
    length: 0,
  } as unknown as Storage
}

import {
  CanvasManager,
  canvasQuerySchema,
  canvasVideoResultSchema,
  canvasTelemetryMetricsSchema,
  getCanvasResolutionMetrics,
  resetCanvasResolutionMetrics,
} from '../src/services/canvas/CanvasManager.ts'
import type { Track } from '../src/types/domain.ts'

test('CanvasManager: canvasQuerySchema validates track inputs and rejects malformed data [SMALL-28]', () => {
  // Empty title rejected
  const emptyTitle = { id: 't1', title: '   ', artistName: 'Artist' } as Track
  assert.strictEqual(canvasQuerySchema.safeParse(emptyTitle).success, false)

  // Valid track passes
  const validTrack = {
    id: 't-canvas-1',
    videoId: 'v-canvas-1',
    title: 'Levitating',
    artistName: 'Dua Lipa',
    albumTitle: 'Future Nostalgia',
    isrc: 'GBAYE2000593',
  } as Track
  assert.strictEqual(canvasQuerySchema.safeParse(validTrack).success, true)
})

test('CanvasManager: canvasVideoResultSchema validates provider resolution results [SMALL-28]', () => {
  const validApple = {
    provider: 'APPLE',
    videoUrl: 'https://example.com/apple-canvas.mp4',
    rawUrl: 'https://example.com/raw.m3u8',
  }
  assert.strictEqual(canvasVideoResultSchema.safeParse(validApple).success, true)

  const validTidal = {
    provider: 'TIDAL',
    videoUrl: 'https://resources.tidal.com/videos/1280x1280.mp4',
  }
  assert.strictEqual(canvasVideoResultSchema.safeParse(validTidal).success, true)

  const validArtist = {
    provider: 'ARTIST_VIDEO',
    videoUrl: 'https://example.com/artist.mp4',
  }
  assert.strictEqual(canvasVideoResultSchema.safeParse(validArtist).success, true)

  const invalidProvider = {
    provider: 'UNKNOWN_PROVIDER',
    videoUrl: 'https://example.com/video.mp4',
  }
  assert.strictEqual(canvasVideoResultSchema.safeParse(invalidProvider).success, false)
})

test('CanvasManager: in-flight deduplication coalesces concurrent calls for the same track [SMALL-28]', async () => {
  resetCanvasResolutionMetrics()
  const manager = CanvasManager.getInstance()
  manager.clearCache()

  const originalFetch = globalThis.fetch
  let fetchCount = 0

  globalThis.fetch = (async () => {
    fetchCount++
    await new Promise((resolve) => setTimeout(resolve, 50))
    return new Response(
      JSON.stringify({
        success: true,
        provider: 'APPLE',
        videoUrl: 'https://example.com/canvas.mp4',
      }),
      { status: 200 },
    )
  }) as typeof fetch

  const track: Track = {
    id: 'canvas-coalesce-track',
    title: 'Coalesce Canvas',
    artistName: 'Concurrent Artist',
  }

  try {
    const [res1, res2, res3] = await Promise.all([
      manager.resolveCanvasVideo(track),
      manager.resolveCanvasVideo(track),
      manager.resolveCanvasVideo(track),
    ])

    assert.ok(res1)
    assert.deepStrictEqual(res1, res2)
    assert.deepStrictEqual(res1, res3)
    assert.strictEqual(fetchCount, 1, 'Only one network call should occur for coalesced canvas resolution')

    const metrics = getCanvasResolutionMetrics()
    assert.strictEqual(metrics.totalRequests, 3)
    assert.ok(metrics.coalescedRequests >= 2)
    assert.strictEqual(metrics.networkRequests, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('CanvasManager: memory cache serves subsequent queries and updates cacheHits [SMALL-28]', async () => {
  resetCanvasResolutionMetrics()
  const manager = CanvasManager.getInstance()
  manager.clearCache()

  const track: Track = {
    id: 'cache-hit-track',
    title: 'Cached Video Song',
    artistName: 'Cached Artist',
  }

  const fakeResult = {
    provider: 'TIDAL' as const,
    videoUrl: 'https://resources.tidal.com/videos/test.mp4',
  }

  const cacheKey = `${track.id}:${track.title}:${track.artistName}`
  manager.setCacheEntry(cacheKey, {
    result: fakeResult,
    cachedAt: Date.now(),
    expiresAt: Date.now() + 60000,
  })

  const result = await manager.resolveCanvasVideo(track)
  assert.deepStrictEqual(result, fakeResult)

  const metrics = getCanvasResolutionMetrics()
  assert.strictEqual(metrics.cacheHits, 1)
  assert.strictEqual(metrics.networkRequests, 0)
  assert.strictEqual(canvasTelemetryMetricsSchema.safeParse(metrics).success, true)
})

test('CanvasManager: cancellation terminates active fetch and records aborted metric [SMALL-28]', async () => {
  resetCanvasResolutionMetrics()
  const manager = CanvasManager.getInstance()
  manager.clearCache()

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (_url: string | URL | Request, opts?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      opts?.signal?.addEventListener('abort', () => reject(new Error('AbortError')), { once: true })
    })
  }) as typeof fetch

  const track: Track = {
    id: 'cancel-canvas-track',
    title: 'Cancel Song',
    artistName: 'Cancel Artist',
  }

  const abortController = new AbortController()

  try {
    const promise = manager.resolveCanvasVideo(track, abortController.signal)
    setTimeout(() => abortController.abort(), 10)

    const result = await promise
    assert.strictEqual(result, null)

    const metrics = getCanvasResolutionMetrics()
    assert.ok(metrics.failuresByReason['aborted'] >= 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('CanvasManager: cancelOngoingResolution API cancels in-flight operation [SMALL-28]', async () => {
  resetCanvasResolutionMetrics()
  const manager = CanvasManager.getInstance()
  manager.clearCache()

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (_url: string | URL | Request, opts?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      opts?.signal?.addEventListener('abort', () => reject(new Error('AbortError')), { once: true })
    })
  }) as typeof fetch

  const track: Track = {
    id: 'cancel-ongoing-canvas',
    title: 'Ongoing Cancel Song',
    artistName: 'Cancel Artist',
  }

  try {
    const promise = manager.resolveCanvasVideo(track)
    manager.cancelOngoingResolution()

    const result = await promise
    assert.strictEqual(result, null)
  } finally {
    globalThis.fetch = originalFetch
  }
})
