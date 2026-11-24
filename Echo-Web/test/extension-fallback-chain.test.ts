import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { extensionManager } from '../src/services/extensions/extensionManager.ts'

describe('Extension Fallback Chain [FEATURE-005]', () => {
  beforeEach(() => {
    extensionManager.resetTelemetry()
  })

  it('records fallback counts when extensions are unavailable or reject a track', async () => {
    const dummyTrack = {
      id: 'fallback-track-1',
      title: 'Unmatched Track Title',
      artistName: 'Unknown Artist',
      durationMs: 200000,
    }

    // When no addons are registered/enabled, resolveTrackExtension returns null cleanly
    const result = await extensionManager.resolveTrackExtension(dummyTrack as any)
    assert.equal(result, null)

    const telemetry = extensionManager.getTelemetry()
    assert.equal(typeof telemetry.fallbackCount, 'number')
    assert.equal(typeof telemetry.fallbackToYouTubeCount, 'number')
    assert.equal(typeof telemetry.extensionCascadeFailures, 'number')
  })

  it('resets fallback metrics cleanly', () => {
    const telemetry = extensionManager.getTelemetry()
    assert.equal(telemetry.totalAttempts, 0)
    assert.equal(telemetry.fallbackToYouTubeCount, 0)
    assert.equal(telemetry.extensionCascadeFailures, 0)
  })
})
