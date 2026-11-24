import test from 'node:test'
import assert from 'node:assert'

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
      const param = { setValueAtTime: () => {}, setTargetAtTime: () => {} }
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
import { AudioEngine } from '../src/engine/AudioEngine.ts'

test('DeckController: setAudioSink returns false and retains current sink on failure [BUG-29]', async () => {
  const graph = new WebAudioGraph()
  const deck = new DeckController(graph)

  // Initially default sink
  assert.strictEqual(deck.getAudioSink(), 'default')

  // When elements have no setSinkId method (unsupported browser), returns false
  const resultUnsupported = await deck.setAudioSink('sink-headphones-123')
  assert.strictEqual(resultUnsupported, false)
  // Retains default sink
  assert.strictEqual(deck.getAudioSink(), 'default')

  // Mock deck elements with failing setSinkId
  const elA = (deck as unknown as { deckAElement: { setSinkId?: (id: string) => Promise<void> } }).deckAElement
  const elB = (deck as unknown as { deckBElement: { setSinkId?: (id: string) => Promise<void> } }).deckBElement

  elA.setSinkId = async () => {
    throw new Error('Device unavailable or permission denied')
  }
  elB.setSinkId = async () => {
    throw new Error('Device unavailable')
  }

  // Attempting to switch to failed device
  const resultFailed = await deck.setAudioSink('sink-failed-device')
  assert.strictEqual(resultFailed, false)
  // Must retain previous valid sink
  assert.strictEqual(deck.getAudioSink(), 'default')

  // When setSinkId succeeds
  let sinkA = ''
  let sinkB = ''
  elA.setSinkId = async (id: string) => { sinkA = id }
  elB.setSinkId = async (id: string) => { sinkB = id }

  const resultSuccess = await deck.setAudioSink('sink-usb-dac-456')
  assert.strictEqual(resultSuccess, true)
  assert.strictEqual(deck.getAudioSink(), 'sink-usb-dac-456')
  assert.strictEqual(sinkA, 'sink-usb-dac-456')
  assert.strictEqual(sinkB, 'sink-usb-dac-456')
})

test('AudioEngine: setAudioOutput persists sink only on success and updates engine state [BUG-29]', async () => {
  const engine = AudioEngine.getInstance()
  const deck = (engine as unknown as { deckController: DeckController }).deckController
  const elA = (deck as unknown as { deckAElement: { setSinkId?: (id: string) => Promise<void> } }).deckAElement
  const elB = (deck as unknown as { deckBElement: { setSinkId?: (id: string) => Promise<void> } }).deckBElement

  // 1. Success case
  elA.setSinkId = async () => {}
  elB.setSinkId = async () => {}

  const success = await engine.setAudioOutput('sink-headphones-ok')
  assert.strictEqual(success, true)
  assert.strictEqual(engine.getAudioOutput(), 'sink-headphones-ok')
  assert.strictEqual(engine.getState().audioSinkId, 'sink-headphones-ok')
  assert.strictEqual(globalThis.localStorage.getItem('echo_audio_output_device_id'), 'sink-headphones-ok')

  // 2. Failure case: setSinkId throws
  elA.setSinkId = async () => {
    throw new Error('Device disconnected')
  }

  const fail = await engine.setAudioOutput('sink-disconnected-device')
  assert.strictEqual(fail, false)
  // Engine retains previous active device
  assert.strictEqual(engine.getAudioOutput(), 'sink-headphones-ok')
  assert.strictEqual(engine.getState().audioSinkId, 'sink-headphones-ok')
  // Storage is NOT overwritten with the failed device
  assert.strictEqual(globalThis.localStorage.getItem('echo_audio_output_device_id'), 'sink-headphones-ok')
})

