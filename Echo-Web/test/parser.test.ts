import test from 'node:test'
import assert from 'node:assert'
import {
  parseDurationToSeconds,
  normalizeThumbnailUrl,
  parseHomeFeed,
  parseAlbumDetails,
  parseArtistDetails,
  parseSearchResults,
  parseResponsiveListItem,
  getParserMetrics,
  resetParserMetrics,
  parserMetricsSchema,
} from '../src/services/innertube/parser.ts'

test('Parser: parseDurationToSeconds parses various timestamp formats correctly', () => {
  assert.strictEqual(parseDurationToSeconds('3:45'), 225)
  assert.strictEqual(parseDurationToSeconds('0:30'), 30)
  assert.strictEqual(parseDurationToSeconds('1:15:30'), 4530)
  assert.strictEqual(parseDurationToSeconds('45'), 45)
  assert.strictEqual(parseDurationToSeconds(''), 180, 'Empty string should fall back to 180s default')
  assert.strictEqual(parseDurationToSeconds(undefined), 180, 'Undefined should fall back to 180s default')
  assert.strictEqual(parseDurationToSeconds('invalid'), 180, 'Invalid string should fall back to 180s default')
})

test('Parser: normalizeThumbnailUrl sanitizes and resizes artwork URLs', () => {
  const url1 = 'https://lh3.googleusercontent.com/test=w120-h120'
  assert.strictEqual(normalizeThumbnailUrl(url1, 300), 'https://lh3.googleusercontent.com/test=w300-h300')

  const url2 = '//lh3.googleusercontent.com/test=s120'
  assert.strictEqual(normalizeThumbnailUrl(url2, 544), 'https://lh3.googleusercontent.com/test=s544')

  const empty = normalizeThumbnailUrl('')
  assert.ok(empty.startsWith('data:image/svg+xml'), 'Empty URLs should return placeholder SVG')
})

