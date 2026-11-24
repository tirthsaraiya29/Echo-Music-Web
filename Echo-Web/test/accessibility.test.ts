import test from 'node:test'
import assert from 'node:assert'

import {
  shortcutDefinitionSchema,
  accessibilityPreferencesSchema,
  keyComboSchema,
  accessibilityMetricsSchema,
  getAccessibilityMetrics,
  resetAccessibilityMetrics,
  recordAccessibilityMetric,
  isReducedMotionPreferred,
} from '../src/services/accessibility/accessibilityTypes.ts'

import { ShortcutManager, shortcutManager } from '../src/services/accessibility/shortcutManager.ts'

test('Accessibility: shortcutDefinitionSchema validates definitions [SMALL-45]', () => {
  const valid = shortcutDefinitionSchema.safeParse({
    id: 'toggle-play',
    keys: ['Space'],
    description: 'Toggle playback',
    category: 'playback',
  })
  assert.strictEqual(valid.success, true)

  // Empty keys array
  assert.strictEqual(
    shortcutDefinitionSchema.safeParse({
      id: 'invalid',
      keys: [],
      description: 'Invalid',
    }).success,
    false,
  )
})

test('Accessibility: accessibilityPreferencesSchema validates preferences [SMALL-45]', () => {
  const defaults = accessibilityPreferencesSchema.parse({})
  assert.strictEqual(defaults.reducedMotion, false)
  assert.strictEqual(defaults.highContrast, false)
  assert.strictEqual(defaults.screenReaderAnnouncements, true)
})

test('Accessibility: keyComboSchema validates combos [SMALL-45]', () => {
  const combo = keyComboSchema.safeParse({
    code: 'KeyK',
    key: 'k',
    ctrlKey: true,
  })
  assert.strictEqual(combo.success, true)
})

test('Accessibility: telemetry metrics track operations and reset [SMALL-45]', () => {
  resetAccessibilityMetrics()
  const initial = getAccessibilityMetrics()
  assert.strictEqual(initial.shortcutsTriggered, 0)
  assert.strictEqual(initial.focusTrapsActivated, 0)

  recordAccessibilityMetric('shortcutsTriggered')
  recordAccessibilityMetric('focusTrapsActivated')
  recordAccessibilityMetric('reducedMotionDetected')

  const updated = getAccessibilityMetrics()
  assert.strictEqual(updated.shortcutsTriggered, 1)
  assert.strictEqual(updated.focusTrapsActivated, 1)
  assert.strictEqual(updated.reducedMotionDetected, 1)
  assert.strictEqual(accessibilityMetricsSchema.safeParse(updated).success, true)

  resetAccessibilityMetrics()
  assert.strictEqual(getAccessibilityMetrics().shortcutsTriggered, 0)
})

test('Accessibility: isReducedMotionPreferred defaults to false in Node [SMALL-45]', () => {
  assert.strictEqual(isReducedMotionPreferred(), false)
})

test('Accessibility: ShortcutManager registers, retrieves, and unregisters shortcuts [SMALL-45]', () => {
  const mgr = ShortcutManager.getInstance()
  assert.strictEqual(mgr, shortcutManager)

  const unregister = mgr.registerShortcut(
    {
      id: 'test-shortcut',
      keys: ['M'],
      description: 'Mute audio',
      category: 'playback',
    },
    () => {},
  )

  const list = mgr.getRegisteredShortcuts()
  assert.strictEqual(list.some((s) => s.id === 'test-shortcut'), true)

  unregister()
  assert.strictEqual(mgr.getRegisteredShortcuts().some((s) => s.id === 'test-shortcut'), false)
})
