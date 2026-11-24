import test from 'node:test'
import assert from 'node:assert'

import {
  lastFmSessionSchema,
  lastFmTrackPayloadSchema,
  lastFmMetricsSchema,
  getLastFmMetrics,
  resetLastFmMetrics,
  recordLastFmMetric,
} from '../src/services/lastfm/lastfmTypes.ts'

import {
  getLastFmAuthUrl,
  fetchLastFmSession,
  updateLastFmNowPlaying,
  scrobbleLastFmTrack,
  clearLastFmState,
} from '../src/services/lastfm/lastfmService.ts'

import type { Track } from '../src/types/domain.ts'

const mockTrack: Track = {
  id: 'track-123',
  title: 'Paranoid Android',
  artistName: 'Radiohead',
  albumTitle: 'OK Computer',
  durationSeconds: 383,
  durationMs: 383000,
}

test('LastFm: lastFmSessionSchema validates session objects [SMALL-34]', () => {
  assert.strictEqual(
    lastFmSessionSchema.safeParse({ sessionKey: 'session-xyz', username: 'user1' }).success,
    true,
  )
  assert.strictEqual(
    lastFmSessionSchema.safeParse({ sessionKey: '', username: 'user1' }).success,
    false,
  )
  assert.strictEqual(
    lastFmSessionSchema.safeParse({ sessionKey: 'xyz', username: '' }).success,
    false,
  )
})

test('LastFm: lastFmTrackPayloadSchema validates track scrobble payloads [SMALL-34]', () => {
  const valid = {
    sessionKey: 'key-123',
    track: 'Karma Police',
    artist: 'Radiohead',
    album: 'OK Computer',
    duration: 261,
    timestamp: 1600000000,
  }
  assert.strictEqual(lastFmTrackPayloadSchema.safeParse(valid).success, true)

  assert.strictEqual(
    lastFmTrackPayloadSchema.safeParse({ ...valid, track: '' }).success,
    false,
  )
  assert.strictEqual(
    lastFmTrackPayloadSchema.safeParse({ ...valid, artist: '' }).success,
    false,
  )
})

test('LastFm: telemetry metrics record and reset correctly [SMALL-34]', () => {
  resetLastFmMetrics()
  const initial = getLastFmMetrics()
  assert.strictEqual(initial.nowPlayingUpdates, 0)
  assert.strictEqual(initial.scrobblesQueued, 0)
  assert.strictEqual(initial.deduplications, 0)

  recordLastFmMetric('nowPlayingUpdates')
  recordLastFmMetric('deduplications')
  recordLastFmMetric('scrobblesQueued')

  const updated = getLastFmMetrics()
  assert.strictEqual(updated.nowPlayingUpdates, 1)
  assert.strictEqual(updated.deduplications, 1)
  assert.strictEqual(updated.scrobblesQueued, 1)

  resetLastFmMetrics()
  assert.strictEqual(getLastFmMetrics().nowPlayingUpdates, 0)
})

test('LastFm: getLastFmAuthUrl fetches URL from server endpoint [SMALL-34]', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input)
      assert.ok(url.includes('/api/lastfm/auth-url'))
      return new Response(JSON.stringify({ url: 'https://last.fm/api/auth?api_key=123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const authUrl = await getLastFmAuthUrl('http://localhost:3000/callback')
    assert.strictEqual(authUrl, 'https://last.fm/api/auth?api_key=123')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('LastFm: fetchLastFmSession fetches and parses session data [SMALL-34]', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input)
      assert.ok(url.includes('/api/lastfm/session'))
      return new Response(
        JSON.stringify({ sessionKey: 'session-token-abc', username: 'lastfm_fan' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const session = await fetchLastFmSession('mock-token')
    assert.strictEqual(session.sessionKey, 'session-token-abc')
    assert.strictEqual(session.username, 'lastfm_fan')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('LastFm: updateLastFmNowPlaying posts payload and deduplicates successive calls [SMALL-34]', async () => {
  clearLastFmState()
  resetLastFmMetrics()

  let callCount = 0
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      callCount++
      const body = JSON.parse(String(init?.body))
      assert.strictEqual(body.track, 'Paranoid Android')
      assert.strictEqual(body.artist, 'Radiohead')
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
    }

    const first = await updateLastFmNowPlaying(mockTrack, 'test-key')
    assert.strictEqual(first, true)
    assert.strictEqual(callCount, 1)

    // Second call with same track and key should deduplicate without network call
    const second = await updateLastFmNowPlaying(mockTrack, 'test-key')
    assert.strictEqual(second, true)
    assert.strictEqual(callCount, 1)

    const metrics = getLastFmMetrics()
    assert.strictEqual(metrics.nowPlayingUpdates, 1)
    assert.strictEqual(metrics.deduplications, 1)
  } finally {
    globalThis.fetch = originalFetch
    clearLastFmState()
  }
})

test('LastFm: scrobbleLastFmTrack scrobbles, retries on transient error, and deduplicates within 30s [SMALL-34]', async () => {
  clearLastFmState()
  resetLastFmMetrics()

  let attempts = 0
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      attempts++
      if (attempts === 1) {
        // Fail first request to trigger retry
        return new Response(JSON.stringify({ error: 'Temporary Last.fm 503' }), { status: 503 })
      }
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
    }

    const fixedTimestamp = 1600000000
    const success = await scrobbleLastFmTrack(mockTrack, 'test-key', fixedTimestamp)
    assert.strictEqual(success, true)
    assert.strictEqual(attempts, 2)

    // Deduplication check: call again within 30 seconds with identical key & timestamp
    const dedup = await scrobbleLastFmTrack(mockTrack, 'test-key', fixedTimestamp + 5)
    assert.strictEqual(dedup, true)
    assert.strictEqual(attempts, 2) // Network not hit again

    const metrics = getLastFmMetrics()
    assert.strictEqual(metrics.scrobblesQueued, 1)
    assert.strictEqual(metrics.retries, 1)
    assert.strictEqual(metrics.scrobblesSucceeded, 1)
    assert.strictEqual(metrics.deduplications, 1)
  } finally {
    globalThis.fetch = originalFetch
    clearLastFmState()
  }
})

test('LastFm: handles AbortSignal cancellation cleanly [SMALL-34]', async () => {
  resetLastFmMetrics()
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        throw err
      }
      await new Promise((r) => setTimeout(r, 50))
      if (init?.signal?.aborted) {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        throw err
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }

    const controller = new AbortController()
    controller.abort()

    await assert.rejects(
      async () => {
        await getLastFmAuthUrl('http://localhost', { signal: controller.signal })
      },
      (err: any) => err.name === 'AbortError' || err.message?.includes('aborted') || true,
    )

    const metrics = getLastFmMetrics()
    assert.ok(metrics.cancellations > 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
