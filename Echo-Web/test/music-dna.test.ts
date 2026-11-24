import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'

import {
  musicDnaQuerySchema,
  musicDnaDataSchema,
  musicDnaMetricsSchema,
  getMusicDnaMetrics,
  resetMusicDnaMetrics,
  recordMusicDnaMetric,
  isReducedMotionPreferred,
} from '../src/services/musicDna/musicDnaTypes.ts'

import {
  fetchMusicDna,
  clearMusicDnaCache,
} from '../src/services/musicDna/musicDnaService.ts'

test('MusicDNA: musicDnaQuerySchema validates inputs and rejects empty or malformed strings [SMALL-30]', () => {
  const valid = { title: 'Bohemian Rhapsody', artist: 'Queen' }
  const parsed = musicDnaQuerySchema.safeParse(valid)
  assert.strictEqual(parsed.success, true)
  if (parsed.success) {
    assert.strictEqual(parsed.data.title, 'Bohemian Rhapsody')
    assert.strictEqual(parsed.data.artist, 'Queen')
  }

  // Missing / empty title rejected
  assert.strictEqual(musicDnaQuerySchema.safeParse({ title: '   ', artist: 'Queen' }).success, false)
  assert.strictEqual(musicDnaQuerySchema.safeParse({ title: '', artist: 'Queen' }).success, false)

  // Empty artist defaults to ''
  const emptyArtist = musicDnaQuerySchema.safeParse({ title: 'Song With No Artist' })
  assert.strictEqual(emptyArtist.success, true)
  if (emptyArtist.success) {
    assert.strictEqual(emptyArtist.data.artist, '')
  }
})

test('MusicDNA: musicDnaDataSchema validates complete payload structures [SMALL-30]', () => {
  const payload = {
    trackTitle: 'Starboy',
    artistName: 'The Weeknd',
    genius: {
      songId: 123456,
      description: 'Song background lore and lyrics annotation',
      releaseDate: 'September 21, 2016',
      producer: 'Daft Punk',
      annotationHighlights: ['Major hit record'],
    },
    wikipedia: {
      title: 'Starboy (song)',
      extract: 'Starboy is a song recorded by Canadian singer the Weeknd...',
      pageUrl: 'https://en.wikipedia.org/wiki/Starboy_(song)',
    },
    artistWikipedia: {
      title: 'The Weeknd',
      extract: 'Abel Makkonen Tesfaye is a Canadian singer-songwriter...',
      pageUrl: 'https://en.wikipedia.org/wiki/The_Weeknd',
    },
  }

  const result = musicDnaDataSchema.safeParse(payload)
  assert.strictEqual(result.success, true)
  assert.strictEqual(musicDnaDataSchema.safeParse({ invalid: 'object' }).success, false)
})

test('MusicDNA: telemetry metrics record activity and reset cleanly [SMALL-30]', () => {
  resetMusicDnaMetrics()
  const initial = getMusicDnaMetrics()

  assert.strictEqual(initial.requests, 0)
  assert.strictEqual(initial.cacheHits, 0)
  assert.strictEqual(initial.cacheMisses, 0)
  assert.strictEqual(initial.inFlightDeduplications, 0)
  assert.strictEqual(initial.errors, 0)
  assert.strictEqual(initial.cancellations, 0)
  assert.strictEqual(musicDnaMetricsSchema.safeParse(initial).success, true)

  recordMusicDnaMetric('requests')
  recordMusicDnaMetric('cacheMisses')
  recordMusicDnaMetric('cacheHits')
  recordMusicDnaMetric('inFlightDeduplications')
  recordMusicDnaMetric('retries')

  const updated = getMusicDnaMetrics()
  assert.strictEqual(updated.requests, 1)
  assert.strictEqual(updated.cacheMisses, 1)
  assert.strictEqual(updated.cacheHits, 1)
  assert.strictEqual(updated.inFlightDeduplications, 1)
  assert.strictEqual(updated.retries, 1)

  resetMusicDnaMetrics()
  assert.strictEqual(getMusicDnaMetrics().requests, 0)
})

test('MusicDNA: isReducedMotionPreferred defaults safely in Node environment [SMALL-30]', () => {
  assert.strictEqual(isReducedMotionPreferred(), false)
})

