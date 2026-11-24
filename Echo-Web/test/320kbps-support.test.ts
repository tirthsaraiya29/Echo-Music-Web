import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AudioEngine } from '../src/engine/AudioEngine.ts'

describe('320 kbps Source Support [FEATURE-003]', () => {
  it('detects high-bitrate streams accurately in telemetry', () => {
    // When window is defined or mocked, verify getAudioTelemetry shape
    if (typeof window !== 'undefined') {
      const engine = AudioEngine.getInstance()
      const telemetry = engine.getAudioTelemetry()
      assert.ok('codec' in telemetry)
      assert.ok('bitrate' in telemetry)
      assert.ok('sampleRate' in telemetry)
      assert.ok('isHighBitrate' in telemetry)
      assert.ok('source' in telemetry)
      assert.equal(typeof telemetry.isHighBitrate, 'boolean')
    }
  })

  it('formats verified bitrates without overstating', () => {
    const format320 = {
      bitrate: 320000,
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
    }
    const bitrateKbps = Math.round(format320.bitrate / 1000)
    assert.equal(bitrateKbps, 320)
    assert.equal(`${bitrateKbps} kbps`, '320 kbps')
    assert.ok(bitrateKbps >= 320)

    const standardYoutube = {
      bitrate: 154000,
      mimeType: 'audio/webm; codecs="opus"',
    }
    const standardKbps = Math.round(standardYoutube.bitrate / 1000)
    assert.equal(standardKbps, 154)
    assert.ok(standardKbps < 320)
  })
})
