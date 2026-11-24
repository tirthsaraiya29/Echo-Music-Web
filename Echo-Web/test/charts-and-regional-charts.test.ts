import test from 'node:test'
import assert from 'node:assert'
import {
  SUPPORTED_CHART_REGIONS,
  CHART_CATEGORIES,
  getChartRegion,
  fetchRegionalChart,
  playChartQueue,
  getChartTelemetry,
  resetChartTelemetry,
  chartGroupSchema,
} from '../src/services/charts/chartService.ts'
import type { Track } from '../src/types/domain.ts'
import { useEchoStore } from '../src/stores/useEchoStore.ts'

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
      value: 1,
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
        gain: { setValueAtTime: () => {}, cancelScheduledValues: () => {} },
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

  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext
  if (typeof (globalThis as unknown as { addEventListener?: unknown }).addEventListener === 'undefined') {
    ;(globalThis as unknown as { addEventListener: unknown }).addEventListener = () => {}
    ;(globalThis as unknown as { removeEventListener: unknown }).removeEventListener = () => {}
  }
}

function createMockTrack(id: string, title: string, artistName: string): Track {
  return {
    id,
    title,
    artistName,
    artistId: `artist-${id}`,
    albumId: `album-${id}`,
    albumTitle: `${title} Album`,
    albumImage: 'https://example.com/art.jpg',
    artwork: 'https://example.com/art.jpg',
    thumbnailUrl: 'https://example.com/art.jpg',
    durationSeconds: 210,
    durationMs: 210000,
    explicit: false,
    playCount: 100,
    videoId: id,
    streamUrl: `https://cdn.example.com/audio/${id}.mp3`,
  }
}

test('Charts: resolves supported regions and categories accurately', () => {
  assert.strictEqual(SUPPORTED_CHART_REGIONS.length >= 12, true)
  assert.strictEqual(CHART_CATEGORIES.length, 4)

  const us = getChartRegion('US')
  assert.strictEqual(us.code, 'US')
  assert.strictEqual(us.name, 'United States')
  assert.strictEqual(us.flag, '🇺🇸')

  const globalReg = getChartRegion('GLOBAL')
  assert.strictEqual(globalReg.code, 'GLOBAL')
  assert.strictEqual(globalReg.name, 'Global')
  assert.strictEqual(globalReg.flag, '🌐')

  const fallback = getChartRegion('unknown_code')
  assert.strictEqual(fallback.code, 'UNKNOWN_CODE')
})

test('Charts: synthesizes ranked chart items with sequential ranks and movement deltas', async () => {
  resetChartTelemetry()

  const fallbackTracks: Track[] = [
    createMockTrack('tr-1', 'First Song', 'Artist Alpha'),
    createMockTrack('tr-2', 'Second Song', 'Artist Beta'),
    createMockTrack('tr-3', 'Third Song', 'Artist Gamma'),
    createMockTrack('tr-4', 'Fourth Song', 'Artist Delta'),
    createMockTrack('tr-5', 'Fifth Song', 'Artist Epsilon'),
  ]

  const chart = await fetchRegionalChart('GB', 'top-songs', { fallbackTracks })

  // Schema verification
  assert.doesNotThrow(() => chartGroupSchema.parse(chart))

  assert.strictEqual(chart.region, 'GB')
  assert.strictEqual(chart.regionName, 'United Kingdom')
  assert.strictEqual(chart.category, 'top-songs')
  assert.strictEqual(chart.items.length, 5)

  // Verify rank sequencing
  chart.items.forEach((item, idx) => {
    assert.strictEqual(item.rank, idx + 1)
    assert.ok(['up', 'down', 'same', 'new'].includes(item.rankChange))
    assert.ok(item.delta >= 0)
    assert.ok(item.track.id)
  })

  const telemetry = getChartTelemetry()
  assert.strictEqual(telemetry.chartsLoaded, 1)
  assert.strictEqual(telemetry.lastRegion, 'GB')
})

test('Charts: playChartQueue dispatches tracks and increments queue telemetry', async () => {
  resetChartTelemetry()

  const originalPlayQueue = useEchoStore.getState().playQueue
  let queuedTracks: Track[] = []
  useEchoStore.setState({
    playQueue: (tracks: Track[]) => {
      queuedTracks = tracks
    },
  })

  try {
    const fallbackTracks: Track[] = [
      createMockTrack('song-1', 'Hit 1', 'Star 1'),
      createMockTrack('song-2', 'Hit 2', 'Star 2'),
      createMockTrack('song-3', 'Hit 3', 'Star 3'),
    ]

    const chart = await fetchRegionalChart('JP', 'trending', { fallbackTracks })

    // Play normal
    const res = playChartQueue(chart, 0, false)
    assert.strictEqual(res.queuedCount, 3)
    assert.strictEqual(queuedTracks.length, 3)
    assert.ok(res.title.includes('Trending'))

    let telemetry = getChartTelemetry()
    assert.strictEqual(telemetry.chartQueuesPlayed, 1)

    // Shuffle chart
    const shuffleRes = playChartQueue(chart, 0, true)
    assert.strictEqual(shuffleRes.queuedCount, 3)

    telemetry = getChartTelemetry()
    assert.strictEqual(telemetry.chartQueuesPlayed, 2)
  } finally {
    useEchoStore.setState({ playQueue: originalPlayQueue })
  }
})

test('Charts: tracks geographical region switches in telemetry', async () => {
  resetChartTelemetry()

  const dummy = [createMockTrack('d1', 'Dummy', 'Dummy Artist')]

  await fetchRegionalChart('US', 'top-songs', { fallbackTracks: dummy })
  let telemetry = getChartTelemetry()
  assert.strictEqual(telemetry.regionSwitches, 1)
  assert.strictEqual(telemetry.lastRegion, 'US')

  await fetchRegionalChart('IN', 'top-songs', { fallbackTracks: dummy })
  telemetry = getChartTelemetry()
  assert.strictEqual(telemetry.regionSwitches, 2)
  assert.strictEqual(telemetry.lastRegion, 'IN')

  // Querying same region should not increment regionSwitches
  await fetchRegionalChart('IN', 'top-videos', { fallbackTracks: dummy })
  telemetry = getChartTelemetry()
  assert.strictEqual(telemetry.regionSwitches, 2)
})
