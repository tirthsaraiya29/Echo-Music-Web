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
import { musicFlowTelemetrySchema } from '../src/types/flow.ts'
import { useEchoStore } from '../src/stores/useEchoStore.ts'
import type { Track } from '../src/types/audio.ts'

const mockTracks: Track[] = [
  { id: 'track-1', title: 'Flow Track 1', artistName: 'Artist 1', durationSeconds: 200 },
  { id: 'track-2', title: 'Flow Track 2', artistName: 'Artist 2', durationSeconds: 210 },
  { id: 'track-3', title: 'Flow Track 3', artistName: 'Artist 3', durationSeconds: 220 },
  { id: 'track-4', title: 'Flow Track 4', artistName: 'Artist 4', durationSeconds: 230 },
]

test('MusicFlowService: telemetry schema validation', () => {
  const service = new MusicFlowService()
  const initial = service.getTelemetry()
  const validated = musicFlowTelemetrySchema.parse(initial)
  assert.equal(validated.swipesCount, 0)
  assert.equal(validated.feedsGeneratedCount, 0)
})

test('MusicFlowService: enter flow, navigation and reel swipe telemetry', async () => {
  const service = new MusicFlowService()
  assert.equal(service.getState().isActive, false)

  // Stub store playback methods to avoid real network stream resolution in unit tests
  const originalPlayQueue = useEchoStore.getState().playQueue
  const originalPlayTrack = useEchoStore.getState().playTrack
  useEchoStore.setState({
    playQueue: () => {},
    playTrack: () => {},
  })

  try {
    await service.enterFlow(mockTracks)
    assert.equal(service.getState().isActive, true)
    assert.equal(service.getState().currentIndex, 0)
    assert.equal(service.getState().feed.length, 4)
    assert.equal(service.getTelemetry().feedsGeneratedCount, 1)

    // Next track swipe
    service.nextTrack()
    assert.equal(service.getState().currentIndex, 1)
    assert.equal(service.getTelemetry().swipesCount, 1)
    assert.equal(service.getTelemetry().lastSwipeDirection, 'up')
    assert.equal(service.getTelemetry().skipsCount, 1)

    // Prev track swipe
    service.prevTrack()
    assert.equal(service.getState().currentIndex, 0)
    assert.equal(service.getTelemetry().swipesCount, 2)
    assert.equal(service.getTelemetry().lastSwipeDirection, 'down')

    // Record like
    service.recordLike()
    assert.equal(service.getTelemetry().likesCount, 1)

    // Exit flow without restore
    await service.exitFlow(false)
    assert.equal(service.getState().isActive, false)
    assert.equal(service.getState().feed.length, 0)
  } finally {
    useEchoStore.setState({
      playQueue: originalPlayQueue,
      playTrack: originalPlayTrack,
    })
  }
})
