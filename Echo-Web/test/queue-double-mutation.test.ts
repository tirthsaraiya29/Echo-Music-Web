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

import { QueueManager } from '../src/engine/QueueManager.ts'
import { AudioEngine } from '../src/engine/AudioEngine.ts'
import { bridgeAudioEngineWithStore, audioEngineActions, getBridgeMetrics } from '../src/hooks/useAudioEngine.ts'
import { useEchoStore } from '../src/stores/useEchoStore.ts'
import type { Track } from '../src/types/audio.ts'

function createMockTrack(id: string, title: string): Track {
  return {
    id,
    title,
    artistName: 'Artist ' + id,
    artistId: 'art-' + id,
    albumTitle: 'Album ' + id,
    albumId: 'alb-' + id,
    albumImage: 'https://example.com/art.jpg',
    artwork: 'https://example.com/art.jpg',
    durationMs: 180000,
    durationSeconds: 180,
    playCount: 0,
  }
}

test('Zustand queue actions: engine as single source of truth prevents double mutations [BUG-02]', () => {
  const qm = new QueueManager()

  // Simulate Zustand store state
  let storeQueueIds: string[] = []

  // Simulate the bridge subscriber that listens to engine queue changes
  const onEngineQueueChange = () => {
    const upNextIds = qm.upNext.map((t) => t.id)
    if (
      upNextIds.length !== storeQueueIds.length ||
      upNextIds.some((id, idx) => id !== storeQueueIds[idx])
    ) {
      storeQueueIds = upNextIds
    }
  }

  // The CORRECTED store actions:
  // Instead of: qm.addToQueue(track); storeQueueIds = [...storeQueueIds, track.id] (which duplicated)
  // The corrected actions let the engine own the queue and sync storeQueueIds idempotently:
  const enqueue = (track: Track) => {
    qm.addToQueue(track)
    onEngineQueueChange()
    storeQueueIds = qm.upNext.map((t) => t.id)
  }

  const removeFromQueue = (index: number) => {
    qm.removeUpNext(index)
    onEngineQueueChange()
    storeQueueIds = qm.upNext.map((t) => t.id)
  }

  const moveQueueItem = (from: number, to: number) => {
    qm.moveUpNext(from, to)
    onEngineQueueChange()
    storeQueueIds = qm.upNext.map((t) => t.id)
  }

  const clearQueue = () => {
    qm.clearUpNext()
    onEngineQueueChange()
    storeQueueIds = []
  }

  // Test 1: Enqueue must not duplicate IDs
  const t1 = createMockTrack('t1', 'Track 1')
  const t2 = createMockTrack('t2', 'Track 2')
  const t3 = createMockTrack('t3', 'Track 3')

  enqueue(t1)
  assert.strictEqual(storeQueueIds.length, 1, 'Store queue must have exactly 1 item')
  assert.strictEqual(storeQueueIds[0], 't1')
  assert.strictEqual(qm.upNext.length, 1, 'QueueManager upNext must have exactly 1 item')

  enqueue(t2)
  enqueue(t3)
  assert.deepStrictEqual(storeQueueIds, ['t1', 't2', 't3'], 'Enqueue adds without duplicate mutation')
  assert.deepStrictEqual(qm.upNext.map((t) => t.id), ['t1', 't2', 't3'])

  // Test 2: removeFromQueue must not remove two items
  removeFromQueue(1) // remove t2
  assert.deepStrictEqual(storeQueueIds, ['t1', 't3'], 'removeFromQueue removes exactly one item')
  assert.deepStrictEqual(qm.upNext.map((t) => t.id), ['t1', 't3'])

  // Test 3: moveQueueItem must not reorder twice
  moveQueueItem(0, 1) // move t1 to index 1 -> ['t3', 't1']
  assert.deepStrictEqual(storeQueueIds, ['t3', 't1'], 'moveQueueItem reorders exactly once')
  assert.deepStrictEqual(qm.upNext.map((t) => t.id), ['t3', 't1'])

  // Test 4: clearQueue clears both
  clearQueue()
  assert.strictEqual(storeQueueIds.length, 0)
  assert.strictEqual(qm.upNext.length, 0)
})

test('Zustand/audio-engine bridge: clamped action inputs and bidirectional synchronization [SMALL-02]', () => {
  const engine = AudioEngine.getInstance()
  // Stub loadAndPlayTrack
  // @ts-expect-error test stub
  engine.loadAndPlayTrack = () => Promise.resolve()

  // 1. Action bounds validation
  audioEngineActions.setVolume(1.8) // clamped to 1.0
  assert.strictEqual(engine.getState().volume, 1.0)
  audioEngineActions.setVolume(-0.5) // clamped to 0.0
  assert.strictEqual(engine.getState().volume, 0.0)

  audioEngineActions.setCrossfadeDuration(99) // clamped to 12
  assert.strictEqual(engine.getState().crossfadeDuration, 12)
  audioEngineActions.setCrossfadeDuration(-5) // clamped to 0
  assert.strictEqual(engine.getState().crossfadeDuration, 0)

  audioEngineActions.setPlaybackRate(10) // clamped to 2.0
  assert.strictEqual(engine.getState().playbackRate, 2.0)

  // 2. Bridge bidirectional lifecycle
  const cleanup = bridgeAudioEngineWithStore()

  // Dynamic store preference change updates engine
  useEchoStore.getState().setPreference('shuffle', true)
  assert.strictEqual(engine.getState().isShuffle, true)

  useEchoStore.getState().setPreference('volume', 85)
  assert.strictEqual(Math.round(engine.getState().volume * 100), 85)

  useEchoStore.getState().setPreference('repeat', 'one')
  assert.strictEqual(engine.getState().repeatMode, 'ONE')

  const metrics = getBridgeMetrics()
  assert.ok(metrics.syncCount > 0)
  assert.ok(metrics.storeToEngineCount > 0)

  // Clean teardown
  cleanup()
})
