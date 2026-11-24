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
import { echoBrainService } from '../src/services/recommendations/echoBrainService.ts'
import { echoBrainTelemetrySchema } from '../src/services/recommendations/echoBrainTypes.ts'
import { userPreferencesSchema } from '../src/services/settings/settingsTypes.ts'
import { useEchoStore } from '../src/stores/useEchoStore.ts'
import type { Track } from '../src/types/audio.ts'

test('Echo Brain auto-injection: user preference schema validation', () => {
  const defaultPrefs = userPreferencesSchema.parse({})
  assert.equal(defaultPrefs.echoBrainAutoInject, true, 'Default echoBrainAutoInject should be true')

  const parsedFalse = userPreferencesSchema.parse({ echoBrainAutoInject: false })
  assert.equal(parsedFalse.echoBrainAutoInject, false)
})

test('Echo Brain auto-injection: telemetry schema validation', () => {
  const telemetry = echoBrainService.getTelemetry()
  const validated = echoBrainTelemetrySchema.parse(telemetry)
  assert.equal(typeof validated.autoInjectionsCount, 'number')
  assert.equal(typeof validated.autoInjectedTracksCount, 'number')
})

test('Echo Brain auto-injection: preserves upNext manually queued tracks strictly', async () => {
  const engine = AudioEngine.getInstance()
  echoBrainService.resetTelemetry()

  useEchoStore.getState().setPreference('echoBrainEnabled', true)
  useEchoStore.getState().setPreference('echoBrainAutoInject', true)

  const manualUserTrack1: Track = { id: 'manual-1', title: 'User Queued Song 1', artistName: 'Artist' }
  const manualUserTrack2: Track = { id: 'manual-2', title: 'User Queued Song 2', artistName: 'Artist' }

  // 1. User manually queues two tracks
  engine.addToQueue(manualUserTrack1)
  engine.addToQueue(manualUserTrack2)

  assert.equal(engine.getState().upNext.length, 2)
  assert.equal(engine.getState().upNext[0]?.id, 'manual-1')
  assert.equal(engine.getState().upNext[1]?.id, 'manual-2')

  // 2. Candidate pool for auto-injection
  const candidates: Track[] = [
    { id: 'momentum-1', title: 'Momentum Track 1', artistName: 'Artist' },
    { id: 'momentum-2', title: 'Momentum Track 2', artistName: 'Artist' },
    { id: 'momentum-3', title: 'Momentum Track 3', artistName: 'Artist' },
  ]

  // 3. Trigger auto-injection
  const injected = await engine.triggerAutoInjectionIfEligible(candidates)
  assert.equal(injected, true, 'Auto-injection should succeed when radioQueue is empty')

  // 4. Verify upNext was NEVER touched or overwritten
  const upNextAfter = engine.getState().upNext
  assert.equal(upNextAfter.length, 2, 'upNext length must remain unchanged')
  assert.equal(upNextAfter[0]?.id, 'manual-1', 'First upNext track must be preserved')
  assert.equal(upNextAfter[1]?.id, 'manual-2', 'Second upNext track must be preserved')

  // 5. Verify tracks were added to radioQueue
  const radioAfter = engine.getState().radioQueue
  assert.equal(radioAfter.length > 0, true, 'Radio queue should contain injected momentum tracks')
  assert.equal(radioAfter.some((t) => t.id === 'momentum-1'), true)

  // 6. Verify telemetry recorded injection
  const tel = echoBrainService.getTelemetry()
  assert.equal(tel.autoInjectionsCount >= 1, true)
  assert.equal(tel.autoInjectedTracksCount >= 1, true)

  // Clean up
  engine.clearQueue()
})
