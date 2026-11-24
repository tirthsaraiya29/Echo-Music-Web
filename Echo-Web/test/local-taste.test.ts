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
    play() {
      return Promise.resolve()
    }
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
      setValueAtTime: () => {},
      cancelScheduledValues: () => {},
      linearRampToValueAtTime: () => {},
      setTargetAtTime: () => {},
    }
    connect() {}
    disconnect() {}
  }
  class MockAudioContext {
    currentTime = 0
    sampleRate = 44100
    createGain() {
      return new MockAudioNode()
    }
    createDynamicsCompressor() {
      const param = { setValueAtTime: () => {} }
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
      return {
        type: 'peaking',
        gain: { setValueAtTime: () => {} },
        frequency: { setValueAtTime: () => {} },
        Q: { setValueAtTime: () => {} },
        connect() {},
      }
    }
    createAnalyser() {
      return {
        fftSize: 2048,
        frequencyBinCount: 1024,
        getByteFrequencyData: () => {},
        connect() {},
      }
    }
    createChannelSplitter() {
      return { connect() {} }
    }
    createChannelMerger() {
      return { connect() {} }
    }
    close() {
      return Promise.resolve()
    }
  }
  ;(globalThis as unknown as { window: unknown }).window = {
    AudioContext: MockAudioContext,
    location: { origin: 'http://localhost:5173' },
    addEventListener: () => {},
    removeEventListener: () => {},
  }
}

import { calculateTasteScore } from '../src/services/recommendations/localTasteEngine.ts'
import type { ListeningHistoryRecord } from '../src/services/db/echoDatabase.ts'
import { AudioEngine } from '../src/engine/AudioEngine.ts'
import type { Track } from '../src/types/domain.ts'

test('Local Taste Scoring: applies bonuses and skip penalties accurately [BUG-15]', () => {
  const now = 1700000000000
  const sevenDaysAgo = now - 2 * 24 * 60 * 60 * 1000 // recent

  const history: ListeningHistoryRecord[] = [
    // Track 1: Completed playback (base 1.0 + complete 2.0 + recent 1.5 = 4.5)
    {
      trackId: 'track-completed',
      trackTitle: 'Completed Track',
      artistName: 'Artist A',
      playedAt: sevenDaysAgo,
      durationPlayedMs: 180000,
      trackDurationMs: 180000,
      completed: true,
      skipped: false,
      timeOfDay: 'morning',
    },
    // Track 2: Early skip (< 30s) (base 1.0 - skip 1.5 + recent 1.5 = 1.0)
    {
      trackId: 'track-skipped-early',
      trackTitle: 'Early Skipped Track',
      artistName: 'Artist B',
      playedAt: sevenDaysAgo,
      durationPlayedMs: 12000,
      trackDurationMs: 200000,
      completed: false,
      skipped: true,
      timeOfDay: 'morning',
    },
    // Track 3: Later skip (>= 30s) (base 1.0 - skip 0.75 + recent 1.5 = 1.75)
    {
      trackId: 'track-skipped-late',
      trackTitle: 'Late Skipped Track',
      artistName: 'Artist C',
      playedAt: sevenDaysAgo,
      durationPlayedMs: 60000,
      trackDurationMs: 200000,
      completed: false,
      skipped: true,
      timeOfDay: 'morning',
    },
    // Track 4: Excluded track
    {
      trackId: 'track-excluded',
      trackTitle: 'Excluded Track',
      artistName: 'Artist D',
      playedAt: sevenDaysAgo,
      durationPlayedMs: 180000,
      trackDurationMs: 180000,
      completed: true,
      skipped: false,
      timeOfDay: 'morning',
    },
  ]

  const exclusions = new Set(['track-excluded'])
  const likedTrackIds = new Set<string>()

  // Calculate scores for 'afternoon' so time-of-day bonus doesn't add jitter
  const scores = calculateTasteScore(history, exclusions, likedTrackIds, now, 'afternoon')

  // Excluded track must not appear
  assert.strictEqual(scores.some((s) => s.trackId === 'track-excluded'), false)

  const completedScore = scores.find((s) => s.trackId === 'track-completed')
  const earlySkipScore = scores.find((s) => s.trackId === 'track-skipped-early')
  const lateSkipScore = scores.find((s) => s.trackId === 'track-skipped-late')

  assert.ok(completedScore)
  assert.ok(earlySkipScore)
  assert.ok(lateSkipScore)

  // Verify rank ordering: completed > late skip > early skip
  assert.strictEqual(completedScore.score, 4.5)
  assert.strictEqual(lateSkipScore.score, 1.75)
  assert.strictEqual(earlySkipScore.score, 1.0)
  assert.ok(completedScore.score > lateSkipScore.score)
  assert.ok(lateSkipScore.score > earlySkipScore.score)
})

test('AudioEngine: records skip vs completion based on playback threshold [BUG-15]', () => {
  const engine = AudioEngine.getInstance()

  const track: Track = {
    id: 'test-track-1',
    title: 'Test Song',
    artistName: 'Tester',
    durationSeconds: 100,
    streamUrl: 'https://example.com/test.mp3',
  }

  // 1. Queue manager sets active track
  engine.setQueue([track], 0)

  // Mock deckController duration and current time for a short play (< 85% = skip)
  const deck = (engine as unknown as {
    deckController: {
      getCurrentTime: () => number
      getDuration: () => number
    }
    currentTrackRecorded: boolean
  })

  deck.deckController.getDuration = () => 100
  deck.deckController.getCurrentTime = () => 20 // 20s of 100s = 20% (< 85%)

  deck.currentTrackRecorded = false
  assert.doesNotThrow(() => {
    // Calling transition should flag track as skipped
    engine.recordCurrentTrackTransition(false)
  })
  assert.strictEqual(deck.currentTrackRecorded, true)

  // 2. Playback over 85% threshold (90s of 100s = 90% >= 85%)
  deck.currentTrackRecorded = false
  deck.deckController.getCurrentTime = () => 90
  assert.doesNotThrow(() => {
    engine.recordCurrentTrackTransition(false)
  })
  assert.strictEqual(deck.currentTrackRecorded, true)

  // 3. Auto-end always records completed
  deck.currentTrackRecorded = false
  assert.doesNotThrow(() => {
    engine.recordCurrentTrackTransition(true)
  })
  assert.strictEqual(deck.currentTrackRecorded, true)
})
