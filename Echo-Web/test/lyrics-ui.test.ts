import test from 'node:test'
import assert from 'node:assert'
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
  syncOffsetPayloadSchema,
  lyricsPlayerUiPropsSchema,
  lyricsUiMetricsSchema,
  getLyricsUiMetrics,
  resetLyricsUiMetrics,
  recordLyricsUiMetric,
  clampSyncOffset,
  findActiveLineIndex,
} from '../src/services/lyrics/lyricsUtils.ts'

test('LyricsView UI: syncOffsetPayloadSchema validates bounds and rejects invalid offsets [SMALL-26]', () => {
  // Valid offset payload
  const valid = {
    trackId: 'track-offset-1',
    offsetMs: 1500,
    updatedAt: Date.now(),
  }
  assert.strictEqual(syncOffsetPayloadSchema.safeParse(valid).success, true)

  // Bounds check: lower limit is -60000ms (-60s)
  const lowerBoundValid = {
    trackId: 'track-lower',
    offsetMs: -60000,
    updatedAt: Date.now(),
  }
  assert.strictEqual(syncOffsetPayloadSchema.safeParse(lowerBoundValid).success, true)

  // Bounds check: upper limit is 60000ms (+60s)
  const upperBoundValid = {
    trackId: 'track-upper',
    offsetMs: 60000,
    updatedAt: Date.now(),
  }
  assert.strictEqual(syncOffsetPayloadSchema.safeParse(upperBoundValid).success, true)

  // Out of bounds: -60001 rejected
  const tooLow = {
    trackId: 'track-too-low',
    offsetMs: -60001,
    updatedAt: Date.now(),
  }
  assert.strictEqual(syncOffsetPayloadSchema.safeParse(tooLow).success, false)

  // Out of bounds: 60001 rejected
  const tooHigh = {
    trackId: 'track-too-high',
    offsetMs: 60001,
    updatedAt: Date.now(),
  }
  assert.strictEqual(syncOffsetPayloadSchema.safeParse(tooHigh).success, false)

  // Empty trackId rejected
  const emptyTrackId = {
    trackId: '',
    offsetMs: 500,
    updatedAt: Date.now(),
  }
  assert.strictEqual(syncOffsetPayloadSchema.safeParse(emptyTrackId).success, false)
})

test('LyricsView UI: lyricsPlayerUiPropsSchema validates component input properties [SMALL-26]', () => {
  const validProps = {
    track: {
      id: 't-123',
      title: 'Valid Song',
      artistName: 'Valid Artist',
    },
    isPlaying: true,
    className: 'custom-lyrics-class',
  }
  assert.strictEqual(lyricsPlayerUiPropsSchema.safeParse(validProps).success, true)

  // Null track is accepted (idle / no track loaded)
  const nullTrackProps = {
    track: null,
    isPlaying: false,
  }
  assert.strictEqual(lyricsPlayerUiPropsSchema.safeParse(nullTrackProps).success, true)

  // Invalid isPlaying type rejected
  const invalidProps = {
    track: null,
    isPlaying: 'yes',
  }
  assert.strictEqual(lyricsPlayerUiPropsSchema.safeParse(invalidProps).success, false)
})

test('LyricsView UI: telemetry metrics record activity and reset correctly [SMALL-26]', () => {
  resetLyricsUiMetrics()
  const initial = getLyricsUiMetrics()

  assert.strictEqual(initial.renders, 0)
  assert.strictEqual(initial.userSeeks, 0)
  assert.strictEqual(initial.syncOffsetAdjustments, 0)
  assert.strictEqual(initial.autoScrolls, 0)
  assert.strictEqual(initial.manualScrollPauses, 0)
  assert.strictEqual(initial.translationsTriggered, 0)
  assert.strictEqual(lyricsUiMetricsSchema.safeParse(initial).success, true)

  recordLyricsUiMetric('userSeeks')
  recordLyricsUiMetric('syncOffsetAdjustments')
  recordLyricsUiMetric('autoScrolls')

  const after = getLyricsUiMetrics()
  assert.strictEqual(after.userSeeks, 1)
  assert.strictEqual(after.syncOffsetAdjustments, 1)
  assert.strictEqual(after.autoScrolls, 1)

  resetLyricsUiMetrics()
  const resetState = getLyricsUiMetrics()
  assert.strictEqual(resetState.userSeeks, 0)
  assert.strictEqual(resetState.syncOffsetAdjustments, 0)
  assert.strictEqual(resetState.autoScrolls, 0)
})

test('LyricsView UI: clampSyncOffset safely bounds arbitrary offset values [SMALL-26]', () => {
  assert.strictEqual(clampSyncOffset(0), 0)
  assert.strictEqual(clampSyncOffset(500), 500)
  assert.strictEqual(clampSyncOffset(-500), -500)
  assert.strictEqual(clampSyncOffset(120000), 60000)
  assert.strictEqual(clampSyncOffset(-100000), -60000)
})

test('LyricsView UI: findActiveLineIndex handles adjusted playback timings with offsets [SMALL-26]', () => {
  const lines = [
    { startTimeMs: 5000, text: 'First phrase' },
    { startTimeMs: 12000, text: 'Second phrase' },
    { startTimeMs: 20000, text: 'Third phrase' },
  ]

  // At 10s playback with 0 offset -> active is index 0
  assert.strictEqual(findActiveLineIndex(lines, 10000), 0)

  // At 10s playback with -3000ms offset (shifted earlier, effective time 13000ms) -> active is index 1
  assert.strictEqual(findActiveLineIndex(lines, 10000 - (-3000)), 1)

  // At 10s playback with +6000ms offset (shifted later, effective time 4000ms) -> active is -1
  assert.strictEqual(findActiveLineIndex(lines, 10000 - 6000), -1)
})

test('LyricsView UI: component source enforces accessibility, reduced motion, and offline states [SMALL-26]', () => {
  const code = fs.readFileSync('src/components/player/LyricsView.tsx', 'utf8')

  // Keyboard navigation & accessibility on lyric lines
  assert.ok(code.includes('role="button"'), 'Lyric line row must have role="button"')
  assert.ok(code.includes('tabIndex={0}'), 'Lyric line row must be keyboard-focusable')
  assert.ok(code.includes('aria-current='), 'Active lyric line must indicate aria-current')
  assert.ok(code.includes("e.key === 'Enter' || e.key === ' '"), 'Lyric line must respond to Enter/Space keys')

  // Prefers-reduced-motion support
  assert.ok(code.includes('prefers-reduced-motion: reduce'), 'Auto-scroller must check prefers-reduced-motion')

  // Offline status handling
  assert.ok(code.includes('isOffline'), 'Component must track offline connectivity status')
  assert.ok(code.includes('WifiOff'), 'Offline state must present wifi indicator')
})
