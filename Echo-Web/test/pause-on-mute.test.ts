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
    crossOrigin = null
    buffered = { length: 0, start: () => 0, end: () => 0 }
    private listeners = new Map<string, Set<() => void>>()
    play() {
      this.paused = false
      return Promise.resolve()
    }
    pause() {
      this.paused = true
    }
    load() {}
    addEventListener(event: string, cb: () => void) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set())
      this.listeners.get(event)!.add(cb)
    }
    removeEventListener(event: string, cb: () => void) {
      this.listeners.get(event)?.delete(cb)
    }
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
      const param = { setValueAtTime: () => {}, setTargetAtTime: () => {}, cancelScheduledValues: () => {} }
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

import { AudioEngine } from '../src/engine/AudioEngine.ts'
import { userPreferencesSchema } from '../src/services/settings/settingsTypes.ts'

test('Pause on mute: userPreferencesSchema validation and defaults', () => {
  const parsedDefault = userPreferencesSchema.parse({})
  assert.equal(parsedDefault.pauseOnMute, false, 'Default pauseOnMute should be false')

  const parsedActive = userPreferencesSchema.parse({ pauseOnMute: true })
  assert.equal(parsedActive.pauseOnMute, true, 'Explicit pauseOnMute should parse as true')
})

test('Pause on mute: AudioEngine preference toggle and metrics tracking', () => {
  const engine = AudioEngine.getInstance()
  assert.equal(typeof engine.getPauseOnMute(), 'boolean')

  engine.setPauseOnMute(false)
  assert.equal(engine.getPauseOnMute(), false)

  engine.setPauseOnMute(true)
  assert.equal(engine.getPauseOnMute(), true)

  const initialMetrics = engine.getMetrics()
  assert.equal(typeof initialMetrics.pauseOnMuteCount, 'number')

  // When paused, muting or setting volume to 0 should not increment metrics
  engine.setMuted(true)
  engine.setVolume(0)
  assert.equal(engine.getMetrics().pauseOnMuteCount, initialMetrics.pauseOnMuteCount)

  // Reset to unmuted and restored volume
  engine.setMuted(false)
  engine.setVolume(0.8)
  assert.equal(engine.getState().muted, false)
  assert.equal(engine.getState().volume, 0.8)
})
