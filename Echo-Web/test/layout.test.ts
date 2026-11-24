import test from 'node:test'
import assert from 'node:assert'

import {
  sidebarStateSchema,
  layoutPreferencesSchema,
  navLinkItemSchema,
  layoutMetricsSchema,
  getLayoutMetrics,
  resetLayoutMetrics,
  recordLayoutMetric,
} from '../src/components/layout/layoutTypes.ts'

test('Layout: sidebarStateSchema validates state and rejects out-of-range width [SMALL-42]', () => {
  assert.strictEqual(sidebarStateSchema.safeParse({ collapsed: true }).success, true)
  assert.strictEqual(
    sidebarStateSchema.safeParse({ collapsed: false, customWidth: 260 }).success,
    true,
  )

  // Invalid customWidth (too small or too large)
  assert.strictEqual(
    sidebarStateSchema.safeParse({ collapsed: false, customWidth: 50 }).success,
    false,
  )
  assert.strictEqual(
    sidebarStateSchema.safeParse({ collapsed: false, customWidth: 1000 }).success,
    false,
  )
})

test('Layout: layoutPreferencesSchema validates preferences with defaults [SMALL-42]', () => {
  const parsed = layoutPreferencesSchema.parse({})
  assert.strictEqual(parsed.sidebarCollapsed, false)
  assert.strictEqual(parsed.compactMode, false)
  assert.strictEqual(parsed.showVisualizer, false)

  const custom = layoutPreferencesSchema.parse({
    sidebarCollapsed: true,
    compactMode: true,
    showVisualizer: true,
  })
  assert.strictEqual(custom.sidebarCollapsed, true)
  assert.strictEqual(custom.compactMode, true)
})

test('Layout: navLinkItemSchema validates navigation items [SMALL-42]', () => {
  assert.strictEqual(
    navLinkItemSchema.safeParse({
      to: '/podcasts',
      label: 'Podcasts',
      end: true,
      badge: 3,
    }).success,
    true,
  )

  // Empty link or label
  assert.strictEqual(navLinkItemSchema.safeParse({ to: '', label: '' }).success, false)
  // Negative badge
  assert.strictEqual(
    navLinkItemSchema.safeParse({ to: '/liked', label: 'Liked', badge: -1 }).success,
    false,
  )
})

test('Layout: telemetry metrics record interactions and reset cleanly [SMALL-42]', () => {
  resetLayoutMetrics()
  const initial = getLayoutMetrics()
  assert.strictEqual(initial.sidebarToggles, 0)
  assert.strictEqual(initial.historyBackNavigations, 0)

  recordLayoutMetric('sidebarToggles')
  recordLayoutMetric('historyBackNavigations')
  recordLayoutMetric('historyForwardNavigations')
  recordLayoutMetric('shortcutsModalOpens')

  const updated = getLayoutMetrics()
  assert.strictEqual(updated.sidebarToggles, 1)
  assert.strictEqual(updated.historyBackNavigations, 1)
  assert.strictEqual(updated.historyForwardNavigations, 1)
  assert.strictEqual(updated.shortcutsModalOpens, 1)
  assert.strictEqual(layoutMetricsSchema.safeParse(updated).success, true)

  resetLayoutMetrics()
  assert.strictEqual(getLayoutMetrics().sidebarToggles, 0)
})
