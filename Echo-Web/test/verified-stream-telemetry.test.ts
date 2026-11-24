import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { verifiedStreamTelemetrySchema } from '../src/types/audio.ts'
import { AudioEngine } from '../src/engine/AudioEngine.ts'

describe('Verified Stream Telemetry [FEATURE-010]', () => {
  it('validates verifiedStreamTelemetrySchema for standard Opus stream', () => {
    const telemetry = verifiedStreamTelemetrySchema.parse({
      codec: 'Opus',
      bitrate: '~154 kbps',
      numericBitrate: 154000,
      sampleRate: '48.0 kHz',
      sourceSampleRate: '48.0 kHz',
      outputSampleRate: '48.0 kHz',
      bitDepth: '16-bit Equivalent',
      dspBitDepth: '32-bit Float DSP',
      channels: 2,
      source: 'YouTube Innertube Stream',
      isLossless: false,
      isHighBitrate: false,
      container: 'WebM',
      verified: true,
    })

    assert.equal(telemetry.codec, 'Opus')
    assert.equal(telemetry.container, 'WebM')
    assert.equal(telemetry.numericBitrate, 154000)
    assert.equal(telemetry.verified, true)
    assert.equal(telemetry.dspBitDepth, '32-bit Float DSP')
  })

  it('validates verifiedStreamTelemetrySchema for Lossless FLAC stream', () => {
    const telemetry = verifiedStreamTelemetrySchema.parse({
      codec: 'FLAC (Lossless)',
      bitrate: 'Lossless',
      sampleRate: '96.0 kHz',
      sourceSampleRate: '96.0 kHz',
      outputSampleRate: '96.0 kHz',
      bitDepth: '24-bit',
      dspBitDepth: '32-bit Float DSP',
      channels: 2,
      source: 'High-Res FLAC Extension',
      isLossless: true,
      isHighBitrate: true,
      container: 'flac',
      verified: true,
    })

    assert.equal(telemetry.codec, 'FLAC (Lossless)')
    assert.equal(telemetry.isLossless, true)
    assert.equal(telemetry.isHighBitrate, true)
    assert.equal(telemetry.bitDepth, '24-bit')
  })

  it('AudioEngine.getAudioTelemetry returns valid schema structure in supported environment', () => {
    if (typeof window !== 'undefined') {
      const engine = AudioEngine.getInstance()
      const telemetry = engine.getAudioTelemetry()
      const parsed = verifiedStreamTelemetrySchema.parse(telemetry)

      assert.ok(parsed.codec.length > 0)
      assert.ok(parsed.source.length > 0)
      assert.ok(parsed.sampleRate.length > 0)
      assert.equal(parsed.dspBitDepth, '32-bit Float DSP')
    }
  })
})
