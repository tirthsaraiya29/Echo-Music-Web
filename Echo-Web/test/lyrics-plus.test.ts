import test from 'node:test'
import assert from 'node:assert/strict'

import {
  LyricsPlusProvider,
  parseLyricsPlusItems,
  parseLyricsPlusLrc,
  parseSyllableWords,
  lyricsPlusResponseSchema,
  lyricsPlusItemSchema,
  lyricsPlusSyllableSchema,
  lyricsPlusMetricsSchema,
  getLyricsPlusMetrics,
  resetLyricsPlusMetrics,
  setLastWorkingServer,
  getLastWorkingServer,
} from '../src/services/lyrics/LyricsPlusProvider.ts'

test('LyricsPlusProvider: Zod schemas validate KPoe structures, syllables, and metrics', () => {
  resetLyricsPlusMetrics()

  // Syllable validation
  const validSyllable = {
    text: 'Never ',
    time: 1200,
    duration: 350,
    isBackground: false,
  }
  assert.strictEqual(lyricsPlusSyllableSchema.safeParse(validSyllable).success, true)

  // Item validation
  const validItem = {
    text: 'Never gonna give you up',
    time: 1200,
    duration: 2500,
    syllabus: [validSyllable],
  }
  assert.strictEqual(lyricsPlusItemSchema.safeParse(validItem).success, true)

  // Response validation
  const validResponse = {
    id: 42,
    trackName: 'Never Gonna Give You Up',
    artistName: 'Rick Astley',
    syncedLyrics: '[00:01.20] Never gonna give you up',
    plainLyrics: 'Never gonna give you up',
    lyrics: [validItem],
  }
  assert.strictEqual(lyricsPlusResponseSchema.safeParse(validResponse).success, true)

  // Metrics validation
  const metrics = getLyricsPlusMetrics()
  assert.strictEqual(lyricsPlusMetricsSchema.safeParse(metrics).success, true)
})

test('LyricsPlusProvider: parseLyricsPlusItems converts KPoe syllables into word-by-word synchronized lines', () => {
  const items = [
    {
      time: 1000,
      duration: 3000,
      text: 'Hello world',
      syllabus: [
        { text: 'Hel', time: 1000, duration: 400, isBackground: false },
        { text: 'lo ', time: 1400, duration: 400, isBackground: false },
        { text: 'world', time: 1800, duration: 600, isBackground: false },
      ],
    },
    {
      time: 5000,
      duration: 2500,
      text: 'Background echo',
      syllabus: [
        { text: 'Background ', time: 5000, duration: 800, isBackground: true },
        { text: 'echo', time: 5800, duration: 700, isBackground: true },
      ],
    },
  ]

  const lines = parseLyricsPlusItems(items)
  assert.strictEqual(lines.length, 2)

  // First line
  assert.strictEqual(lines[0]?.startTimeMs, 1000)
  assert.strictEqual(lines[0]?.text, 'Hello world')
  assert.strictEqual(lines[0]?.isBackground, false)
  assert.strictEqual(lines[0]?.words?.length, 3)
  assert.strictEqual(lines[0]?.words?.[0]?.text, 'Hel')
  assert.strictEqual(lines[0]?.words?.[0]?.startTimeMs, 1000)
  assert.strictEqual(lines[0]?.words?.[0]?.endTimeMs, 1400)

  // Second line with background vocal
  assert.strictEqual(lines[1]?.startTimeMs, 5000)
  assert.strictEqual(lines[1]?.text, 'Background echo')
  assert.strictEqual(lines[1]?.isBackground, true)
})

test('LyricsPlusProvider: parseSyllableWords and parseLyricsPlusLrc handle embedded <mm:ss.xxx> syllables and {bg}', () => {
  const lrc = `
[00:02.50]{bg} <00:02.500>Ooh <00:03.000>yeah
[00:06.00] <00:06.000>Straight <00:06.500>to <00:07.000>the <00:07.400>heart
  `.trim()

  const lines = parseLyricsPlusLrc(lrc)
  assert.strictEqual(lines.length, 2)

  // First line: background vocal with syllables
  assert.strictEqual(lines[0]?.startTimeMs, 2500)
  assert.strictEqual(lines[0]?.isBackground, true)
  assert.strictEqual(lines[0]?.text, 'Ooh yeah')
  assert.strictEqual(lines[0]?.words?.length, 2)
  assert.strictEqual(lines[0]?.words?.[0]?.text, 'Ooh')
  assert.strictEqual(lines[0]?.words?.[0]?.startTimeMs, 2500)

  // Second line: normal synced line with syllables
  assert.strictEqual(lines[1]?.startTimeMs, 6000)
  assert.strictEqual(lines[1]?.isBackground, false)
  assert.strictEqual(lines[1]?.text, 'Straight to the heart')
  assert.strictEqual(lines[1]?.words?.length, 4)
  assert.strictEqual(lines[1]?.words?.[0]?.text, 'Straight')
  assert.strictEqual(lines[1]?.words?.[3]?.text, 'heart')
})

