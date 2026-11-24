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
  chunkTexts,
  aiKeysConfigSchema,
  translationMetricsSchema,
  getTranslationMetrics,
  resetTranslationMetrics,
} from '../src/services/ai/TranslationClient.ts'
import type { LyricLine } from '../src/types/lyrics.ts'

test('AI Translation Chunking: chunkTexts splits lines with preserved startIndex and bounds [FEATURE-056]', () => {
  // Empty array
  assert.deepStrictEqual(chunkTexts([]), [])

  // Short lyrics (10 lines, default chunk 30) -> 1 chunk
  const shortTexts = Array.from({ length: 10 }, (_, i) => `Line ${i}`)
  const singleChunk = chunkTexts(shortTexts, 30)
  assert.strictEqual(singleChunk.length, 1)
  assert.strictEqual(singleChunk[0].startIndex, 0)
  assert.strictEqual(singleChunk[0].endIndex, 10)
  assert.strictEqual(singleChunk[0].texts.length, 10)

  // Long lyrics (75 lines, chunk size 30) -> 3 chunks (30, 30, 15)
  const longTexts = Array.from({ length: 75 }, (_, i) => `Line ${i}`)
  const chunks = chunkTexts(longTexts, 30)
  assert.strictEqual(chunks.length, 3)

  assert.strictEqual(chunks[0].chunkIndex, 0)
  assert.strictEqual(chunks[0].startIndex, 0)
  assert.strictEqual(chunks[0].endIndex, 30)
  assert.strictEqual(chunks[0].texts.length, 30)

  assert.strictEqual(chunks[1].chunkIndex, 1)
  assert.strictEqual(chunks[1].startIndex, 30)
  assert.strictEqual(chunks[1].endIndex, 60)
  assert.strictEqual(chunks[1].texts.length, 30)

  assert.strictEqual(chunks[2].chunkIndex, 2)
  assert.strictEqual(chunks[2].startIndex, 60)
  assert.strictEqual(chunks[2].endIndex, 75)
  assert.strictEqual(chunks[2].texts.length, 15)
})

test('AI Translation Chunking: parseIndexedJson handles absolute, relative, and array formats [FEATURE-056]', () => {
  const client = TranslationClient.getInstance()

  // 1. Absolute index mapping in JSON
  const absJson = JSON.stringify({
    '30': 'Translated line 30',
    '31': 'Translated line 31',
    '32': 'Translated line 32',
  })
  const parsedAbs = client.parseIndexedJson(absJson, 3, 30)
  assert.deepStrictEqual(parsedAbs, [
    'Translated line 30',
    'Translated line 31',
    'Translated line 32',
  ])

  // 2. Relative 0-based index mapping in JSON (offset resilience)
  const relJson = JSON.stringify({
    '0': 'Rel 0',
    '1': 'Rel 1',
  })
  const parsedRel = client.parseIndexedJson(relJson, 2, 40)
  assert.deepStrictEqual(parsedRel, ['Rel 0', 'Rel 1'])

  // 3. Flat JSON array
  const arrayJson = JSON.stringify(['Item A', 'Item B'])
  const parsedArr = client.parseIndexedJson(arrayJson, 2, 10)
  assert.deepStrictEqual(parsedArr, ['Item A', 'Item B'])

  // 4. Markdown codeblock stripping
  const fencedJson = '```json\n{\n  "50": "Fenced 50"\n}\n```'
  const parsedFenced = client.parseIndexedJson(fencedJson, 1, 50)
  assert.deepStrictEqual(parsedFenced, ['Fenced 50'])
})

test('AI Translation Chunking: aiKeysConfigSchema validates chunk size and retry limits [FEATURE-056]', () => {
  const valid = aiKeysConfigSchema.safeParse({
    provider: 'openrouter',
    translationChunkSize: 25,
    maxChunkRetries: 3,
  })
  assert.strictEqual(valid.success, true)
  if (valid.success) {
    assert.strictEqual(valid.data.translationChunkSize, 25)
    assert.strictEqual(valid.data.maxChunkRetries, 3)
  }

  // Reject out of bounds chunk size (< 5 or > 100)
  assert.strictEqual(
    aiKeysConfigSchema.safeParse({
      provider: 'openrouter',
      translationChunkSize: 3,
    }).success,
    false,
  )
  assert.strictEqual(
    aiKeysConfigSchema.safeParse({
      provider: 'openrouter',
      translationChunkSize: 150,
    }).success,
    false,
  )
})

