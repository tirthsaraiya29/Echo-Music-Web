import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

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
  connectionTestResultSchema,
  discoveredModelSchema,
  getTranslationMetrics,
  resetTranslationMetrics,
} from '../src/services/ai/TranslationClient.ts'

test('Translation Provider Testing: schemas validate test results and discovered models [FEATURE-057]', () => {
  const validResult = {
    ok: true,
    provider: 'openrouter',
    latencyMs: 125,
    message: 'Connected to OpenRouter using google/gemini-2.0-flash-001',
    model: 'google/gemini-2.0-flash-001',
    statusCode: 200,
  }
  assert.strictEqual(connectionTestResultSchema.safeParse(validResult).success, true)

  const failedResult = {
    ok: false,
    provider: 'deepl',
    latencyMs: 340,
    message: 'Connection test failed',
    error: 'DeepL auth key is not configured.',
  }
  assert.strictEqual(connectionTestResultSchema.safeParse(failedResult).success, true)

  const validModel = {
    id: 'google/gemini-2.5-flash',
    name: 'Google Gemini 2.5 Flash',
    description: 'Fast multimodal model',
    contextLength: 1000000,
  }
  assert.strictEqual(discoveredModelSchema.safeParse(validModel).success, true)
})

test('Translation Provider Testing: getCuratedModels returns curated catalog for supported providers [FEATURE-057]', () => {
  const client = TranslationClient.getInstance()

  const openRouterModels = client.getCuratedModels('openrouter')
  assert.ok(openRouterModels.length > 0)
  assert.ok(openRouterModels.some((m) => m.id.includes('gemini')))

  const mistralModels = client.getCuratedModels('mistral')
  assert.ok(mistralModels.length > 0)
  assert.ok(mistralModels.some((m) => m.id === 'mistral-small-latest'))

  const geminiModels = client.getCuratedModels('gemini')
  assert.ok(geminiModels.length > 0)
  assert.ok(geminiModels.some((m) => m.id === 'gemini-2.0-flash'))

  const anthropicModels = client.getCuratedModels('anthropic')
  assert.ok(anthropicModels.length > 0)

  // DeepL doesn't use LLM models
  assert.strictEqual(client.getCuratedModels('deepl').length, 0)
})

test('Translation Provider Testing: testConnection performs live verification and handles success [FEATURE-057]', async () => {
  resetTranslationMetrics()
  const client = TranslationClient.getInstance()

  const originalFetch = globalThis.fetch
  let fetchCalledWith = ''

  globalThis.fetch = (async (url: string) => {
    fetchCalledWith = String(url)
    return new Response(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }), {
      status: 200,
    })
  }) as typeof fetch

  try {
    const res = await client.testConnection({
      provider: 'openrouter',
      openRouterKey: 'valid-test-key',
      openRouterModel: 'google/gemini-2.0-flash-001',
    })

    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.provider, 'openrouter')
    assert.strictEqual(res.statusCode, 200)
    assert.ok(fetchCalledWith.includes('openrouter.ai'))

    const metrics = getTranslationMetrics()
    assert.strictEqual(metrics.connectionTestsRun, 1)
    assert.strictEqual(metrics.connectionTestsSuccessful, 1)
    assert.strictEqual(metrics.connectionTestsFailed, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Translation Provider Testing: testConnection handles error diagnostics cleanly [FEATURE-057]', async () => {
  resetTranslationMetrics()
  const client = TranslationClient.getInstance()

  const originalFetch = globalThis.fetch

  globalThis.fetch = (async () => {
    return new Response('Unauthorized: Invalid API key', { status: 401 })
  }) as typeof fetch

  try {
    const res = await client.testConnection({
      provider: 'mistral',
      mistralKey: 'invalid-key',
    })

    assert.strictEqual(res.ok, false)
    assert.strictEqual(res.provider, 'mistral')
    assert.ok(res.error?.includes('401'))

    const metrics = getTranslationMetrics()
    assert.strictEqual(metrics.connectionTestsRun, 1)
    assert.strictEqual(metrics.connectionTestsSuccessful, 0)
    assert.strictEqual(metrics.connectionTestsFailed, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Translation Provider Testing: discoverModels retrieves models from API with curated fallback [FEATURE-057]', async () => {
  resetTranslationMetrics()
  const client = TranslationClient.getInstance()

  const originalFetch = globalThis.fetch

  // 1. API discovery success
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        data: [
          { id: 'custom-model-alpha', name: 'Custom Alpha', context_length: 32000 },
          { id: 'custom-model-beta', name: 'Custom Beta' },
        ],
      }),
      { status: 200 },
    )
  }) as typeof fetch

  try {
    const models = await client.discoverModels('openrouter', {
      openRouterKey: 'test-key',
    })

    assert.strictEqual(models.length, 2)
    assert.strictEqual(models[0].id, 'custom-model-alpha')
    assert.strictEqual(models[0].contextLength, 32000)

    // 2. Fallback to curated catalog on network error
    globalThis.fetch = (async () => {
      throw new Error('Network error')
    }) as typeof fetch

    const fallbackModels = await client.discoverModels('gemini', {
      geminiKey: 'key',
    })
    assert.ok(fallbackModels.length > 0)
    assert.ok(fallbackModels.some((m) => m.id === 'gemini-2.0-flash'))

    const metrics = getTranslationMetrics()
    assert.strictEqual(metrics.modelDiscoveriesRun, 2)
    assert.ok((metrics.modelsDiscoveredCount || 0) >= 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Translation Provider Testing: documentation artifact exists [FEATURE-057]', () => {
  const docPath = 'docs/translation-provider-testing.md'
  assert.strictEqual(fs.existsSync(docPath), true, 'translation-provider-testing.md must exist')
})
