import test from 'node:test'
import assert from 'node:assert/strict'

if (typeof globalThis.localStorage === 'undefined') {
  const mem = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, val: string) => mem.set(key, String(val)),
    removeItem: (key: string) => mem.delete(key),
    clear: () => mem.clear(),
    key: (i: number) => Array.from(mem.keys())[i] ?? null,
    length: 0,
  } as unknown as Storage
}

if (typeof globalThis.Audio === 'undefined') {
  class MockAudio {
    src = ''
    currentTime = 0
    duration = 180
    volume = 1
    muted = false
    paused = true
    playbackRate = 1
    preservesPitch = true
    mozPreservesPitch = true
    webkitPreservesPitch = true
    crossOrigin = null
    buffered = { length: 0, start: () => 0, end: () => 0 }
    play() { return Promise.resolve() }
    pause() {}
    load() {}
    addEventListener() {}
    removeEventListener() {}
  }
  globalThis.Audio = MockAudio as unknown as typeof Audio
}

if (typeof globalThis.window === 'undefined') {
  class MockAudioNode {
    gain = {
      value: 1,
      setValueAtTime: () => {},
      cancelScheduledValues: () => {},
      linearRampToValueAtTime: () => {},
      setValueCurveAtTime: () => {},
      setTargetAtTime: () => {},
    }
    connect() { return this }
    disconnect() {}
  }

  class MockAudioContext {
    currentTime = 0
    sampleRate = 44100
    state = 'running'
    destination = new MockAudioNode()
    createGain() { return new MockAudioNode() }
    createDynamicsCompressor() {
      const param = { setValueAtTime: () => {}, setTargetAtTime: () => {} }
      const node = new MockAudioNode()
      return Object.assign(node, {
        threshold: param,
        knee: param,
        ratio: param,
        attack: param,
        release: param,
      })
    }
    createBiquadFilter() {
      const param = { setValueAtTime: () => {}, setTargetAtTime: () => {}, cancelScheduledValues: () => {} }
      return {
        type: 'peaking',
        gain: param,
        frequency: param,
        Q: param,
        connect() { return this },
        disconnect() {},
      }
    }
    createAnalyser() {
      return {
        fftSize: 2048,
        frequencyBinCount: 1024,
        getByteFrequencyData: () => {},
        getByteTimeDomainData: () => {},
        connect() { return this },
        disconnect() {},
      }
    }
    createChannelSplitter() { return { connect() { return this }, disconnect() {} } }
    createChannelMerger() { return { connect() { return this }, disconnect() {} } }
    createMediaElementSource() { return new MockAudioNode() }
    resume() { return Promise.resolve() }
    close() { return Promise.resolve() }
  }

  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext
  if (typeof (globalThis as unknown as { addEventListener?: unknown }).addEventListener === 'undefined') {
    ;(globalThis as unknown as { addEventListener: unknown }).addEventListener = () => {}
    ;(globalThis as unknown as { removeEventListener: unknown }).removeEventListener = () => {}
  }
}

import { DeckController } from '../src/engine/DeckController.ts'
import { WebAudioGraph } from '../src/engine/WebAudioGraph.ts'
import { userPreferencesSchema } from '../src/services/settings/settingsTypes.ts'

test('Varispeed mode default state and configuration', () => {
  const prefs = userPreferencesSchema.parse({})
  assert.equal(prefs.varispeedEnabled, false, 'Default user preferences should have varispeedEnabled = false')

  const parsedWithVarispeed = userPreferencesSchema.parse({ varispeedEnabled: true })
  assert.equal(parsedWithVarispeed.varispeedEnabled, true, 'Parsing preference should accept varispeedEnabled = true')
})

test('DeckController varispeed state and pitch shift calculation', () => {
  const graph = new WebAudioGraph()
  const deck = new DeckController(graph, { varispeedEnabled: false })

  assert.equal(deck.getVarispeed(), false)
  assert.equal(deck.getPitchShiftSemitones(), 0, 'When disabled, pitch shift should be 0')

  deck.setVarispeed(true)
  assert.equal(deck.getVarispeed(), true)

  // Test at 1.0x (no shift)
  deck.setPlaybackRate(1.0)
  assert.equal(deck.getPitchShiftSemitones(), 0)

  // Test at 2.0x (1 octave up = +12 semitones)
  deck.setPlaybackRate(2.0)
  assert.equal(deck.getPitchShiftSemitones(), 12.0)

  // Test at 0.5x (1 octave down = -12 semitones)
  deck.setPlaybackRate(0.5)
  assert.equal(deck.getPitchShiftSemitones(), -12.0)

  // Test at 1.5x (perfect fifth up ≈ +7.0 semitones: 12 * log2(1.5) = 7.01955...)
  deck.setPlaybackRate(1.5)
  assert.equal(deck.getPitchShiftSemitones(), 7.0)

  // Test at 1.25x (≈ +3.9 semitones: 12 * log2(1.25) = 3.863...)
  deck.setPlaybackRate(1.25)
  assert.equal(deck.getPitchShiftSemitones(), 3.9)

  // Test when disabled again
  deck.setVarispeed(false)
  assert.equal(deck.getVarispeed(), false)
  assert.equal(deck.getPitchShiftSemitones(), 0, 'Disabling varispeed returns 0 semitones shift')

  deck.destroy()
  graph.destroy()
})