test('AI Translation Chunking: translates multi-chunk lyrics preserving line indices [FEATURE-056]', async () => {
  resetTranslationMetrics()
  const client = TranslationClient.getInstance()
  client.clearCache()

  const originalFetch = globalThis.fetch
  const chunkRequests: string[] = []

  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}'))
    const userPrompt = body.messages?.[1]?.content || ''
    chunkRequests.push(userPrompt)

    // Parse the lines sent in this prompt
    const linesMatch = userPrompt.match(/Lines to translate:\s*(\{[\s\S]*?\})/i)
    let returnedObj: Record<string, string> = {}
    if (linesMatch) {
      const parsedLines = JSON.parse(linesMatch[1])
      for (const [key, text] of Object.entries(parsedLines)) {
        returnedObj[key] = `Translated ${text}`
      }
    }

    const resPayload = {
      choices: [{ message: { content: JSON.stringify(returnedObj) } }],
    }
    return new Response(JSON.stringify(resPayload), { status: 200 })
  }) as typeof fetch

  try {
    // 50 lines with chunkSize 20 -> 3 chunks (20 + 20 + 10)
    const lines: LyricLine[] = Array.from({ length: 50 }, (_, i) => ({
      timeMs: i * 2000,
      text: `Original song line ${i}`,
    }))

    const result = await client.translateLyrics(lines, {
      provider: 'openrouter',
      openRouterKey: 'test-key',
      translationChunkSize: 20,
      maxChunkRetries: 1,
      targetLanguage: 'French',
    })

    assert.strictEqual(result.length, 50)
    assert.strictEqual(chunkRequests.length, 3, 'Should have made exactly 3 chunk requests')

    // Verify all lines have their corresponding translatedText mapped correctly
    for (let i = 0; i < 50; i++) {
      assert.strictEqual(result[i].translatedText, `Translated Original song line ${i}`)
    }

    const metrics = getTranslationMetrics()
    assert.strictEqual(metrics.chunksProcessed, 3)
    assert.strictEqual(metrics.chunkFailures, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('AI Translation Chunking: retries transient chunk failure and recovers [FEATURE-056]', async () => {
  resetTranslationMetrics()
  const client = TranslationClient.getInstance()
  client.clearCache()

  const originalFetch = globalThis.fetch
  let callCount = 0

  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    callCount++
    if (callCount === 1) {
      // First attempt fails with transient error
      return new Response('Transient rate limit error', { status: 429 })
    }

    const body = JSON.parse(String(init?.body || '{}'))
    const userPrompt = body.messages?.[1]?.content || ''
    const linesMatch = userPrompt.match(/Lines to translate:\s*(\{[\s\S]*?\})/i)
    const returnedObj: Record<string, string> = {}
    if (linesMatch) {
      const parsedLines = JSON.parse(linesMatch[1])
      for (const [key, text] of Object.entries(parsedLines)) {
        returnedObj[key] = `Recovered ${text}`
      }
    }

    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(returnedObj) } }] }),
      { status: 200 },
    )
  }) as typeof fetch

  try {
    const lines: LyricLine[] = [
      { timeMs: 1000, text: 'First line' },
      { timeMs: 2000, text: 'Second line' },
    ]

    const result = await client.translateLyrics(lines, {
      provider: 'openrouter',
      openRouterKey: 'test-key',
      translationChunkSize: 20,
      maxChunkRetries: 2,
    })

    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].translatedText, 'Recovered First line')
    assert.strictEqual(result[1].translatedText, 'Recovered Second line')

    const metrics = getTranslationMetrics()
    assert.strictEqual(metrics.chunkRetries, 1)
    assert.strictEqual(metrics.chunkFailures, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('AI Translation Chunking: documentation artifact exists [FEATURE-056]', () => {
  const docPath = 'docs/ai-translation-chunking.md'
  assert.strictEqual(fs.existsSync(docPath), true, 'ai-translation-chunking.md must exist')
})
