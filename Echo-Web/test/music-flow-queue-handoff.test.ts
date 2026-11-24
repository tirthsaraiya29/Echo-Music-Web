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

import { MusicFlowService } from '../src/services/flow/musicFlowService.ts'
import { AudioEngine } from '../src/engine/AudioEngine.ts'
import { useEchoStore } from '../src/stores/useEchoStore.ts'
import type { Track } from '../src/types/audio.ts'

const initialTrack: Track = {
  id: 'orig-1',
  title: 'Original Track 1',
  artistName: 'Artist',
  streamUrl: 'https://cdn.example.com/audio/mock-orig.mp3',
}
const flowTrack: Track = {
  id: 'flow-1',
  title: 'Flow Track 1',
  artistName: 'Artist',
  streamUrl: 'https://cdn.example.com/audio/mock-flow.mp3',
}

test('Music Flow queue handoff: successful restore when ownership is maintained', async () => {
  const service = new MusicFlowService()
  const engine = AudioEngine.getInstance()

  // Setup initial queue
  engine.setQueue([initialTrack], 0)
  assert.equal(engine.getState().currentTrack?.id, 'orig-1')

  // Stub store play methods
  const originalPlayQueue = useEchoStore.getState().playQueue
  useEchoStore.setState({ playQueue: () => {} })

  try {
    await service.enterFlow([flowTrack])
    assert.equal(service.getState().isActive, true)
    assert.equal(service.getState().handoffStatus, 'active')
    assert.ok(service.getState().ownershipToken)

    // Exit and restore previous queue
    const restored = await service.exitFlow(true)
    assert.equal(restored, true, 'Restore should succeed when ownership is untouched')
    assert.equal(service.getState().handoffStatus, 'restored')
    assert.equal(service.getTelemetry().restoresSucceededCount, 1)
  } finally {
    useEchoStore.setState({ playQueue: originalPlayQueue })
  }
})

test('Music Flow queue handoff: blocks restore when ownership was revoked by external queue change', async () => {
  const service = new MusicFlowService()
  const engine = AudioEngine.getInstance()

  engine.setQueue([initialTrack], 0)

  const originalPlayQueue = useEchoStore.getState().playQueue
  useEchoStore.setState({ playQueue: () => {} })

  try {
    await service.enterFlow([flowTrack])
    assert.equal(service.getState().isActive, true)

    // External mutation revokes ownership
    engine.revokeQueueOwnership('EXTERNAL_MANUAL_MUTATION')
    assert.equal(engine.isQueueOwnershipValid(service.getState().ownershipToken), false)

    // Attempt to exit and restore
    const restored = await service.exitFlow(true)
    assert.equal(restored, false, 'Restore should be blocked when ownership was revoked')
    assert.equal(service.getState().handoffStatus, 'revoked')
    assert.equal(service.getTelemetry().restoresBlockedCount, 1)
  } finally {
    useEchoStore.setState({ playQueue: originalPlayQueue })
  }
})

test('Music Flow queue handoff: keeps mix when user requests keep', async () => {
  const service = new MusicFlowService()
  const engine = AudioEngine.getInstance()

  engine.setQueue([initialTrack], 0)

  const originalPlayQueue = useEchoStore.getState().playQueue
  useEchoStore.setState({ playQueue: () => {} })

  try {
    await service.enterFlow([flowTrack])
    const kept = await service.exitFlow(false)
    assert.equal(kept, true)
    assert.equal(service.getState().handoffStatus, 'kept')
    assert.equal(service.getTelemetry().mixesKeptCount, 1)
  } finally {
    useEchoStore.setState({ playQueue: originalPlayQueue })
  }
})
