import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'

import {
  spotifyUrlInputSchema,
  spotifyResolvedDataSchema,
  spotifyUrlMetricsSchema,
  getSpotifyUrlMetrics,
  resetSpotifyUrlMetrics,
  recordSpotifyUrlMetric,
} from '../src/services/spotify/spotifyUrlTypes.ts'

import {
  resolveSpotifyUrl,
  clearSpotifyResolveCache,
  isSpotifyUrl,
} from '../src/services/spotify/spotifyImporter.ts'

test('SpotifyUrl: spotifyUrlInputSchema validates standard and international playlist/album/track URLs [SMALL-32]', () => {
  assert.strictEqual(
    spotifyUrlInputSchema.safeParse('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M').success,
    true,
  )
  assert.strictEqual(
    spotifyUrlInputSchema.safeParse('https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy').success,
    true,
  )
  assert.strictEqual(
    spotifyUrlInputSchema.safeParse('https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl').success,
    true,
  )
  assert.strictEqual(
    spotifyUrlInputSchema.safeParse('https://open.spotify.com/intl-es/playlist/37i9dQZF1DXcBWIGoYBM5M').success,
    true,
  )
  assert.strictEqual(
    spotifyUrlInputSchema.safeParse('https://spotify.link/AbCdEf123').success,
    true,
  )

  // Rejects invalid schemes, non-Spotify domains, empty paths
  assert.strictEqual(spotifyUrlInputSchema.safeParse('https://example.com/playlist/123').success, false)
  assert.strictEqual(spotifyUrlInputSchema.safeParse('https://open.spotify.com/').success, false)
  assert.strictEqual(spotifyUrlInputSchema.safeParse('not a url').success, false)
  assert.strictEqual(spotifyUrlInputSchema.safeParse('').success, false)
})

test('SpotifyUrl: isSpotifyUrl correctly identifies valid URLs [SMALL-32]', () => {
  assert.strictEqual(isSpotifyUrl('https://open.spotify.com/playlist/12345abcde'), true)
  assert.strictEqual(isSpotifyUrl('https://malicious-site.com/playlist/12345'), false)
})

test('SpotifyUrl: spotifyResolvedDataSchema validates complete and partial payloads [SMALL-32]', () => {
  const valid = {
    title: 'Top Hits 2026',
    description: 'The hottest tracks right now',
    coverUrl: 'https://images.example.com/cover.jpg',
    totalTracks: 50,
    offset: 0,
    limit: 100,
    hasMore: false,
    tracks: [
      {
        title: 'Song One',
        artist: 'Artist One',
        album: 'Album One',
        durationMs: 180000,
        isrc: 'USUM71234567',
      },
    ],
  }
  assert.strictEqual(spotifyResolvedDataSchema.safeParse(valid).success, true)

  assert.strictEqual(spotifyResolvedDataSchema.safeParse({ invalid: 'payload' }).success, false)
})

test('SpotifyUrl: telemetry metrics record activity and reset cleanly [SMALL-32]', () => {
  resetSpotifyUrlMetrics()
  const initial = getSpotifyUrlMetrics()

  assert.strictEqual(initial.resolutionsRequested, 0)
  assert.strictEqual(initial.resolutionsCached, 0)
  assert.strictEqual(initial.resolutionsSucceeded, 0)
  assert.strictEqual(initial.resolutionsFailed, 0)
  assert.strictEqual(initial.inFlightDeduplications, 0)
  assert.strictEqual(initial.retries, 0)
  assert.strictEqual(initial.cancellations, 0)
  assert.strictEqual(spotifyUrlMetricsSchema.safeParse(initial).success, true)

  recordSpotifyUrlMetric('resolutionsRequested')
  recordSpotifyUrlMetric('resolutionsCached')
  recordSpotifyUrlMetric('resolutionsSucceeded')
  recordSpotifyUrlMetric('inFlightDeduplications')

  const updated = getSpotifyUrlMetrics()
  assert.strictEqual(updated.resolutionsRequested, 1)
  assert.strictEqual(updated.resolutionsCached, 1)
  assert.strictEqual(updated.resolutionsSucceeded, 1)
  assert.strictEqual(updated.inFlightDeduplications, 1)

  resetSpotifyUrlMetrics()
  assert.strictEqual(getSpotifyUrlMetrics().resolutionsRequested, 0)
})

