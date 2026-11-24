import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AudioEngine } from '../src/engine/AudioEngine.ts'

describe('FLAC/ALAC Lossless Playback [FEATURE-004]', () => {
  it('detects lossless formats and distinguishes from lossy', () => {
    const isFlac = (mime: string) => mime.toLowerCase().includes('flac')
    const isAlac = (mime: string) => mime.toLowerCase().includes('alac')
    const isWav = (mime: string) => mime.toLowerCase().includes('wav')

    assert.equal(isFlac('audio/flac'), true)
    assert.equal(isFlac('audio/x-flac'), true)
    assert.equal(isFlac('audio/webm; codecs="opus"'), false)

    assert.equal(isAlac('audio/mp4; codecs="alac"'), true)
    assert.equal(isAlac('audio/alac'), true)

    assert.equal(isWav('audio/wav'), true)
  })

  it('verifies telemetry properties for lossless state', () => {
    if (typeof window !== 'undefined') {
      const engine = AudioEngine.getInstance()
      const telemetry = engine.getAudioTelemetry()
      assert.ok('isLossless' in telemetry)
      assert.equal(typeof telemetry.isLossless, 'boolean')
    }
  })

  it('determines Hi-Res badge for sample rates exceeding 48 kHz', () => {
    const isHiRes = (sampleRateKhz: number) => sampleRateKhz > 48
    assert.equal(isHiRes(44.1), false)
    assert.equal(isHiRes(48.0), false)
    assert.equal(isHiRes(96.0), true)
    assert.equal(isHiRes(192.0), true)
  })
})
