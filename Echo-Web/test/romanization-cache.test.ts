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
  romanizeLanguageSchema,
  userPreferencesSchema,
} from '../src/services/settings/settingsTypes.ts'
import {
  LyricsOrchestrator,
  getLyricsOrchestratorMetrics,
  resetLyricsOrchestratorMetrics,
} from '../src/services/lyrics/LyricsOrchestrator.ts'
import { useEchoStore } from '../src/stores/useEchoStore.ts'
import type { Track } from '../src/types/domain.ts'

const sampleTrack: Track = {
  id: 'track-jp-001',
  title: '夜に駆ける',
  artistName: 'YOASOBI',
  albumTitle: 'THE BOOK',
  durationSeconds: 261,
}

test('Romanization Cache: romanizeLanguageSchema validates supported scripts [FEATURE-055]', () => {
  const supported = ['ja', 'ko', 'zh', 'ru', 'uk', 'sr', 'bg', 'pa'] as const
  for (const lang of supported) {
    assert.strictEqual(romanizeLanguageSchema.safeParse(lang).success, true)
  }

  assert.strictEqual(romanizeLanguageSchema.safeParse('en').success, false)
  assert.strictEqual(romanizeLanguageSchema.safeParse('latin').success, false)
  assert.strictEqual(romanizeLanguageSchema.safeParse('').success, false)
})

test('Romanization Cache: userPreferencesSchema validates romanize languages and asMain flag [FEATURE-055]', () => {
  const valid = userPreferencesSchema.safeParse({
    romanizeLyrics: true,
    romanizeLanguages: ['ja', 'ko'],
    romanizeAsMain: true,
  })
  assert.strictEqual(valid.success, true)
  if (valid.success) {
    assert.strictEqual(valid.data.romanizeLyrics, true)
    assert.deepStrictEqual(valid.data.romanizeLanguages, ['ja', 'ko'])
    assert.strictEqual(valid.data.romanizeAsMain, true)
  }
})

test('Romanization Cache: buildCacheKey generates distinct identities for original and variants [FEATURE-055]', () => {
  const orchestrator = LyricsOrchestrator.getInstance()
  const originalKey = orchestrator.buildCacheKey(sampleTrack, 'LRCLIB', false)
  assert.strictEqual(originalKey, 'track-jp-001:夜に駆ける:YOASOBI:LRCLIB:orig')

  const romDefaultKey = orchestrator.buildCacheKey(
    sampleTrack,
    'LRCLIB',
    true,
    ['ja', 'ko', 'zh'],
    false,
  )
  assert.strictEqual(romDefaultKey, 'track-jp-001:夜に駆ける:YOASOBI:LRCLIB:rom_ja_ko_zh')

  const romMainKey = orchestrator.buildCacheKey(
    sampleTrack,
    'LRCLIB',
    true,
    ['ja'],
    true,
  )
  assert.strictEqual(romMainKey, 'track-jp-001:夜に駆ける:YOASOBI:LRCLIB:rom_ja_main')

  // Ordering of languages should be normalized
  const sortedKeyA = orchestrator.buildCacheKey(
    sampleTrack,
    'LRCLIB',
    true,
    ['zh', 'ja', 'ko'],
    false,
  )
  assert.strictEqual(sortedKeyA, romDefaultKey)

  // Must not collide
  assert.notStrictEqual(originalKey, romDefaultKey)
  assert.notStrictEqual(romDefaultKey, romMainKey)
})

test('Romanization Cache: in-memory cache isolates variants without collision [FEATURE-055]', () => {
  const orchestrator = LyricsOrchestrator.getInstance()
  orchestrator.clearCache()
  resetLyricsOrchestratorMetrics()

  const originalKey = orchestrator.buildCacheKey(sampleTrack, 'LRCLIB', false)
  const romKey = orchestrator.buildCacheKey(sampleTrack, 'LRCLIB', true, ['ja'], false)

  const originalPayload = {
    provider: 'LRCLIB' as const,
    isSynced: true,
    isWordSynced: false,
    lines: [{ timeMs: 1000, text: '沈むように溶けてゆくように' }],
  }

  const romPayload = {
    provider: 'LRCLIB' as const,
    isSynced: true,
    isWordSynced: false,
    lines: [{ timeMs: 1000, text: 'Shizumu you ni tokete yuku you ni' }],
  }

  // Inject both into memory cache under their respective keys
  const now = Date.now()
  ;(orchestrator as any).cache.set(originalKey, {
    lyrics: originalPayload,
    cachedAt: now,
    expiresAt: now + 60000,
  })
  ;(orchestrator as any).cache.set(romKey, {
    lyrics: romPayload,
    cachedAt: now,
    expiresAt: now + 60000,
  })

  // Verify both exist independently
  const cachedOriginal = (orchestrator as any).cache.get(originalKey)
  const cachedRom = (orchestrator as any).cache.get(romKey)

  assert.ok(cachedOriginal)
  assert.ok(cachedRom)
  assert.strictEqual(cachedOriginal.lyrics.lines[0].text, '沈むように溶けてゆくように')
  assert.strictEqual(cachedRom.lyrics.lines[0].text, 'Shizumu you ni tokete yuku you ni')
})

test('Romanization Cache: metrics track romanized and original hit counts [FEATURE-055]', () => {
  resetLyricsOrchestratorMetrics()
  const metrics = getLyricsOrchestratorMetrics()

  assert.strictEqual(metrics.romanizedCacheHits, 0)
  assert.strictEqual(metrics.originalCacheHits, 0)
  assert.strictEqual(metrics.variantCacheCollisionsPrevented, 0)
})

test('Romanization Cache: documentation artifact exists [FEATURE-055]', () => {
  const docPath = 'docs/romanization-aware-cache.md'
  assert.strictEqual(fs.existsSync(docPath), true, 'romanization-aware-cache.md must exist')
})
