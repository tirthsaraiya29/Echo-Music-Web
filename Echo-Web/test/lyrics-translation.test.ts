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
  TranslationClient,
  aiProviderSchema,
  aiKeysConfigSchema,
  translationMetricsSchema,
  getTranslationMetrics,
  resetTranslationMetrics,
} from '../src/services/ai/TranslationClient.ts'
import type { LyricLine } from '../src/types/lyrics.ts'

test('AI Translation: aiProviderSchema and config schema validate supported providers [SMALL-27]', () => {
  assert.strictEqual(aiProviderSchema.safeParse('openrouter').success, true)
  assert.strictEqual(aiProviderSchema.safeParse('deepl').success, true)
  assert.strictEqual(aiProviderSchema.safeParse('mistral').success, true)
  assert.strictEqual(aiProviderSchema.safeParse('openai-compatible').success, true)
  assert.strictEqual(aiProviderSchema.safeParse('anthropic').success, true)
  assert.strictEqual(aiProviderSchema.safeParse('gemini').success, true)
  assert.strictEqual(aiProviderSchema.safeParse('unsupported-provider').success, false)

  const validConfig = {
    provider: 'gemini',
    geminiKey: 'AIza-test-key',
    geminiModel: 'gemini-2.0-flash',
    targetLanguage: 'Spanish',
  }
  assert.strictEqual(aiKeysConfigSchema.safeParse(validConfig).success, true)
})

test('AI Translation: hasConfiguredKey validates required keys per provider [SMALL-27]', () => {
  const client = TranslationClient.getInstance()

  client.saveConfig({ provider: 'openrouter', openRouterKey: '' })
  assert.strictEqual(client.hasConfiguredKey(), false)

  client.saveConfig({ provider: 'openrouter', openRouterKey: 'sk-or-valid' })
  assert.strictEqual(client.hasConfiguredKey(), true)

  client.saveConfig({ provider: 'deepl', deepLKey: 'deepl-auth-key' })
  assert.strictEqual(client.hasConfiguredKey(), true)

  client.saveConfig({
    provider: 'openai-compatible',
    openAiKey: 'sk-test',
    openAiBaseUrl: 'https://api.openai.com/v1',
  })
  assert.strictEqual(client.hasConfiguredKey(), true)
})

test('AI Translation: in-flight coalescing merges concurrent requests for identical lyric sets [SMALL-27]', async () => {
  resetTranslationMetrics()
  const client = TranslationClient.getInstance()
  client.clearCache()

  const originalFetch = globalThis.fetch
  let fetchCallCount = 0

  globalThis.fetch = (async () => {
    fetchCallCount++
    await new Promise((resolve) => setTimeout(resolve, 50))
    const responsePayload = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              '0': 'Bonjour le monde',
              '1': 'Chante avec moi',
            }),
          },
        },
      ],
    }
    return new Response(JSON.stringify(responsePayload), { status: 200 })
  }) as typeof fetch

  const lines: LyricLine[] = [
    { startTimeMs: 1000, text: 'Hello world' },
    { startTimeMs: 4000, text: 'Sing with me' },
  ]

  const configOverride = {
    provider: 'openrouter' as const,
    openRouterKey: 'test-key',
    targetLanguage: 'French',
  }

  try {
    const [res1, res2, res3] = await Promise.all([
      client.translateLyrics(lines, configOverride),
      client.translateLyrics(lines, configOverride),
      client.translateLyrics(lines, configOverride),
    ])

    assert.strictEqual(fetchCallCount, 1, 'Only one network call should occur for coalesced requests')
    assert.strictEqual(res1[0]?.translatedText, 'Bonjour le monde')
    assert.strictEqual(res2[0]?.translatedText, 'Bonjour le monde')
    assert.strictEqual(res3[0]?.translatedText, 'Bonjour le monde')

    const metrics = getTranslationMetrics()
    assert.strictEqual(metrics.totalTranslations, 3)
    assert.ok(metrics.coalescedRequests >= 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('AI Translation: memory cache serves subsequent identical translations immediately [SMALL-27]', async () => {
  resetTranslationMetrics()
  const client = TranslationClient.getInstance()
  client.clearCache()

  const originalFetch = globalThis.fetch
  let fetchCallCount = 0

  globalThis.fetch = (async () => {
    fetchCallCount++
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ '0': 'Hola mundo' }),
            },
          },
        ],
      }),
      { status: 200 },
    )
  }) as typeof fetch

  const lines: LyricLine[] = [{ startTimeMs: 1000, text: 'Hello world' }]
  const config = { provider: 'openrouter' as const, openRouterKey: 'key', targetLanguage: 'Spanish' }

  try {
    // First call -> network
    const first = await client.translateLyrics(lines, config)
    assert.strictEqual(first[0]?.translatedText, 'Hola mundo')
    assert.strictEqual(fetchCallCount, 1)

    // Second call -> memory cache hit
    const second = await client.translateLyrics(lines, config)
    assert.strictEqual(second[0]?.translatedText, 'Hola mundo')
    assert.strictEqual(fetchCallCount, 1)

    const metrics = getTranslationMetrics()
    assert.strictEqual(metrics.cacheHits, 1)
    assert.strictEqual(translationMetricsSchema.safeParse(metrics).success, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('AI Translation: cancellation terminates active fetch and records aborted metric [SMALL-27]', async () => {
  resetTranslationMetrics()
  const client = TranslationClient.getInstance()
  client.clearCache()

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (_url: string | URL | Request, opts?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      opts?.signal?.addEventListener('abort', () => reject(new Error('AbortError')), { once: true })
    })
  }) as typeof fetch

  const lines: LyricLine[] = [{ startTimeMs: 1000, text: 'Cancel lyric line' }]
  const config = { provider: 'openrouter' as const, openRouterKey: 'key', targetLanguage: 'German' }
  const abortController = new AbortController()

  try {
    const promise = client.translateLyrics(lines, config, abortController.signal)
    setTimeout(() => abortController.abort(), 10)

    await assert.rejects(promise)

    const metrics = getTranslationMetrics()
    assert.strictEqual(metrics.failuresByReason['aborted'], 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
