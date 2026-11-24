import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  calculateWordProgress,
  getWordProgressState,
  calculateWordSeekTime,
  lyricsUiMetricsSchema,
  getLyricsUiMetrics,
  resetLyricsUiMetrics,
  recordLyricsUiMetric,
} from '../src/services/lyrics/lyricsUtils.ts'
import type { LyricWord } from '../src/types/lyrics.ts'

test('Word-by-Word Timing: calculateWordProgress returns deterministic, clamped progress values [FEATURE-053]', () => {
  const start = 1000
  const end = 2000

  // Before start -> 0
  assert.strictEqual(calculateWordProgress(500, start, end), 0)
  assert.strictEqual(calculateWordProgress(1000, start, end), 0)

  // Midpoint -> 0.5
  assert.strictEqual(calculateWordProgress(1500, start, end), 0.5)

  // Three quarters -> 0.75
  assert.strictEqual(calculateWordProgress(1750, start, end), 0.75)

  // At end -> 1
  assert.strictEqual(calculateWordProgress(2000, start, end), 1)

  // Past end -> 1
  assert.strictEqual(calculateWordProgress(2500, start, end), 1)

  // Zero-duration syllable guard (avoid NaN)
  assert.strictEqual(calculateWordProgress(1000, 1000, 1000), 1)
  assert.strictEqual(calculateWordProgress(900, 1000, 1000), 0)

  // Inverted timestamps guard (end < start)
  assert.strictEqual(calculateWordProgress(1500, 2000, 1000), 0)
})

test('Word-by-Word Timing: getWordProgressState computes accurate active, past, and progress states [FEATURE-053]', () => {
  const word: LyricWord = {
    text: 'Syllable',
    startTimeMs: 3000,
    endTimeMs: 4000,
  }

  // Before word starts
  const before = getWordProgressState(2500, word)
  assert.strictEqual(before.isPast, false)
  assert.strictEqual(before.isCurrent, false)
  assert.strictEqual(before.progress, 0)

  // Active word halfway
  const during = getWordProgressState(3500, word)
  assert.strictEqual(during.isPast, false)
  assert.strictEqual(during.isCurrent, true)
  assert.strictEqual(during.progress, 0.5)

  // After word ends
  const after = getWordProgressState(4500, word)
  assert.strictEqual(after.isPast, true)
  assert.strictEqual(after.isCurrent, false)
  assert.strictEqual(after.progress, 1)
})

test('Word-by-Word Timing: calculateWordSeekTime converts millisecond timestamps and offsets into seconds [FEATURE-053]', () => {
  // 5000ms + 500ms offset = 5.5s
  assert.strictEqual(calculateWordSeekTime(5000, 500), 5.5)

  // 10000ms - 2000ms offset = 8.0s
  assert.strictEqual(calculateWordSeekTime(10000, -2000), 8)

  // Clamp negative seek targets to 0
  assert.strictEqual(calculateWordSeekTime(500, -1000), 0)
})

test('Word-by-Word Timing: Telemetry metrics track word animation ticks and word seeks [FEATURE-053]', () => {
  resetLyricsUiMetrics()
  const initial = getLyricsUiMetrics()
  assert.strictEqual(initial.wordAnimationTicks, 0)
  assert.strictEqual(initial.wordSeeks, 0)
  assert.strictEqual(lyricsUiMetricsSchema.safeParse(initial).success, true)

  recordLyricsUiMetric('wordAnimationTicks')
  recordLyricsUiMetric('wordAnimationTicks')
  recordLyricsUiMetric('wordSeeks')

  const updated = getLyricsUiMetrics()
  assert.strictEqual(updated.wordAnimationTicks, 2)
  assert.strictEqual(updated.wordSeeks, 1)

  resetLyricsUiMetrics()
  const cleared = getLyricsUiMetrics()
  assert.strictEqual(cleared.wordAnimationTicks, 0)
  assert.strictEqual(cleared.wordSeeks, 0)
})

test('Word-by-Word Timing: LyricsView source code embeds interactive word tokens and background harmony styling [FEATURE-053]', () => {
  const code = fs.readFileSync('src/components/player/LyricsView.tsx', 'utf8')

  // Word token click and accessibility
  assert.ok(code.includes('onWordClick'), 'Must support word click callback')
  assert.ok(code.includes('recordLyricsUiMetric(\'wordSeeks\')'), 'Must record wordSeeks metric')
  assert.ok(code.includes('recordLyricsUiMetric(\'wordAnimationTicks\')'), 'Must record animation ticks')

  // Background vocal styling
  assert.ok(code.includes('isBackground'), 'Must handle isBackground flags')
  assert.ok(code.includes('italic text-purple-200/90'), 'Background vocals must have harmonic styling')

  // Static word karaoke rendering
  assert.ok(code.includes('StaticWordKaraokeLine'), 'Must preserve word tokens in inactive lines')
})
