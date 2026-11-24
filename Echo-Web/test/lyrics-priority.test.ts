import test from 'node:test'
import assert from 'node:assert/strict'

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
  lyricsProviderOrderSchema,
  serializeLyricsProviderOrder,
  deserializeLyricsProviderOrder,
  recordProviderReorder,
  getLyricsOrchestratorMetrics,
  resetLyricsOrchestratorMetrics,
} from '../src/services/lyrics/LyricsOrchestrator.ts'
import { useEchoStore } from '../src/stores/useEchoStore.ts'
import type { Track } from '../src/types/domain.ts'

test('Lyrics Provider Priority: Zod schema validates order and rejects unknown keys', () => {
  const validOrder = ['KUGOU', 'BETTER_LYRICS', 'LYRICS_PLUS', 'LRCLIB']
  assert.strictEqual(lyricsProviderOrderSchema.safeParse(validOrder).success, true)

  const invalidOrder = ['KUGOU', 'INVALID_PROVIDER', 'LRCLIB']
  assert.strictEqual(lyricsProviderOrderSchema.safeParse(invalidOrder).success, false)
})

test('Lyrics Provider Priority: Serialization and deserialization roundtrip safely', () => {
  const order = ['BETTER_LYRICS', 'KUGOU', 'LYRICS_PLUS', 'LRCLIB'] as const
  const serialized = serializeLyricsProviderOrder([...order])
  assert.strictEqual(serialized, 'BETTER_LYRICS,KUGOU,LYRICS_PLUS,LRCLIB')

  const deserialized = deserializeLyricsProviderOrder(serialized)
  assert.deepStrictEqual(deserialized, ['BETTER_LYRICS', 'KUGOU', 'LYRICS_PLUS', 'LRCLIB'])

  // Partial serialized string automatically appends missing providers
  const partial = deserializeLyricsProviderOrder('KUGOU,BETTER_LYRICS')
  assert.strictEqual(partial[0], 'KUGOU')
  assert.strictEqual(partial[1], 'BETTER_LYRICS')
  assert.ok(partial.includes('LRCLIB'))
  assert.ok(partial.includes('LYRICS_PLUS'))
  assert.strictEqual(partial.length, 4)

  // Empty or invalid string returns safe default
  const fallback = deserializeLyricsProviderOrder('')
  assert.deepStrictEqual(fallback, ['LRCLIB', 'LYRICS_PLUS', 'BETTER_LYRICS', 'KUGOU'])
})

test('Lyrics Provider Priority: getProviderCascade strictly honors custom order over hardcoded cascade', () => {
  const orchestrator = LyricsOrchestrator.getInstance()

  // 1. Explicit custom order argument
  const customOrder = ['KUGOU', 'BETTER_LYRICS'] as const
  const cascade = orchestrator.getProviderCascade(undefined, [...customOrder])
  assert.strictEqual(cascade[0], 'KUGOU')
  assert.strictEqual(cascade[1], 'BETTER_LYRICS')
  assert.strictEqual(cascade[2], 'LRCLIB')
  assert.strictEqual(cascade[3], 'LYRICS_PLUS')

  // 2. Custom order configured in store preferences
  const originalOrder = useEchoStore.getState().preferences.lyricsProviderOrder
  try {
    useEchoStore.setState((state) => ({
      ...state,
      preferences: {
        ...state.preferences,
        lyricsProviderOrder: ['LYRICS_PLUS', 'BETTER_LYRICS', 'KUGOU', 'LRCLIB'],
      },
    }))

    const storeCascade = orchestrator.getProviderCascade()
    assert.deepStrictEqual(storeCascade, ['LYRICS_PLUS', 'BETTER_LYRICS', 'KUGOU', 'LRCLIB'])
  } finally {
    useEchoStore.setState((state) => ({
      ...state,
      preferences: {
        ...state.preferences,
        lyricsProviderOrder: originalOrder,
      },
    }))
  }
})

test('Lyrics Provider Priority: getLyrics cascades in configured custom order and records telemetry', async () => {
  resetLyricsOrchestratorMetrics()
  const orchestrator = LyricsOrchestrator.getInstance()
  orchestrator.clearCache()

  const originalFetch = globalThis.fetch
  const queryOrder: string[] = []

  // Configure custom priority: BETTER_LYRICS first, then LRCLIB
  const originalOrder = useEchoStore.getState().preferences.lyricsProviderOrder
  useEchoStore.setState((state) => ({
    ...state,
    preferences: {
      ...state.preferences,
      lyricsProviderOrder: ['BETTER_LYRICS', 'LRCLIB', 'LYRICS_PLUS', 'KUGOU'],
    },
  }))

  globalThis.fetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString()
    if (urlStr.includes('boidu.dev')) {
      queryOrder.push('BETTER_LYRICS')
      // Fail first provider
      return new Response('{}', { status: 404 })
    }
    if (urlStr.includes('lrclib.net')) {
      queryOrder.push('LRCLIB')
      // Succeed on second provider
      return new Response(
        JSON.stringify({
          id: 55,
          syncedLyrics: '[00:01.00] Custom priority succeeded',
        }),
        { status: 200 },
      )
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch

  const track: Track = {
    id: 'priority-test-track',
    title: 'Priority Song',
    artistName: 'Order Artist',
  }

  try {
    const result = await orchestrator.getLyrics(track)
    assert.ok(result)
    assert.strictEqual(result.provider, 'LRCLIB')
    assert.strictEqual(result.lines[0]?.text, 'Custom priority succeeded')

    // Confirm that BETTER_LYRICS was queried first, before LRCLIB
    assert.strictEqual(queryOrder[0], 'BETTER_LYRICS')
    assert.strictEqual(queryOrder[1], 'LRCLIB')

    // Telemetry: customOrderUsedCount incremented
    const metrics = getLyricsOrchestratorMetrics()
    assert.strictEqual(metrics.customOrderUsedCount, 1)

    // Telemetry: recordProviderReorder incremented
    recordProviderReorder()
    const updatedMetrics = getLyricsOrchestratorMetrics()
    assert.strictEqual(updatedMetrics.orderReorderCount, 1)
  } finally {
    globalThis.fetch = originalFetch
    useEchoStore.setState((state) => ({
      ...state,
      preferences: {
        ...state.preferences,
        lyricsProviderOrder: originalOrder,
      },
    }))
  }
})
