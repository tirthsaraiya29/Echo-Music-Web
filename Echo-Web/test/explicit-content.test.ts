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

import { parseSearchResults, parseHomeFeed } from '../src/services/innertube/parser.ts'
import { AudioEngine } from '../src/engine/AudioEngine.ts'
import { useEchoStore } from '../src/stores/useEchoStore.ts'
import type { Track } from '../src/types/domain.ts'

describe('Explicit Content Preference & Filtering [BUG-46]', () => {
  it('Parser identifies explicit tracks from badge renderers and text markers in search', () => {
    const rawSearchData = {
      contents: {
        tabbedSearchResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  sectionListRenderer: {
                    contents: [
                      {
                        musicShelfRenderer: {
                          title: { runs: [{ text: 'Songs' }] },
                          contents: [
                            {
                              musicResponsiveListItemRenderer: {
                                flexColumns: [
                                  {
                                    musicResponsiveListItemFlexColumnRenderer: {
                                      text: { runs: [{ text: 'Explicit Anthem' }] },
                                    },
                                  },
                                  {
                                    musicResponsiveListItemFlexColumnRenderer: {
                                      text: {
                                        runs: [
                                          { text: 'Artist X', navigationEndpoint: { browseEndpoint: { browseId: 'art1' } } },
                                          { text: ' • ' },
                                          { text: 'Album Y', navigationEndpoint: { browseEndpoint: { browseId: 'alb1' } } },
                                          { text: ' • ' },
                                          { text: '3:20' },
                                        ],
                                      },
                                    },
                                  },
                                ],
                                badges: [
                                  {
                                    musicInlineBadgeRenderer: {
                                      icon: { iconType: 'MUSIC_EXPLICIT_BADGE' },
                                    },
                                  },
                                ],
                                playlistItemData: { videoId: 'vid-explicit-1' },
                              },
                            },
                            {
                              musicResponsiveListItemRenderer: {
                                flexColumns: [
                                  {
                                    musicResponsiveListItemFlexColumnRenderer: {
                                      text: { runs: [{ text: 'Clean Harmony' }] },
                                    },
                                  },
                                  {
                                    musicResponsiveListItemFlexColumnRenderer: {
                                      text: {
                                        runs: [
                                          { text: 'Artist X', navigationEndpoint: { browseEndpoint: { browseId: 'art1' } } },
                                          { text: ' • ' },
                                          { text: 'Album Y', navigationEndpoint: { browseEndpoint: { browseId: 'alb1' } } },
                                          { text: ' • ' },
                                          { text: '3:45' },
                                        ],
                                      },
                                    },
                                  },
                                ],
                                playlistItemData: { videoId: 'vid-clean-1' },
                              },
                            },
                            {
                              musicResponsiveListItemRenderer: {
                                flexColumns: [
                                  {
                                    musicResponsiveListItemFlexColumnRenderer: {
                                      text: { runs: [{ text: 'Raw Track (Explicit)' }] },
                                    },
                                  },
                                  {
                                    musicResponsiveListItemFlexColumnRenderer: {
                                      text: {
                                        runs: [
                                          { text: 'Artist Z', navigationEndpoint: { browseEndpoint: { browseId: 'art2' } } },
                                          { text: ' • ' },
                                          { text: '3:00' },
                                        ],
                                      },
                                    },
                                  },
                                ],
                                playlistItemData: { videoId: 'vid-explicit-2' },
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    }

    const catalog = parseSearchResults(rawSearchData)
    assert.strictEqual(catalog.tracks.length, 3)

    const explicitBadgeTrack = catalog.tracks.find((t) => t.id === 'vid-explicit-1')
    assert.ok(explicitBadgeTrack)
    assert.strictEqual(explicitBadgeTrack.explicit, true)
    assert.strictEqual(explicitBadgeTrack.isExplicit, true)

    const cleanTrack = catalog.tracks.find((t) => t.id === 'vid-clean-1')
    assert.ok(cleanTrack)
    assert.strictEqual(cleanTrack.explicit, false)
    assert.strictEqual(cleanTrack.isExplicit, false)

    const explicitTextTrack = catalog.tracks.find((t) => t.id === 'vid-explicit-2')
    assert.ok(explicitTextTrack)
    assert.strictEqual(explicitTextTrack.explicit, true)
    assert.strictEqual(explicitTextTrack.isExplicit, true)
  })

  it('Parser identifies explicit tracks in two-row item renderers (albums/home feeds)', () => {
    const rawFeedData = {
      contents: {
        singleColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  sectionListRenderer: {
                    contents: [
                      {
                        musicCarouselShelfRenderer: {
                          header: {
                            musicCarouselShelfBasicHeaderRenderer: {
                              title: { runs: [{ text: 'Recommended' }] },
                            },
                          },
                          contents: [
                            {
                              musicTwoRowItemRenderer: {
                                title: { runs: [{ text: 'Explicit TwoRow Song' }] },
                                subtitle: { runs: [{ text: 'Song • Artist • 2024' }] },
                                navigationEndpoint: {
                                  watchEndpoint: { videoId: 'tworow-exp-1' },
                                },
                                subtitleBadges: [
                                  {
                                    musicInlineBadgeRenderer: {
                                      icon: { iconType: 'MUSIC_EXPLICIT_BADGE' },
                                    },
                                  },
                                ],
                              },
                            },
                            {
                              musicTwoRowItemRenderer: {
                                title: { runs: [{ text: 'Clean TwoRow Song' }] },
                                subtitle: { runs: [{ text: 'Song • Artist • 2024' }] },
                                navigationEndpoint: {
                                  watchEndpoint: { videoId: 'tworow-clean-1' },
                                },
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    }

    const shelves = parseHomeFeed(rawFeedData)
    assert.strictEqual(shelves.length, 1)
    const items = shelves[0]!.items as Track[]
    assert.strictEqual(items.length, 2)

    assert.strictEqual(items[0]!.id, 'tworow-exp-1')
    assert.strictEqual(items[0]!.explicit, true)
    assert.strictEqual(items[0]!.isExplicit, true)

    assert.strictEqual(items[1]!.id, 'tworow-clean-1')
    assert.strictEqual(items[1]!.explicit, false)
    assert.strictEqual(items[1]!.isExplicit, false)
  })

  it('AudioEngine filters explicit tracks when showExplicit is disabled in user preferences', () => {
    const engine = AudioEngine.getInstance()
    // Stub loadAndPlayTrack to avoid triggering network stream resolution in unit test
    // @ts-expect-error test stub
    engine.loadAndPlayTrack = () => Promise.resolve()

    const mockTracks: Track[] = [
      {
        id: 'track-clean-1',
        title: 'Clean Track 1',
        artistName: 'Artist A',
        artistId: 'art-1',
        albumTitle: 'Album A',
        albumId: 'alb-1',
        albumImage: 'https://example.com/art.jpg',
        artwork: 'https://example.com/art.jpg',
        durationMs: 180000,
        durationSeconds: 180,
        explicit: false,
        isExplicit: false,
        playCount: 0,
      },
      {
        id: 'track-explicit-2',
        title: 'Explicit Track 2',
        artistName: 'Artist B',
        artistId: 'art-2',
        albumTitle: 'Album B',
        albumId: 'alb-2',
        albumImage: 'https://example.com/art.jpg',
        artwork: 'https://example.com/art.jpg',
        durationMs: 200000,
        durationSeconds: 200,
        explicit: true,
        isExplicit: true,
        playCount: 0,
      },
      {
        id: 'track-clean-3',
        title: 'Clean Track 3',
        artistName: 'Artist C',
        artistId: 'art-3',
        albumTitle: 'Album C',
        albumId: 'alb-3',
        albumImage: 'https://example.com/art.jpg',
        artwork: 'https://example.com/art.jpg',
        durationMs: 210000,
        durationSeconds: 210,
        explicit: false,
        isExplicit: false,
        playCount: 0,
      },
    ]

    // Set showExplicit preference to false
    useEchoStore.getState().setPreference('showExplicit', false)

    engine.setQueue(mockTracks, 0)
    const detailed = engine.getDetailedQueue()
    const activeAndUpcoming = [detailed.currentTrack, ...detailed.sourceUpcoming].filter(Boolean) as Track[]
    assert.strictEqual(activeAndUpcoming.length, 2, 'Explicit track should be filtered out from queue')
    assert.strictEqual(activeAndUpcoming[0]?.id, 'track-clean-1')
    assert.strictEqual(activeAndUpcoming[1]?.id, 'track-clean-3')

    // Reset preference to true
    useEchoStore.getState().setPreference('showExplicit', true)

    engine.setQueue(mockTracks, 0)
    const detailedWithExplicit = engine.getDetailedQueue()
    const allQueueTracks = [detailedWithExplicit.currentTrack, ...detailedWithExplicit.sourceUpcoming].filter(Boolean) as Track[]
    assert.strictEqual(allQueueTracks.length, 3, 'All tracks retained when showExplicit is true')
  })
})
