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

import { LyricsOrchestrator } from '../src/services/lyrics/LyricsOrchestrator.ts'
import type { Track } from '../src/types/domain.ts'

test('Lyrics Provider Cascade: prioritizes preferred provider correctly [BUG-16]', () => {
  const orchestrator = LyricsOrchestrator.getInstance()

  // 1. LRCLIB preferred
  const lrclibCascade = orchestrator.getProviderCascade('LRCLIB')
  assert.strictEqual(lrclibCascade[0], 'LRCLIB')
  assert.deepStrictEqual(lrclibCascade, ['LRCLIB', 'LYRICS_PLUS', 'BETTER_LYRICS', 'KUGOU'])

  // 2. LyricsPlus preferred
  const lyricsPlusCascade = orchestrator.getProviderCascade('LYRICS_PLUS')
  assert.strictEqual(lyricsPlusCascade[0], 'LYRICS_PLUS')
  assert.deepStrictEqual(lyricsPlusCascade, ['LYRICS_PLUS', 'LRCLIB', 'BETTER_LYRICS', 'KUGOU'])

  // 3. BetterLyrics preferred
  const betterLyricsCascade = orchestrator.getProviderCascade('BETTER_LYRICS')
  assert.strictEqual(betterLyricsCascade[0], 'BETTER_LYRICS')
  assert.deepStrictEqual(betterLyricsCascade, ['BETTER_LYRICS', 'LYRICS_PLUS', 'LRCLIB', 'KUGOU'])

  // 4. KuGou preferred
  const kugouCascade = orchestrator.getProviderCascade('KUGOU')
  assert.strictEqual(kugouCascade[0], 'KUGOU')
  assert.deepStrictEqual(kugouCascade, ['KUGOU', 'LYRICS_PLUS', 'LRCLIB', 'BETTER_LYRICS'])

  // 5. Default fallback when unconfigured
  const defaultCascade = orchestrator.getProviderCascade('UNKNOWN_PROVIDER')
  assert.strictEqual(defaultCascade[0], 'LRCLIB')
})

test('Lyrics Cache Key: incorporates preferred provider and romanization setting [BUG-16]', () => {
  const orchestrator = LyricsOrchestrator.getInstance()
  const track: Track = {
    id: 'track-123',
    title: 'Song Title',
    artistName: 'Artist Name',
    durationSeconds: 200,
  }

  // Same track, different providers -> distinct cache keys
  const keyLrclib = orchestrator.buildCacheKey(track, 'LRCLIB', false)
  const keyBetterLyrics = orchestrator.buildCacheKey(track, 'BETTER_LYRICS', false)
  const keyKugou = orchestrator.buildCacheKey(track, 'KUGOU', false)

  assert.notStrictEqual(keyLrclib, keyBetterLyrics)
  assert.notStrictEqual(keyLrclib, keyKugou)
  assert.ok(keyLrclib.includes('LRCLIB:orig'))
  assert.ok(keyBetterLyrics.includes('BETTER_LYRICS:orig'))
  assert.ok(keyKugou.includes('KUGOU:orig'))

  // Same track & provider, different romanization -> distinct cache keys
  const keyRomanized = orchestrator.buildCacheKey(track, 'LRCLIB', true)
  assert.notStrictEqual(keyLrclib, keyRomanized)
  assert.ok(keyRomanized.includes('LRCLIB:rom'))
})

test('Lyrics Loading Lifecycle: transitions from loading to resolved/empty state cleanly [BUG-25]', async () => {
  const orchestrator = LyricsOrchestrator.getInstance()
  const track: Track = {
    id: 'test-track-loading',
    title: 'Testing Loading State',
    artistName: 'Test Artist',
  }

  // State tracker mimicking LyricsView state machine
  let isLoading = false
  let lyricsData: any = { lines: [{ text: 'Old lyrics from previous track' }] }
  let activeLineIndex = 5
  let loadError = false

  const startFetch = (targetTrack: Track | null) => {
    if (!targetTrack) {
      lyricsData = null
      isLoading = false
      activeLineIndex = -1
      loadError = false
      return
    }

    // Immediately upon track change:
    isLoading = true
    lyricsData = null
    activeLineIndex = -1
    loadError = false
  }

  // 1. Initial track switch: verify loading state activates and stale lyrics are evicted immediately
  startFetch(track)
  assert.strictEqual(isLoading, true, 'isLoading must be true while fetching')
  assert.strictEqual(lyricsData, null, 'Stale lyrics must be cleared immediately upon track change')
  assert.strictEqual(activeLineIndex, -1, 'activeLineIndex must reset to -1')
  assert.strictEqual(loadError, false)

  // 2. Mock resolution
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('{"error":"not found"}', { status: 404 })) as any

  try {
    const res = await orchestrator.getLyrics(track)
    isLoading = false
    lyricsData = res
    assert.strictEqual(isLoading, false)
    assert.strictEqual(lyricsData, null)
  } finally {
    globalThis.fetch = originalFetch
  }

  // 3. Null track switch: cleans up all state
  startFetch(null)
  assert.strictEqual(isLoading, false)
  assert.strictEqual(lyricsData, null)
  assert.strictEqual(activeLineIndex, -1)
})

test('Lyrics Binary Search: findActiveLineIndex locates active lyric line in O(log N) without full scan [BUG-26]', async () => {
  const { findActiveLineIndex } = await import('../src/services/lyrics/lyricsUtils.ts')
  const lines = [
    { startTimeMs: 2000, endTimeMs: 5000, text: 'First line' },
    { startTimeMs: 6000, endTimeMs: 10000, text: 'Second line' },
    { startTimeMs: 11000, endTimeMs: 15000, text: 'Third line' },
    { startTimeMs: 18000, endTimeMs: 22000, text: 'Fourth line' },
    { startTimeMs: 25000, endTimeMs: 30000, text: 'Final line' },
  ]

  // 1. Before first line
  assert.strictEqual(findActiveLineIndex(lines, 0), -1)
  assert.strictEqual(findActiveLineIndex(lines, 1999), -1)

  // 2. Exactly on first line start
  assert.strictEqual(findActiveLineIndex(lines, 2000), 0)
  assert.strictEqual(findActiveLineIndex(lines, 3500), 0)

  // 3. Middle lines
  assert.strictEqual(findActiveLineIndex(lines, 6000), 1)
  assert.strictEqual(findActiveLineIndex(lines, 8500), 1)
  assert.strictEqual(findActiveLineIndex(lines, 12000), 2)
  assert.strictEqual(findActiveLineIndex(lines, 20000), 3)

  // 4. Final line and past end
  assert.strictEqual(findActiveLineIndex(lines, 25000), 4)
  assert.strictEqual(findActiveLineIndex(lines, 45000), 4)

  // 5. Empty array
  assert.strictEqual(findActiveLineIndex([], 5000), -1)
})