test('Parser: parseHomeFeed handles both single-column and two-column payloads without throwing', () => {
  // Empty payload
  assert.deepStrictEqual(parseHomeFeed(null), [])
  assert.deepStrictEqual(parseHomeFeed({}), [])

  // Two column payload mock
  const mockFeed = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        secondaryContents: {
          sectionListRenderer: {
            contents: [
              {
                musicCarouselShelfRenderer: {
                  header: {
                    musicCarouselShelfBasicHeaderRenderer: {
                      title: { runs: [{ text: 'Quick Picks' }] },
                    },
                  },
                  contents: [
                    {
                      musicTwoRowItemRenderer: {
                        navigationEndpoint: {
                          watchEndpoint: { videoId: 'v123' },
                        },
                        title: { runs: [{ text: 'Song One' }] },
                        subtitle: {
                          runs: [
                            {
                              text: 'Artist One',
                              navigationEndpoint: { browseEndpoint: { browseId: 'art-1' } },
                            },
                          ],
                        },
                        thumbnailRenderer: {
                          musicThumbnailRenderer: {
                            thumbnail: {
                              thumbnails: [{ url: 'https://example.com/art.jpg' }],
                            },
                          },
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
  }

  const shelves = parseHomeFeed(mockFeed)
  assert.strictEqual(shelves.length, 1)
  assert.strictEqual(shelves[0]?.title, 'Quick Picks')
  assert.strictEqual(shelves[0]?.items.length, 1)
  assert.strictEqual(shelves[0]?.items[0]?.id, 'v123')
})

test('Parser: parseAlbumDetails parses album header and tracklist gracefully', () => {
  const mockAlbumData = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        secondaryContents: {
          sectionListRenderer: {
            contents: [
              {
                musicShelfRenderer: {
                  contents: [
                    {
                      musicResponsiveListItemRenderer: {
                        playlistItemData: { videoId: 't1' },
                        flexColumns: [
                          {
                            musicResponsiveListItemFlexColumnRenderer: {
                              text: { runs: [{ text: 'Track 1' }] },
                            },
                          },
                          {
                            musicResponsiveListItemFlexColumnRenderer: {
                              text: {
                                runs: [
                                  { text: 'Artist A', navigationEndpoint: { browseEndpoint: { browseId: 'art-a' } } },
                                ],
                              },
                            },
                          },
                        ],
                        fixedColumns: [
                          {
                            musicResponsiveListItemFixedColumnRenderer: {
                              text: { runs: [{ text: '3:20' }] },
                            },
                          },
                        ],
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
    header: {
      musicDetailHeaderRenderer: {
        title: { runs: [{ text: 'Sample Album' }] },
        subtitle: { runs: [{ text: 'Artist A' }] },
      },
    },
  }

  const { album, tracks } = parseAlbumDetails(mockAlbumData)
  assert.strictEqual(album.title, 'Sample Album')
  assert.strictEqual(album.artistName, 'Artist A')
  assert.strictEqual(tracks.length, 1)
  assert.strictEqual(tracks[0]?.id, 't1')
  assert.strictEqual(tracks[0]?.title, 'Track 1')
  assert.strictEqual(tracks[0]?.durationSeconds, 200)
})

test('Parser: parseSearchResults categorizes songs, albums, and artists', () => {
  const emptyRes = parseSearchResults({})
  assert.deepStrictEqual(emptyRes.tracks, [])
  assert.deepStrictEqual(emptyRes.albums, [])
  assert.deepStrictEqual(emptyRes.artists, [])
  assert.deepStrictEqual(emptyRes.playlists, [])
})

test('Parser: parseDurationToSeconds enforces boundary limits and custom fallbacks', () => {
  assert.strictEqual(parseDurationToSeconds('0:00'), 0)
  assert.strictEqual(parseDurationToSeconds('-1:30'), 180, 'Negative parts fallback')
  assert.strictEqual(parseDurationToSeconds('25:00:00'), 180, 'Over 24h exceeds 86400s and falls back')
  assert.strictEqual(parseDurationToSeconds('bad:input', 240), 240, 'Custom fallback respected')
  assert.strictEqual(parseDurationToSeconds('', 300), 300, 'Custom fallback on empty')
})

test('Parser: normalizeThumbnailUrl clamps dimensions to [16, 2048]', () => {
  const url = 'https://lh3.googleusercontent.com/test=w120-h120'
  assert.strictEqual(normalizeThumbnailUrl(url, 5), 'https://lh3.googleusercontent.com/test=w16-h16', 'Clamps lower bound')
  assert.strictEqual(normalizeThumbnailUrl(url, 4000), 'https://lh3.googleusercontent.com/test=w2048-h2048', 'Clamps upper bound')
  assert.strictEqual(normalizeThumbnailUrl(url, -10), 'https://lh3.googleusercontent.com/test=w16-h16', 'Clamps negative')
})

test('Parser: tracks telemetry metrics and resets properly', () => {
  resetParserMetrics()
  const initialMetrics = getParserMetrics()
  assert.strictEqual(initialMetrics.totalParsed, 0)
  assert.strictEqual(initialMetrics.malformedSkipped, 0)

  // Pass malformed item
  parseResponsiveListItem(null)
  parseResponsiveListItem('not an object')
  parseResponsiveListItem({})

  const metricsAfterMalformed = getParserMetrics()
  assert.strictEqual(metricsAfterMalformed.malformedSkipped, 3)

  // Validate metrics schema
  const parsed = parserMetricsSchema.safeParse(metricsAfterMalformed)
  assert.strictEqual(parsed.success, true)

  resetParserMetrics()
  assert.strictEqual(getParserMetrics().malformedSkipped, 0)
})

test('Parser: respects AbortSignal cancellation', () => {
  const controller = new AbortController()
  controller.abort()

  assert.throws(() => {
    parseResponsiveListItem({}, { signal: controller.signal })
  }, /aborted/)

  assert.throws(() => {
    parseHomeFeed({}, { signal: controller.signal })
  }, /aborted/)

  assert.throws(() => {
    parseAlbumDetails({}, { signal: controller.signal })
  }, /aborted/)

  assert.throws(() => {
    parseArtistDetails({}, { signal: controller.signal })
  }, /aborted/)

  assert.throws(() => {
    parseSearchResults({}, { signal: controller.signal })
  }, /aborted/)
})

test('Parser: deduplicates repeated search and artist detail entities', () => {
  const duplicateSearchData = {
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
                        contents: [
                          {
                            musicResponsiveListItemRenderer: {
                              playlistItemData: { videoId: 'dup1' },
                              flexColumns: [
                                {
                                  musicResponsiveListItemFlexColumnRenderer: {
                                    text: { runs: [{ text: 'Duplicate Song' }] },
                                  },
                                },
                              ],
                              fixedColumns: [
                                {
                                  musicResponsiveListItemFixedColumnRenderer: {
                                    text: { runs: [{ text: '3:00' }] },
                                  },
                                },
                              ],
                            },
                          },
                          {
                            musicResponsiveListItemRenderer: {
                              playlistItemData: { videoId: 'dup1' },
                              flexColumns: [
                                {
                                  musicResponsiveListItemFlexColumnRenderer: {
                                    text: { runs: [{ text: 'Duplicate Song' }] },
                                  },
                                },
                              ],
                              fixedColumns: [
                                {
                                  musicResponsiveListItemFixedColumnRenderer: {
                                    text: { runs: [{ text: '3:00' }] },
                                  },
                                },
                              ],
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

  const results = parseSearchResults(duplicateSearchData)
  assert.strictEqual(results.tracks.length, 1, 'Duplicate videoId should be coalesced into 1 item')
  assert.strictEqual(results.tracks[0]?.id, 'dup1')
})
