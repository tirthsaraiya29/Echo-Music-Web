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

import { lyricsAnimationStyleSchema } from '../src/services/settings/settingsTypes.ts'
import {
  lyricsUiMetricsSchema,
  getLyricsUiMetrics,
  resetLyricsUiMetrics,
  recordLyricsUiMetric,
} from '../src/services/lyrics/lyricsUtils.ts'
import { useEchoStore } from '../src/stores/useEchoStore.ts'

test('Lyric Animations: lyricsAnimationStyleSchema validates all 7 presentation styles [FEATURE-054]', () => {
  const validStyles = ['karaoke', 'apple', 'glow', 'slide', 'fade', 'metro', 'none'] as const

  for (const style of validStyles) {
    assert.strictEqual(lyricsAnimationStyleSchema.safeParse(style).success, true)
  }

  // Unknown style rejected
  assert.strictEqual(lyricsAnimationStyleSchema.safeParse('bounce_v2').success, false)
  assert.strictEqual(lyricsAnimationStyleSchema.safeParse('').success, false)
})

test('Lyric Animations: useEchoStore persists and updates presentation style [FEATURE-054]', () => {
  const original = useEchoStore.getState().preferences.lyricsAnimationStyle
  try {
    useEchoStore.getState().setPreference('lyricsAnimationStyle', 'apple')
    assert.strictEqual(useEchoStore.getState().preferences.lyricsAnimationStyle, 'apple')

    useEchoStore.getState().setPreference('lyricsAnimationStyle', 'glow')
    assert.strictEqual(useEchoStore.getState().preferences.lyricsAnimationStyle, 'glow')

    useEchoStore.getState().setPreference('lyricsAnimationStyle', 'metro')
    assert.strictEqual(useEchoStore.getState().preferences.lyricsAnimationStyle, 'metro')
  } finally {
    if (original) {
      useEchoStore.getState().setPreference('lyricsAnimationStyle', original)
    }
  }
})

test('Lyric Animations: Telemetry records animation style switch events [FEATURE-054]', () => {
  resetLyricsUiMetrics()
  const initial = getLyricsUiMetrics()
  assert.strictEqual(initial.animationStyleSwitches, 0)
  assert.strictEqual(lyricsUiMetricsSchema.safeParse(initial).success, true)

  recordLyricsUiMetric('animationStyleSwitches')
  recordLyricsUiMetric('animationStyleSwitches')

  const updated = getLyricsUiMetrics()
  assert.strictEqual(updated.animationStyleSwitches, 2)

  resetLyricsUiMetrics()
  assert.strictEqual(getLyricsUiMetrics().animationStyleSwitches, 0)
})

test('Lyric Animations: Source code embeds style switcher and animation styles [FEATURE-054]', () => {
  const lyricsCode = fs.readFileSync('src/components/player/LyricsView.tsx', 'utf8')
  const settingsCode = fs.readFileSync('src/pages/SettingsPage.tsx', 'utf8')

  // LyricsView must implement all 7 style mappings in getLineAnimationStyleClasses
  assert.ok(lyricsCode.includes("case 'apple':"), 'Must support Apple style')
  assert.ok(lyricsCode.includes("case 'glow':"), 'Must support Glow style')
  assert.ok(lyricsCode.includes("case 'slide':"), 'Must support Slide style')
  assert.ok(lyricsCode.includes("case 'fade':"), 'Must support Fade style')
  assert.ok(lyricsCode.includes("case 'metro':"), 'Must support Metro style')
  assert.ok(lyricsCode.includes("case 'none':"), 'Must support None/Static style')
  assert.ok(lyricsCode.includes("case 'karaoke':"), 'Must support Karaoke style')

  // Header quick style switcher selector
  assert.ok(lyricsCode.includes('aria-label="Lyrics animation style"'), 'Must have stage style switcher')

  // Settings page configuration
  assert.ok(settingsCode.includes('id="lyrics-animation-style"'), 'Must have settings dropdown')
  assert.ok(settingsCode.includes('Apple Style'), 'Must describe Apple Style in settings')
})
