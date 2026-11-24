import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { userPreferencesSchema } from '../src/services/settings/settingsTypes.ts'
import { useEchoStore } from '../src/stores/useEchoStore.ts'
import { extensionManager } from '../src/services/extensions/extensionManager.ts'

describe('Extension-First Playback [FEATURE-002]', () => {
  beforeEach(() => {
    useEchoStore.getState().resetPreferences()
    extensionManager.resetTelemetry()
  })

  it('validates extensionSourcePriority preference schema', () => {
    const prefs = userPreferencesSchema.parse({
      extensionSourcePriority: 'extension-first',
      preferExtensionAudio: true,
    })
    assert.equal(prefs.extensionSourcePriority, 'extension-first')
    assert.equal(prefs.preferExtensionAudio, true)

    const ytFirst = userPreferencesSchema.parse({
      extensionSourcePriority: 'youtube-first',
      preferExtensionAudio: false,
    })
    assert.equal(ytFirst.extensionSourcePriority, 'youtube-first')
    assert.equal(ytFirst.preferExtensionAudio, false)

    assert.throws(() =>
      userPreferencesSchema.parse({ extensionSourcePriority: 'invalid-priority' }),
    )
  })

  it('updates preference in store cleanly', () => {
    const store = useEchoStore.getState()
    assert.equal(store.preferences.extensionSourcePriority, 'extension-first')

    store.setPreference('extensionSourcePriority', 'youtube-first')
    assert.equal(
      useEchoStore.getState().preferences.extensionSourcePriority,
      'youtube-first',
    )

    store.setPreference('extensionSourcePriority', 'extension-first')
    assert.equal(
      useEchoStore.getState().preferences.extensionSourcePriority,
      'extension-first',
    )
  })

  it('tracks resolution attempts and telemetry in ExtensionManager', async () => {
    const dummyTrack = {
      id: 'test-track-1',
      title: 'Bohemian Rhapsody',
      artistName: 'Queen',
      durationMs: 354000,
      albumTitle: 'A Night at the Opera',
    }

    // With no enabled addons, resolution should return null without errors
    const stream = await extensionManager.resolveTrackExtension(dummyTrack as any)
    assert.equal(stream, null)

    const telemetry = extensionManager.getTelemetry()
    assert.equal(telemetry.totalAttempts, 0)
    assert.equal(telemetry.matchesFound, 0)
    assert.equal(telemetry.fallbackCount, 0)
  })
})