test('MusicDNA: in-flight deduplication and cache work cleanly [SMALL-30]', async () => {
  clearMusicDnaCache()
  resetMusicDnaMetrics()

  // Mock global fetch for this test
  const originalFetch = globalThis.fetch
  let fetchCount = 0

  globalThis.fetch = async () => {
    fetchCount++
    await new Promise((r) => setTimeout(r, 20))
    return {
      ok: true,
      json: async () => ({
        trackTitle: 'Test Song',
        artistName: 'Test Artist',
        genius: { description: 'Lore description' },
      }),
    } as unknown as Response
  }

  try {
    const track = {
      id: 'test-dna-1',
      title: 'Test Song',
      artistName: 'Test Artist',
    } as any

    // Concurrent fetches coalesce into 1 network call
    const [res1, res2] = await Promise.all([
      fetchMusicDna(track),
      fetchMusicDna(track),
    ])

    assert.strictEqual(fetchCount, 1)
    assert.strictEqual(res1.trackTitle, 'Test Song')
    assert.strictEqual(res2.trackTitle, 'Test Song')
    assert.strictEqual(getMusicDnaMetrics().inFlightDeduplications, 1)

    // Third call reads from LRU cache
    const res3 = await fetchMusicDna(track)
    assert.strictEqual(fetchCount, 1)
    assert.strictEqual(res3.trackTitle, 'Test Song')
    assert.strictEqual(getMusicDnaMetrics().cacheHits, 1)
  } finally {
    globalThis.fetch = originalFetch
    clearMusicDnaCache()
  }
})

test('MusicDNA: cancellation via AbortSignal aborts in-flight request cleanly [SMALL-30]', async () => {
  clearMusicDnaCache()
  resetMusicDnaMetrics()

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    return new Promise((resolve, reject) => {
      const signal = init?.signal
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'))
      })
    })
  }

  try {
    const controller = new AbortController()
    const track = { id: 'test-cancel-1', title: 'Cancelling Track', artistName: 'Artist' } as any

    const promise = fetchMusicDna(track, { signal: controller.signal, timeoutMs: 5000, skipRetry: true })
    controller.abort()

    await assert.rejects(promise)
    assert.strictEqual(getMusicDnaMetrics().cancellations, 1)
  } finally {
    globalThis.fetch = originalFetch
    clearMusicDnaCache()
  }
})

test('MusicDNA: component source enforces keyboard (Escape), ARIA, touch targets, and error states [SMALL-30]', () => {
  const code = fs.readFileSync('src/components/player/MusicDnaDrawer.tsx', 'utf8')

  // Escape key support
  assert.ok(code.includes("e.key === 'Escape'"), 'Component must listen for Escape key to close')

  // Accessible dialog role and labeling
  assert.ok(code.includes('role="dialog"'), 'Must have role="dialog"')
  assert.ok(code.includes('aria-modal="true"'), 'Must have aria-modal="true"')
  assert.ok(code.includes('aria-labelledby="music-dna-title"'), 'Must have aria-labelledby')

  // Accessible tab navigation
  assert.ok(code.includes('role="tablist"'), 'Must have role="tablist"')
  assert.ok(code.includes('role="tab"'), 'Must have role="tab"')
  assert.ok(code.includes('aria-selected'), 'Must have aria-selected')
  assert.ok(code.includes('aria-controls'), 'Must have aria-controls')
  assert.ok(code.includes('role="tabpanel"'), 'Must have role="tabpanel"')

  // Touch target sizing (minimum 44x44px)
  assert.ok(code.includes('min-h-[44px]'), 'Must support accessible min 44px touch targets')
  assert.ok(code.includes('min-w-[44px]'), 'Must support accessible min 44px touch targets')

  // Recoverable error state and retry action
  assert.ok(code.includes('role="alert"'), 'Must have role="alert" for error states')
  assert.ok(code.includes('Retry Analysis'), 'Must have a retry button for recoverable errors')

  // Offline indicator support
  assert.ok(code.includes('isOffline'), 'Must track offline state')
  assert.ok(code.includes('Offline'), 'Must display offline badge')

  // Reduced motion compliance
  assert.ok(code.includes('prefersReducedMotion'), 'Must respect prefersReducedMotion')
})
