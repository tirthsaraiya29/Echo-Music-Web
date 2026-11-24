import test from 'node:test'
import assert from 'node:assert'

import {
  userPreferencesSchema,
  validatePreferenceUpdate,
  sanitizeUserPreferences,
  settingsMetricsSchema,
  getSettingsMetrics,
  resetSettingsMetrics,
  recordSettingsMetric,
} from '../src/services/settings/settingsTypes.ts'

import { useEchoStore } from '../src/stores/useEchoStore.ts'

test('Settings: userPreferencesSchema parses valid configuration and applies defaults [SMALL-44]', () => {
  const defaults = userPreferencesSchema.parse({})
  assert.strictEqual(defaults.themeMode, 'dark')
  assert.strictEqual(defaults.accentColor, 'violet')
  assert.strictEqual(defaults.volume, 68)
  assert.strictEqual(defaults.audioQuality, 'high')
  assert.strictEqual(defaults.crossfadeDuration, 3)

  const custom = userPreferencesSchema.parse({
    themeMode: 'oled',
    accentColor: 'emerald',
    volume: 85,
    audioQuality: 'lossless',
    crossfadeDuration: 5,
  })
  assert.strictEqual(custom.themeMode, 'oled')
  assert.strictEqual(custom.accentColor, 'emerald')
  assert.strictEqual(custom.volume, 85)
  assert.strictEqual(custom.audioQuality, 'lossless')
})

test('Settings: userPreferencesSchema rejects invalid enum values and out-of-bounds numbers [SMALL-44]', () => {
  assert.strictEqual(userPreferencesSchema.safeParse({ volume: -5 }).success, false)
  assert.strictEqual(userPreferencesSchema.safeParse({ volume: 150 }).success, false)
  assert.strictEqual(userPreferencesSchema.safeParse({ themeMode: 'neon-pink' }).success, false)
  assert.strictEqual(userPreferencesSchema.safeParse({ audioQuality: 'ultra-hd' }).success, false)
  assert.strictEqual(userPreferencesSchema.safeParse({ crossfadeDuration: 30 }).success, false)
})

test('Settings: validatePreferenceUpdate validates key-value pairs before side effects [SMALL-44]', () => {
  assert.strictEqual(validatePreferenceUpdate('volume', 50), true)
  assert.strictEqual(validatePreferenceUpdate('volume', 200), false)
  assert.strictEqual(validatePreferenceUpdate('volume', 'high'), false)

  assert.strictEqual(validatePreferenceUpdate('accentColor', 'amber'), true)
  assert.strictEqual(validatePreferenceUpdate('accentColor', 'magenta'), false)

  assert.strictEqual(validatePreferenceUpdate('audioQuality', 'lossless'), true)
  assert.strictEqual(validatePreferenceUpdate('audioQuality', '320kbps'), false)
})

test('Settings: sanitizeUserPreferences repairs corrupted payloads to safe defaults [SMALL-44]', () => {
  const corrupted = {
    themeMode: 'corrupted',
    volume: -999,
    accentColor: 'invalid',
  }
  const sanitized = sanitizeUserPreferences(corrupted)
  assert.strictEqual(sanitized.themeMode, 'dark')
  assert.strictEqual(sanitized.volume, 68)
  assert.strictEqual(sanitized.accentColor, 'violet')
})

test('Settings: telemetry metrics track updates and resets [SMALL-44]', () => {
  resetSettingsMetrics()
  const initial = getSettingsMetrics()
  assert.strictEqual(initial.preferenceUpdates, 0)
  assert.strictEqual(initial.preferenceValidationFailures, 0)

  recordSettingsMetric('preferenceUpdates')
  recordSettingsMetric('preferenceValidationFailures')
  recordSettingsMetric('preferencesResetToDefault')

  const updated = getSettingsMetrics()
  assert.strictEqual(updated.preferenceUpdates, 1)
  assert.strictEqual(updated.preferenceValidationFailures, 1)
  assert.strictEqual(updated.preferencesResetToDefault, 1)
  assert.strictEqual(settingsMetricsSchema.safeParse(updated).success, true)

  resetSettingsMetrics()
  assert.strictEqual(getSettingsMetrics().preferenceUpdates, 0)
})

test('Settings: store setPreference rejects invalid updates and resetPreferences resets state [SMALL-44]', () => {
  resetSettingsMetrics()
  const store = useEchoStore.getState()

  // Valid update
  store.setPreference('volume', 42)
  assert.strictEqual(useEchoStore.getState().preferences.volume, 42)

  // Invalid update is rejected
  store.setPreference('volume', 9999 as unknown as number)
  assert.strictEqual(useEchoStore.getState().preferences.volume, 42)
  assert.strictEqual(getSettingsMetrics().preferenceValidationFailures, 1)

  // Atomic reset
  store.resetPreferences()
  assert.strictEqual(useEchoStore.getState().preferences.volume, 68)
  assert.strictEqual(getSettingsMetrics().preferencesResetToDefault, 1)
})
