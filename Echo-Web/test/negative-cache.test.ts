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
import { CanvasManager } from '../src/services/canvas/CanvasManager.ts'
import type { Track } from '../src/types/domain.ts'

test('Negative cache: LyricsOrchestrator expires negative cache entries after TTL [BUG-18]', async () => {
  const orchestrator = LyricsOrchestrator.getInstance()
  orchestrator.clearCache()

  const track: Track = {
    id: 'test-track-neg-lyrics',
    title: 'Unknown Title',
    artistName: 'Unknown Artist',
    durationSeconds: 180,
  }

  const cacheKey = orchestrator.buildCacheKey(track, 'LRCLIB', false)

  // 1. Manually insert expired negative cache entry
  orchestrator.setCacheEntry(cacheKey, {
    lyrics: null,
    cachedAt: Date.now() - 300000,
    expiresAt: Date.now() - 1000, // Expired
  })

  // Verify it exists before getLyrics
  assert.ok(orchestrator.getCacheEntry(cacheKey))

  // Mock fetch to simulate immediate 404/not-found without waiting for external network timeouts
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{"error":"not found"}', { status: 404 })

  try {
    const result = await orchestrator.getLyrics(track)
    assert.strictEqual(result, null)

    // Verify that the entry was refreshed with new timestamps and NEGATIVE_CACHE_TTL_MS
    const refreshed = orchestrator.getCacheEntry(cacheKey)
    assert.ok(refreshed)
    assert.strictEqual(refreshed.lyrics, null)
    assert.ok(refreshed.expiresAt > Date.now())
    assert.ok(refreshed.expiresAt <= Date.now() + LyricsOrchestrator.NEGATIVE_CACHE_TTL_MS)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Negative cache: CanvasManager expires negative cache entries after TTL [BUG-18]', async () => {
  const canvasManager = CanvasManager.getInstance()
  canvasManager.clearCache()

  const track: Track = {
    id: 'test-track-neg-canvas',
    title: 'Unknown Canvas Song',
    artistName: 'Unknown Canvas Artist',
  }

  const cacheKey = `${track.id}:${track.title}:${track.artistName}`

  // 1. Manually insert expired negative cache entry
  canvasManager.setCacheEntry(cacheKey, {
    result: null,
    cachedAt: Date.now() - 300000,
    expiresAt: Date.now() - 1000, // Expired
  })

  assert.ok(canvasManager.getCacheEntry(cacheKey))

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{"error":"not found"}', { status: 404 })

  try {
    const result = await canvasManager.resolveCanvasVideo(track)
    assert.strictEqual(result, null)

    // Verify refreshed entry has new negative TTL
    const refreshed = canvasManager.getCacheEntry(cacheKey)
    assert.ok(refreshed)
    assert.strictEqual(refreshed.result, null)
    assert.ok(refreshed.expiresAt > Date.now())
    assert.ok(refreshed.expiresAt <= Date.now() + CanvasManager.NEGATIVE_CACHE_TTL_MS)
  } finally {
    globalThis.fetch = originalFetch
  }
})
