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
  LyricsOrchestrator,
  lyricsQuerySchema,
  synchronizedLyricsSchema,
  lyricLineSchema,
  lyricWordSchema,
  lyricsOrchestratorMetricsSchema,
  getLyricsOrchestratorMetrics,
  resetLyricsOrchestratorMetrics,
} from '../src/services/lyrics/LyricsOrchestrator.ts'
import type { Track } from '../src/types/domain.ts'
import type { SynchronizedLyrics } from '../src/types/lyrics.ts'

test('LyricsOrchestrator: Input schema rejects empty/malformed tracks and accepts valid tracks [SMALL-25]', () => {
  resetLyricsOrchestratorMetrics()

  // Empty title rejected
  const invalidTrack1 = { id: 'track-1', title: '   ', artistName: 'Artist' } as Track
  assert.strictEqual(lyricsQuerySchema.safeParse(invalidTrack1).success, false)

  // Missing title rejected
  const invalidTrack2 = { id: 'track-2', artistName: 'Artist' } as unknown as Track
  assert.strictEqual(lyricsQuerySchema.safeParse(invalidTrack2).success, false)

  // Valid track passes
  const validTrack = {
    id: 'track-ok',
    videoId: 'yt-123',
    title: 'Bohemian Rhapsody',
    artistName: 'Queen',
    albumTitle: 'A Night at the Opera',
    durationSeconds: 354,
  } as Track
  assert.strictEqual(lyricsQuerySchema.safeParse(validTrack).success, true)
})

test('LyricsOrchestrator: Synchronized lyrics schema validates correct lyric structures [SMALL-25]', () => {
  const validWord = {
    text: 'Mama',
    startTimeMs: 1200,
    endTimeMs: 1800,
  }
  assert.strictEqual(lyricWordSchema.safeParse(validWord).success, true)

  const validLine = {
    startTimeMs: 1000,
    endTimeMs: 4000,
    text: 'Mama, just killed a man',
    words: [validWord],
  }
  assert.strictEqual(lyricLineSchema.safeParse(validLine).success, true)

  const validLyrics: SynchronizedLyrics = {
    provider: 'LRCLIB',
    isSynced: true,
    isWordSynced: true,
    lines: [validLine],
  }
  assert.strictEqual(synchronizedLyricsSchema.safeParse(validLyrics).success, true)

  // Invalid provider rejected
  const invalidLyrics = {
    provider: 'UNKNOWN_PROVIDER',
    isSynced: true,
    isWordSynced: false,
    lines: [],
  }
  assert.strictEqual(synchronizedLyricsSchema.safeParse(invalidLyrics).success, false)
})

