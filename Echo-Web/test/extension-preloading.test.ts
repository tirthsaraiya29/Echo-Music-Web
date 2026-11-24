import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { extensionManager } from '../src/services/extensions/extensionManager.ts'

describe('Extension Preloading [FEATURE-007]', () => {
  beforeEach(() => {
    extensionManager.resetTelemetry()
    extensionManager.clearPreloadCache()
  })

  it('handles preload gracefully when no extensions are enabled', async () => {
    const dummy = {
      id: 'preload-dummy-1',
      title: 'Upcoming Song',
      artistName: 'Upcoming Artist',
      durationMs: 240000,
    }

    const preloaded = await extensionManager.preloadExtensionStream(dummy as any)
    assert.equal(preloaded, null)

    const telemetry = extensionManager.getTelemetry()
    assert.equal(typeof telemetry.preloadsTriggered, 'number')
    assert.equal(typeof telemetry.preloadCacheHits, 'number')
    assert.equal(typeof telemetry.inFlightPreloadDeduplicated, 'number')
  })

  it('tracks telemetry counters and resets properly', () => {
    const telemetry = extensionManager.getTelemetry()
    assert.equal(telemetry.preloadsTriggered, 0)
    assert.equal(telemetry.preloadCacheHits, 0)
    assert.equal(telemetry.inFlightPreloadDeduplicated, 0)
  })
})
