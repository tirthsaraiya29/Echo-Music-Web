import test from 'node:test'
import assert from 'node:assert'

import {
  themeModeSchema,
  accentColorSchema,
  ACCENTS,
  getAccentDefinition,
  themeMetricsSchema,
  getThemeMetrics,
  resetThemeMetrics,
  recordThemeMetric,
} from '../src/services/theme/themeTypes.ts'

import { ThemeManager, themeManager } from '../src/services/theme/themeManager.ts'

test('Theme: schemas validate valid modes and accents [SMALL-46]', () => {
  assert.strictEqual(themeModeSchema.safeParse('dark').success, true)
  assert.strictEqual(themeModeSchema.safeParse('light').success, true)
  assert.strictEqual(themeModeSchema.safeParse('system').success, true)
  assert.strictEqual(themeModeSchema.safeParse('neon').success, false)

  assert.strictEqual(accentColorSchema.safeParse('violet').success, true)
  assert.strictEqual(accentColorSchema.safeParse('emerald').success, true)
  assert.strictEqual(accentColorSchema.safeParse('amber').success, true)
  assert.strictEqual(accentColorSchema.safeParse('rose').success, true)
  assert.strictEqual(accentColorSchema.safeParse('sky').success, true)
  assert.strictEqual(accentColorSchema.safeParse('red').success, false)
})

test('Theme: getAccentDefinition returns definition and updates tokenResolutions metric [SMALL-46]', () => {
  resetThemeMetrics()
  const def = getAccentDefinition('emerald')
  assert.strictEqual(def.color, '#58ad83')
  assert.strictEqual(getThemeMetrics().tokenResolutions, 1)

  // Fallback on invalid accent
  const fallback = getAccentDefinition('invalid' as unknown as 'violet')
  assert.strictEqual(fallback.value, 'violet')
})

test('Theme: ThemeManager resolves themes and applies datasets safely [SMALL-46]', () => {
  resetThemeMetrics()
  const mgr = ThemeManager.getInstance()
  assert.strictEqual(mgr, themeManager)

  assert.strictEqual(mgr.resolveTheme('dark'), 'dark')
  assert.strictEqual(mgr.resolveTheme('light'), 'light')
  // In Node environment without window matchMedia, system defaults to dark
  assert.strictEqual(mgr.resolveTheme('system'), 'dark')

  // Mock DOM element for applyTheme and applyAccent
  const mockElement = { dataset: {} as Record<string, string> } as unknown as HTMLElement
  const applied = mgr.applyTheme('dark', mockElement)
  assert.strictEqual(applied, 'dark')
  assert.strictEqual(mockElement.dataset['theme'], 'dark')

  const accentApplied = mgr.applyAccent('rose', mockElement)
  assert.strictEqual(accentApplied, 'rose')
  assert.strictEqual(mockElement.dataset['accent'], 'rose')

  const metrics = getThemeMetrics()
  assert.strictEqual(metrics.themeChanges, 1)
  assert.strictEqual(metrics.accentChanges, 1)
  assert.strictEqual(themeMetricsSchema.safeParse(metrics).success, true)
})