test('LyricsOrchestrator: In-flight deduplication coalesces concurrent requests for the same track [SMALL-25]', async () => {
  resetLyricsOrchestratorMetrics()
  const orchestrator = LyricsOrchestrator.getInstance()
  orchestrator.clearCache()

  const originalFetch = globalThis.fetch
  let fetchCallCount = 0

  // Mock fetch that simulates network latency and returns valid LRCLIB synced lyrics
  globalThis.fetch = (async () => {
    fetchCallCount++
    await new Promise((resolve) => setTimeout(resolve, 50))
    return new Response(JSON.stringify({ id: 1, plainLyrics: '', syncedLyrics: '[00:01.00] Coalesced lyric line' }), {
      status: 200,
    })
  }) as typeof fetch

  const track: Track = {
    id: 'coalesce-test-track',
    title: 'Coalescing Song',
    artistName: 'Concurrent Artist',
  }

  try {
    // Fire 3 simultaneous requests for the exact same track
    const [res1, res2, res3] = await Promise.all([
      orchestrator.getLyrics(track),
      orchestrator.getLyrics(track),
      orchestrator.getLyrics(track),
    ])

    assert.ok(res1)
    assert.deepStrictEqual(res1, res2)
    assert.deepStrictEqual(res1, res3)

    const metrics = getLyricsOrchestratorMetrics()
    assert.strictEqual(metrics.totalRequests, 3)
    assert.strictEqual(fetchCallCount, 1, 'Only one network call should be triggered for coalesced requests')
    assert.ok(metrics.coalescedRequests >= 2, `Expected coalescedRequests >= 2, got ${metrics.coalescedRequests}`)
    assert.strictEqual(metrics.networkRequests, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('LyricsOrchestrator: Cancellation cleans up active abort controller and records aborted failure [SMALL-25]', async () => {
  resetLyricsOrchestratorMetrics()
  const orchestrator = LyricsOrchestrator.getInstance()
  orchestrator.clearCache()

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (_url: string | URL | Request, opts?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const signal = opts?.signal
      if (signal) {
        signal.addEventListener('abort', () => reject(new Error('AbortError')), { once: true })
      }
    })
  }) as typeof fetch

  const track: Track = {
    id: 'cancel-test-track',
    title: 'Aborting Song',
    artistName: 'Abort Artist',
  }

  const externalAbortController = new AbortController()

  try {
    const fetchPromise = orchestrator.getLyrics(track, externalAbortController.signal)
    // Abort externally after 10ms
    setTimeout(() => externalAbortController.abort(), 10)

    const result = await fetchPromise
    assert.strictEqual(result, null)

    const metrics = getLyricsOrchestratorMetrics()
    assert.ok(metrics.failuresByReason['aborted'] >= 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('LyricsOrchestrator: cancelOngoingFetch method cancels active fetch [SMALL-25]', async () => {
  resetLyricsOrchestratorMetrics()
  const orchestrator = LyricsOrchestrator.getInstance()
  orchestrator.clearCache()

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (_url: string | URL | Request, opts?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const signal = opts?.signal
      if (signal) {
        signal.addEventListener('abort', () => reject(new Error('AbortError')), { once: true })
      }
    })
  }) as typeof fetch

  const track: Track = {
    id: 'cancel-ongoing-track',
    title: 'Ongoing Cancellation Song',
    artistName: 'Ongoing Artist',
  }

  try {
    const fetchPromise = orchestrator.getLyrics(track)
    // Cancel immediately via orchestrator API
    orchestrator.cancelOngoingFetch()

    const result = await fetchPromise
    assert.strictEqual(result, null)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('LyricsOrchestrator: Memory cache hits bypass network and increment memoryCacheHits metric [SMALL-25]', async () => {
  resetLyricsOrchestratorMetrics()
  const orchestrator = LyricsOrchestrator.getInstance()
  orchestrator.clearCache()

  const track: Track = {
    id: 'memory-cache-hit-track',
    title: 'Cached Song',
    artistName: 'Cached Artist',
  }

  const fakeLyrics: SynchronizedLyrics = {
    provider: 'LRCLIB',
    isSynced: true,
    isWordSynced: false,
    lines: [{ startTimeMs: 0, text: 'Hello cached world' }],
  }

  const cacheKey = orchestrator.buildCacheKey(track, 'LRCLIB', false)
  orchestrator.setCacheEntry(cacheKey, {
    lyrics: fakeLyrics,
    cachedAt: Date.now(),
    expiresAt: Date.now() + 60000,
  })

  const result = await orchestrator.getLyrics(track)
  assert.deepStrictEqual(result, fakeLyrics)

  const metrics = getLyricsOrchestratorMetrics()
  assert.strictEqual(metrics.memoryCacheHits, 1)
  assert.strictEqual(metrics.networkRequests, 0)
  assert.strictEqual(lyricsOrchestratorMetricsSchema.safeParse(metrics).success, true)
})

test('LyricsOrchestrator: Cascade fallback advances to subsequent provider when prior returns null [SMALL-25]', async () => {
  resetLyricsOrchestratorMetrics()
  const orchestrator = LyricsOrchestrator.getInstance()
  orchestrator.clearCache()

  const originalFetch = globalThis.fetch
  const urlsRequested: string[] = []

  globalThis.fetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString()
    urlsRequested.push(urlStr)

    // LRCLIB returns 404
    if (urlStr.includes('lrclib.net')) {
      return new Response('{"error":"not found"}', { status: 404 })
    }
    // BetterLyrics returns valid TTML
    if (urlStr.includes('lyrics-api.boidu.dev')) {
      const ttml = `<?xml version="1.0" encoding="utf-8"?>
        <tt xmlns="http://www.w3.org/ns/ttml">
          <body><div><p begin="00:00:01.000" end="00:00:05.000">Fallback BetterLyrics line</p></div></body>
        </tt>`
      return new Response(JSON.stringify({ ttml }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch

  const track: Track = {
    id: 'cascade-test-track',
    title: 'Cascade Song',
    artistName: 'Cascade Artist',
  }

  try {
    const result = await orchestrator.getLyrics(track)
    assert.ok(result)
    assert.strictEqual(result.provider, 'BETTER_LYRICS')
    assert.strictEqual(result.lines[0]?.text, 'Fallback BetterLyrics line')

    const metrics = getLyricsOrchestratorMetrics()
    assert.strictEqual(metrics.providerHits.BETTER_LYRICS, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('LyricsOrchestrator: Malformed input returns null and records failure without network fetch [SMALL-25]', async () => {
  resetLyricsOrchestratorMetrics()
  const orchestrator = LyricsOrchestrator.getInstance()
  orchestrator.clearCache()

  const originalFetch = globalThis.fetch
  let fetchTriggered = false
  globalThis.fetch = (async () => {
    fetchTriggered = true
    return new Response('{}', { status: 200 })
  }) as typeof fetch

  try {
    // Track with empty title
    const badTrack = { id: 'bad-1', title: '', artistName: 'Artist' } as Track
    const res = await orchestrator.getLyrics(badTrack)
    assert.strictEqual(res, null)
    assert.strictEqual(fetchTriggered, false)

    const metrics = getLyricsOrchestratorMetrics()
    assert.strictEqual(metrics.failuresByReason['malformed_input'], 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
