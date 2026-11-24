import test from 'node:test'
import assert from 'node:assert'

import {
  desktopPlayerPropsSchema,
  playbackRateSchema,
  desktopPlayerMetricsSchema,
  getDesktopPlayerMetrics,
  resetDesktopPlayerMetrics,
  recordDesktopPlayerMetric,
} from '../src/components/player/desktopPlayerTypes.ts'

test('DesktopPlayer: props schema validates inputs [SMALL-43]', () => {
  const valid = desktopPlayerPropsSchema.safeParse({ isOpen: true, initialTab: 'lyrics' })
  assert.strictEqual(valid.success, true)

  const defaultTab = desktopPlayerPropsSchema.parse({ isOpen: false })
  assert.strictEqual(defaultTab.initialTab, 'player')

  // Invalid initial tab
  assert.strictEqual(
    desktopPlayerPropsSchema.safeParse({ isOpen: true, initialTab: 'invalid' }).success,
    false,
  )
})

test('DesktopPlayer: playbackRateSchema validates standard speeds [SMALL-43]', () => {
  assert.strictEqual(playbackRateSchema.safeParse(1.0).success, true)
  assert.strictEqual(playbackRateSchema.safeParse(1.25).success, true)
  assert.strictEqual(playbackRateSchema.safeParse(1.5).success, true)
  assert.strictEqual(playbackRateSchema.safeParse(0.75).success, true)

  // Disallowed or arbitrary speeds
  assert.strictEqual(playbackRateSchema.safeParse(0.1).success, false)
  assert.strictEqual(playbackRateSchema.safeParse(99.0).success, false)
})

test('DesktopPlayer: telemetry metrics record interactions and reset cleanly [SMALL-43]', () => {
  resetDesktopPlayerMetrics()
  const initial = getDesktopPlayerMetrics()
  assert.strictEqual(initial.opens, 0)
  assert.strictEqual(initial.fullscreenToggles, 0)

  recordDesktopPlayerMetric('opens')
  recordDesktopPlayerMetric('fullscreenToggles')
  recordDesktopPlayerMetric('speedChanges')
  recordDesktopPlayerMetric('keyboardShortcutsTriggered')

  const updated = getDesktopPlayerMetrics()
  assert.strictEqual(updated.opens, 1)
  assert.strictEqual(updated.fullscreenToggles, 1)
  assert.strictEqual(updated.speedChanges, 1)
  assert.strictEqual(updated.keyboardShortcutsTriggered, 1)
  assert.strictEqual(desktopPlayerMetricsSchema.safeParse(updated).success, true)

  resetDesktopPlayerMetrics()
  assert.strictEqual(getDesktopPlayerMetrics().opens, 0)
})