test('DeckController: Dual-deck crossfade invariants, input validation, and cancellation [SMALL-03]', async () => {
  const graph = new WebAudioGraph()
  const deck = new DeckController(graph)

  // 1. Clamped settings validation
  deck.setCrossfadeDuration(99)
  assert.strictEqual(deck.crossfadeDuration, 12)
  deck.setCrossfadeDuration(-5)
  assert.strictEqual(deck.crossfadeDuration, 0)

  // 2. Input validation on loadActive
  const validTrack = {
    id: 'track-v1',
    title: 'Valid Track',
    artistName: 'Artist 1',
    albumTitle: 'Album 1',
    durationMs: 180000,
    durationSeconds: 180,
    playCount: 0,
  }
  // @ts-expect-error invalid track test
  await assert.rejects(async () => deck.loadActive({ id: '', title: '' }, 'http://example.com/audio.mp3'))
  await assert.rejects(async () => deck.loadActive(validTrack, ''))

  // 3. Valid load & prebuffer
  await deck.loadActive(validTrack, 'http://example.com/audio.mp3', false)
  assert.strictEqual(deck.getActiveTrack()?.id, 'track-v1')

  const standbyTrack = {
    id: 'track-v2',
    title: 'Standby Track',
    artistName: 'Artist 2',
    albumTitle: 'Album 2',
    durationMs: 200000,
    durationSeconds: 200,
    playCount: 0,
  }
  deck.prebufferStandby(standbyTrack, 'http://example.com/audio2.mp3')
  assert.strictEqual(deck.getStandbyTrack()?.id, 'track-v2')

  const status = deck.getCrossfadeStatus()
  assert.strictEqual(status.activeDeck, 'A')
  assert.strictEqual(status.standbyDeck, 'B')
  assert.strictEqual(status.hasStandbyTrack, true)

  // 4. Cancellation
  deck.cancelCrossfade()
  assert.strictEqual(deck.getMetrics().crossfadesCancelled, 0)
})

test('AudioEngine: state versioning, event metrics, and lifecycle cleanup [SMALL-04]', () => {
  const engine = AudioEngine.getInstance()
  const initialVersion = engine.getState().stateVersion ?? 0

  let observedVersion = 0
  const unsubscribe = engine.subscribe((state) => {
    observedVersion = state.stateVersion ?? 0
  })

  // Trigger state mutation
  engine.setVolume(0.72)
  assert.ok(observedVersion > initialVersion, 'State version increments on state mutation')

  const metrics = engine.getMetrics()
  assert.ok(metrics.stateEmissionsCount > 0)

  // Verify state fields
  const state = engine.getState()
  assert.strictEqual(typeof state.isLoading, 'boolean')
  assert.strictEqual(typeof state.hasError, 'boolean')

  // Cleanup subscriber
  unsubscribe()
})

import { audioDeviceSchema } from '../src/types/audio.ts'

test('AudioOutputPicker: audioDeviceSchema validates devices and rejects malformed payloads [SMALL-06]', () => {
  const validDevice = {
    deviceId: 'usb-dac-001',
    label: 'FiiO USB DAC',
  }
  const parsed = audioDeviceSchema.safeParse(validDevice)
  assert.strictEqual(parsed.success, true)
  if (parsed.success) {
    assert.strictEqual(parsed.data.deviceId, 'usb-dac-001')
    assert.strictEqual(parsed.data.label, 'FiiO USB DAC')
  }

  // Missing or empty deviceId
  assert.strictEqual(audioDeviceSchema.safeParse({ deviceId: '', label: 'Speaker' }).success, false)
  // Non-string deviceId
  assert.strictEqual(audioDeviceSchema.safeParse({ deviceId: 123, label: 'Speaker' }).success, false)
  // Missing or empty label
  assert.strictEqual(audioDeviceSchema.safeParse({ deviceId: 'dev-1', label: '' }).success, false)
})

test('DeckController & AudioEngine: setAudioSink and setAudioOutput reject invalid or empty sink IDs [SMALL-06]', async () => {
  const engine = AudioEngine.getInstance()
  const currentSink = engine.getAudioOutput()

  // Empty string
  const res1 = await engine.setAudioOutput('')
  assert.strictEqual(res1, false)
  assert.strictEqual(engine.getAudioOutput(), currentSink)

  // Whitespace only
  const res2 = await engine.setAudioOutput('   ')
  assert.strictEqual(res2, false)
  assert.strictEqual(engine.getAudioOutput(), currentSink)

  // @ts-expect-error test non-string runtime input
  const res3 = await engine.setAudioOutput(null)
  assert.strictEqual(res3, false)
  assert.strictEqual(engine.getAudioOutput(), currentSink)
})