test('SpotifyUrl: resolveSpotifyUrl handles in-flight coalescing and LRU caching [SMALL-32]', async () => {
  clearSpotifyResolveCache()
  resetSpotifyUrlMetrics()

  const originalFetch = globalThis.fetch
  let fetchCount = 0

  globalThis.fetch = async () => {
    fetchCount++
    await new Promise((r) => setTimeout(r, 20))
    return {
      ok: true,
      json: async () => ({
        title: 'Mock Playlist',
        description: 'Mock Description',
        tracks: [
          {
            title: 'Mock Track',
            artist: 'Mock Artist',
          },
        ],
      }),
    } as unknown as Response
  }

  try {
    const testUrl = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'

    // Concurrent resolutions coalesce into 1 network call
    const [res1, res2] = await Promise.all([
      resolveSpotifyUrl(testUrl),
      resolveSpotifyUrl(testUrl),
    ])

    assert.strictEqual(fetchCount, 1)
    assert.strictEqual(res1.title, 'Mock Playlist')
    assert.strictEqual(res2.title, 'Mock Playlist')
    assert.strictEqual(getSpotifyUrlMetrics().inFlightDeduplications, 1)

    // Third call reads from LRU cache
    const res3 = await resolveSpotifyUrl(testUrl)
    assert.strictEqual(fetchCount, 1)
    assert.strictEqual(res3.title, 'Mock Playlist')
    assert.strictEqual(getSpotifyUrlMetrics().resolutionsCached, 1)
  } finally {
    globalThis.fetch = originalFetch
    clearSpotifyResolveCache()
  }
})

test('SpotifyUrl: cancellation via AbortSignal cancels request cleanly [SMALL-32]', async () => {
  clearSpotifyResolveCache()
  resetSpotifyUrlMetrics()

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    return new Promise((resolve, reject) => {
      const signal = init?.signal
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'))
      })
    })
  }

  try {
    const controller = new AbortController()
    const testUrl = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'

    const promise = resolveSpotifyUrl(testUrl, { signal: controller.signal, skipRetry: true })
    controller.abort()

    await assert.rejects(promise)
    assert.strictEqual(getSpotifyUrlMetrics().cancellations, 1)
  } finally {
    globalThis.fetch = originalFetch
    clearSpotifyResolveCache()
  }
})

test('SpotifyUrl: component source enforces accessible dialog, progressbar, touch targets, and offline awareness [SMALL-32]', () => {
  const code = fs.readFileSync('src/components/modals/SpotifyImportModal.tsx', 'utf8')

  // Accessible dialog role and title
  assert.ok(code.includes('role="dialog"'), 'Must have role="dialog"')
  assert.ok(code.includes('aria-modal="true"'), 'Must have aria-modal="true"')
  assert.ok(code.includes('aria-labelledby="spotify-import-modal-title"'), 'Must have aria-labelledby')

  // Accessible progressbar
  assert.ok(code.includes('role="progressbar"'), 'Must have role="progressbar"')
  assert.ok(code.includes('aria-valuenow'), 'Must have aria-valuenow')

  // Minimum touch target sizing (44x44px)
  assert.ok(code.includes('min-h-[44px]'), 'Must support accessible min 44px touch targets')
  assert.ok(code.includes('min-w-[44px]'), 'Must support accessible min 44px touch targets')

  // Offline status tracking & alert
  assert.ok(code.includes('isOffline'), 'Must track offline state')
  assert.ok(code.includes('role="alert"'), 'Must announce errors via role="alert"')

  // Keyboard navigation: Enter key in input
  assert.ok(code.includes("e.key === 'Enter'"), 'Must handle Enter key to trigger import')
})