test('LyricsPlusProvider: fetchLyrics parses KPoe format with word timing and winning mirror promotion', async () => {
  resetLyricsPlusMetrics()
  const originalFetch = globalThis.fetch

  const mockResponse = {
    id: 999,
    trackName: 'Test Song',
    artistName: 'Test Artist',
    lyrics: [
      {
        time: 500,
        duration: 2000,
        text: 'Winning mirror lyrics',
        syllabus: [
          { text: 'Winning ', time: 500, duration: 600 },
          { text: 'mirror', time: 1100, duration: 700 },
        ],
      },
    ],
  }

  globalThis.fetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString()
    assert.ok(urlStr.includes('/v2/lyrics/get'))
    return new Response(JSON.stringify(mockResponse), { status: 200 })
  }) as typeof fetch

  try {
    const customServers = ['https://test-mirror-1.example.com', 'https://test-mirror-2.example.com']
    const result = await LyricsPlusProvider.fetchLyrics(
      'Test Song',
      'Test Artist',
      'Test Album',
      180,
      'yt-test',
      undefined,
      customServers,
    )

    assert.ok(result)
    assert.strictEqual(result.provider, 'LYRICS_PLUS')
    assert.strictEqual(result.isSynced, true)
    assert.strictEqual(result.isWordSynced, true)
    assert.strictEqual(result.lines.length, 1)
    assert.strictEqual(result.lines[0]?.text, 'Winning mirror lyrics')
    assert.strictEqual(result.lines[0]?.words?.length, 2)

    // Verify metrics and fast-path mirror promotion
    assert.strictEqual(getLastWorkingServer(), 'https://test-mirror-1.example.com')
    const metrics = getLyricsPlusMetrics()
    assert.strictEqual(metrics.totalRequests, 1)
    assert.strictEqual(metrics.successfulRequests, 1)
    assert.strictEqual(metrics.wordSyncedHits, 1)
    assert.strictEqual(metrics.lastWinningMirror, 'https://test-mirror-1.example.com')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('LyricsPlusProvider: fetchLyrics fails over across mirrors and promotes winning mirror', async () => {
  resetLyricsPlusMetrics()
  const originalFetch = globalThis.fetch
  const urlsAttempted: string[] = []

  const mockSyncedLrcResponse = {
    id: 100,
    syncedLyrics: '[00:03.00] Second mirror succeeded',
  }

  globalThis.fetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString()
    urlsAttempted.push(urlStr)

    // First mirror fails with 502 Bad Gateway
    if (urlStr.includes('bad-mirror.example.com')) {
      return new Response('Bad Gateway', { status: 502 })
    }

    // Second mirror succeeds
    if (urlStr.includes('good-mirror.example.com')) {
      return new Response(JSON.stringify(mockSyncedLrcResponse), { status: 200 })
    }

    return new Response('Not Found', { status: 404 })
  }) as typeof fetch

  try {
    const customServers = [
      'https://bad-mirror.example.com',
      'https://good-mirror.example.com',
      'https://unused-mirror.example.com',
    ]

    const result = await LyricsPlusProvider.fetchLyrics(
      'Failover Song',
      'Resilient Artist',
      undefined,
      200,
      undefined,
      undefined,
      customServers,
    )

    assert.ok(result)
    assert.strictEqual(result.provider, 'LYRICS_PLUS')
    assert.strictEqual(result.isSynced, true)
    assert.strictEqual(result.lines[0]?.text, 'Second mirror succeeded')

    // Confirm first failed and second was queried
    assert.strictEqual(urlsAttempted.length, 2)
    assert.ok(urlsAttempted[0]?.includes('bad-mirror'))
    assert.ok(urlsAttempted[1]?.includes('good-mirror'))

    // Fast-path winning mirror should now be good-mirror
    assert.strictEqual(getLastWorkingServer(), 'https://good-mirror.example.com')
    const prioritized = LyricsPlusProvider.getServers(customServers)
    assert.strictEqual(prioritized[0], 'https://good-mirror.example.com')

    const metrics = getLyricsPlusMetrics()
    assert.strictEqual(metrics.mirrorFailovers, 1)
    assert.strictEqual(metrics.successfulRequests, 1)
    assert.strictEqual(metrics.lineSyncedHits, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('LyricsPlusProvider: fetchLyrics returns plain lyrics when only plain text is available', async () => {
  resetLyricsPlusMetrics()
  const originalFetch = globalThis.fetch

  const mockPlainResponse = {
    plainLyrics: 'Line one\nLine two\nLine three',
  }

  globalThis.fetch = (async () => {
    return new Response(JSON.stringify(mockPlainResponse), { status: 200 })
  }) as typeof fetch

  try {
    const result = await LyricsPlusProvider.fetchLyrics(
      'Plain Song',
      'Plain Artist',
      undefined,
      120,
      undefined,
      undefined,
      ['https://plain-mirror.example.com'],
    )

    assert.ok(result)
    assert.strictEqual(result.provider, 'LYRICS_PLUS')
    assert.strictEqual(result.isSynced, false)
    assert.strictEqual(result.isWordSynced, false)
    assert.strictEqual(result.lines.length, 3)
    assert.strictEqual(result.lines[0]?.text, 'Line one')
    assert.strictEqual(result.lines[1]?.text, 'Line two')

    const metrics = getLyricsPlusMetrics()
    assert.strictEqual(metrics.plainHits, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('LyricsPlusProvider: fetchLyrics handles all mirrors failing gracefully', async () => {
  resetLyricsPlusMetrics()
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async () => {
    return new Response('404 Not Found', { status: 404 })
  }) as typeof fetch

  try {
    const result = await LyricsPlusProvider.fetchLyrics(
      'Nonexistent Song',
      'Unknown Artist',
      undefined,
      100,
      undefined,
      undefined,
      ['https://fail-1.example.com', 'https://fail-2.example.com'],
    )

    assert.strictEqual(result, null)
    const metrics = getLyricsPlusMetrics()
    assert.strictEqual(metrics.failedRequests, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
