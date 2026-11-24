import { describe, it } from 'node:test'
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
      return Object.assign(new MockAudioNode(), {
        frequency: { setValueAtTime: () => {}, setTargetAtTime: () => {} },
        gain: { setValueAtTime: () => {}, setTargetAtTime: () => {} },
        Q: { setValueAtTime: () => {}, setTargetAtTime: () => {} },
        type: 'peaking',
      })
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
    createMediaElementSource() { return new MockAudioNode() }
    createChannelSplitter() { return new MockAudioNode() }
    createChannelMerger() { return new MockAudioNode() }
    resume() { return Promise.resolve() }
    suspend() { return Promise.resolve() }
    close() { return Promise.resolve() }
  }

  const mockWindow = {
    AudioContext: MockAudioContext,
    webkitAudioContext: MockAudioContext,
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: globalThis.localStorage,
  }

  globalThis.window = mockWindow as unknown as Window & typeof globalThis
  globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext
}

import { musicFlowService } from '../src/services/flow/musicFlowService.ts'
import type { Track } from '../src/types/domain.ts'

describe('Music Flow Takeover & Queue Handoff [BUG-40]', () => {
  it('manages flow state, ownership token and snapshot handoff', async () => {
    const mockTrack1: Track = {
      id: 'flow_t1',
      title: 'Flow Track 1',
      artistId: 'a1',
      artistName: 'Artist 1',
      albumId: 'alb1',
      albumTitle: 'Album 1',
      albumImage: '',
      artwork: '',
      streamUrl: 'https://example.com/stream1.mp3',
      durationMs: 200000,
      explicit: false,
      playCount: 1,
    }

    const mockTrack2: Track = {
      id: 'flow_t2',
      title: 'Flow Track 2',
      artistId: 'a2',
      artistName: 'Artist 2',
      albumId: 'alb2',
      albumTitle: 'Album 2',
      albumImage: '',
      artwork: '',
      streamUrl: 'https://example.com/stream2.mp3',
      durationMs: 210000,
      explicit: false,
      playCount: 2,
    }

    // 1. Enter Flow
    await musicFlowService.enterFlow([mockTrack1, mockTrack2])
    const activeState = musicFlowService.getState()

    assert.strictEqual(activeState.isActive, true)
    assert.ok(activeState.ownershipToken?.startsWith('flow_'))
    assert.strictEqual(activeState.feed.length, 2)
    assert.strictEqual(activeState.currentIndex, 0)

    // 2. Navigation
    musicFlowService.nextTrack()
    assert.strictEqual(musicFlowService.getState().currentIndex, 1)

    musicFlowService.prevTrack()
    assert.strictEqual(musicFlowService.getState().currentIndex, 0)

    // Bounds checking
    musicFlowService.prevTrack()
    assert.strictEqual(musicFlowService.getState().currentIndex, 0, 'Should not navigate below index 0')

    // 3. Exit Flow with restoreQueue = false (keep this mix)
    await musicFlowService.exitFlow(false)
    const exitedState = musicFlowService.getState()
    assert.strictEqual(exitedState.isActive, false)
    assert.strictEqual(exitedState.ownershipToken, null)
    assert.strictEqual(exitedState.savedSnapshot, null)
  })

  it('debounces track selection during rapid navigation', async () => {
    const tracks: Track[] = Array.from({ length: 5 }, (_, i) => ({
      id: `deb_t${i}`,
      title: `Track ${i}`,
      artistId: `a${i}`,
      artistName: `Artist ${i}`,
      albumId: `alb${i}`,
      albumTitle: `Album ${i}`,
      albumImage: '',
      artwork: '',
      streamUrl: `https://example.com/stream_${i}.mp3`,
      durationMs: 180000,
      explicit: false,
      playCount: 0,
    }))

    await musicFlowService.enterFlow(tracks)

    // Rapidly navigate 1 -> 2 -> 3
    musicFlowService.selectTrack(1)
    musicFlowService.selectTrack(2)
    musicFlowService.selectTrack(3)

    // Index updates immediately for UI responsiveness
    assert.strictEqual(musicFlowService.getState().currentIndex, 3)

    // Wait 300ms for debounce timer to fire
    await new Promise((resolve) => setTimeout(resolve, 320))

    await musicFlowService.exitFlow(false)
  })

  it('MusicFlowPage file exists and exports MusicFlowPage component', async () => {
    const fs = await import('node:fs')
    const content = fs.readFileSync('src/pages/MusicFlowPage.tsx', 'utf8')
    assert.ok(content.includes('export function MusicFlowPage()'), 'MusicFlowPage component must be exported')
    assert.ok(content.includes('musicFlowService'), 'MusicFlowPage must integrate with musicFlowService')
  })
})
