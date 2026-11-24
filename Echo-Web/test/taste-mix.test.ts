import test from 'node:test'
import assert from 'node:assert'
import {
  buildTasteMix,
  getDailyTasteMix,
  clearTasteMixCache,
  getTasteMixTelemetry,
  resetTasteMixTelemetry,
  tasteMixSchema,
  getTodayDateKey,
} from '../src/services/recommendations/tasteMixService.ts'
import type { ListeningHistoryRecord } from '../src/services/db/echoDatabase.ts'
import type { Track } from '../src/types/domain.ts'

function createMockTrack(id: string, artistName: string, title: string): Track {
  return {
    id,
    title,
    artistName,
    artistId: `artist-${artistName.toLowerCase().replace(/\s+/g, '-')}`,
    albumId: `album-${id}`,
    albumTitle: `${title} Album`,
    albumImage: 'https://example.com/art.jpg',
    artwork: 'https://example.com/art.jpg',
    thumbnailUrl: 'https://example.com/art.jpg',
    durationSeconds: 200,
    durationMs: 200000,
    explicit: false,
    playCount: 1,
    videoId: id,
    streamUrl: `https://cdn.example.com/audio/${id}.mp3`,
  }
}

function createHistoryRecord(
  trackId: string,
  artistName: string,
  title: string,
  playedAt: number,
  options: { completed?: boolean; skipped?: boolean; durationPlayedMs?: number } = {},
): ListeningHistoryRecord {
  return {
    trackId,
    trackTitle: title,
    artistName,
    artistId: `artist-${artistName.toLowerCase().replace(/\s+/g, '-')}`,
    albumTitle: `${title} Album`,
    artwork: 'https://example.com/art.jpg',
    playedAt,
    durationPlayedMs: options.durationPlayedMs ?? 180000,
    trackDurationMs: 180000,
    completed: options.completed ?? true,
    skipped: options.skipped ?? false,
    timeOfDay: 'morning',
  }
}

test('buildTasteMix: generates a balanced mix with high-affinity and discovery tracks', () => {
  const now = 1700000000000
  const history: ListeningHistoryRecord[] = [
    createHistoryRecord('track-1', 'Artist A', 'Song 1', now - 10000, { completed: true }),
    createHistoryRecord('track-2', 'Artist A', 'Song 2', now - 20000, { completed: true }),
    createHistoryRecord('track-3', 'Artist B', 'Song 3', now - 30000, { completed: true }),
    createHistoryRecord('track-4', 'Artist C', 'Song 4', now - 40000, { completed: true }),
  ]

  const catalogFallback: Track[] = [
    createMockTrack('disc-1', 'Artist D', 'Discovery 1'),
    createMockTrack('disc-2', 'Artist E', 'Discovery 2'),
    createMockTrack('disc-3', 'Artist F', 'Discovery 3'),
  ]

  const likedTrackIds = new Set(['track-1'])
  const exclusions = new Set<string>()

  const mix = buildTasteMix({
    history,
    likedTrackIds,
    exclusions,
    catalogFallback,
    now,
    targetCount: 5,
  })

  // Must conform to schema
  assert.doesNotThrow(() => tasteMixSchema.parse(mix))

  assert.strictEqual(mix.isFallback, false)
  assert.ok(mix.tracks.length > 0)
  assert.ok(mix.tracks.some((t) => t.id === 'track-1'))
  assert.ok(mix.stats.topArtists.includes('Artist A'))
  assert.ok(mix.stats.favoritesRatio > 0)
  assert.ok(mix.stats.totalDurationSeconds > 0)
})

test('buildTasteMix: strictly filters out excluded tracks', () => {
  const now = 1700000000000
  const history: ListeningHistoryRecord[] = [
    createHistoryRecord('track-excluded', 'Artist X', 'Excluded Song', now - 5000),
    createHistoryRecord('track-allowed', 'Artist Y', 'Allowed Song', now - 6000),
    createHistoryRecord('track-allowed-2', 'Artist Z', 'Allowed Song 2', now - 7000),
    createHistoryRecord('track-allowed-3', 'Artist W', 'Allowed Song 3', now - 8000),
  ]

  const exclusions = new Set(['track-excluded', 'disc-excluded'])
  const catalogFallback: Track[] = [
    createMockTrack('disc-excluded', 'Artist Discard', 'Disc Excluded'),
    createMockTrack('disc-allowed', 'Artist Fresh', 'Disc Allowed'),
  ]

  const mix = buildTasteMix({
    history,
    likedTrackIds: new Set(),
    exclusions,
    catalogFallback,
    now,
    targetCount: 4,
  })

  assert.strictEqual(mix.tracks.some((t) => t.id === 'track-excluded'), false)
  assert.strictEqual(mix.tracks.some((t) => t.id === 'disc-excluded'), false)
  assert.ok(mix.tracks.some((t) => t.id === 'track-allowed'))
})

test('buildTasteMix: enforces artist diversity constraints', () => {
  const now = 1700000000000
  // 5 songs from the same artist
  const history: ListeningHistoryRecord[] = [
    createHistoryRecord('t1', 'Super Artist', 'Song 1', now - 1000),
    createHistoryRecord('t2', 'Super Artist', 'Song 2', now - 2000),
    createHistoryRecord('t3', 'Super Artist', 'Song 3', now - 3000),
    createHistoryRecord('t4', 'Super Artist', 'Song 4', now - 4000),
    createHistoryRecord('t5', 'Super Artist', 'Song 5', now - 5000),
    createHistoryRecord('t6', 'Other Artist', 'Song 6', now - 6000),
    createHistoryRecord('t7', 'Third Artist', 'Song 7', now - 7000),
  ]

  const catalogFallback: Track[] = [
    createMockTrack('c1', 'Fourth Artist', 'Catalog 1'),
    createMockTrack('c2', 'Fifth Artist', 'Catalog 2'),
  ]

  const mix = buildTasteMix({
    history,
    likedTrackIds: new Set(),
    exclusions: new Set(),
    catalogFallback,
    now,
    targetCount: 6,
    maxPerArtist: 2,
  })

  const superArtistTracks = mix.tracks.filter((t) => t.artistName === 'Super Artist')
  assert.ok(superArtistTracks.length <= 2, `Expected at most 2 tracks for Super Artist, got ${superArtistTracks.length}`)
})

test('buildTasteMix: handles new users with empty history via catalog fallback', () => {
  const now = 1700000000000
  const catalogFallback: Track[] = [
    createMockTrack('c1', 'Artist 1', 'Track 1'),
    createMockTrack('c2', 'Artist 2', 'Track 2'),
    createMockTrack('c3', 'Artist 3', 'Track 3'),
  ]

  const mix = buildTasteMix({
    history: [],
    likedTrackIds: new Set(),
    exclusions: new Set(),
    catalogFallback,
    now,
    targetCount: 3,
  })

  assert.strictEqual(mix.isFallback, true)
  assert.strictEqual(mix.tracks.length, 3)
  assert.ok(mix.description.includes('Starter Taste Mix'))
})

test('getDailyTasteMix: caches daily mix and handles forceRefresh and telemetry', async () => {
  resetTasteMixTelemetry()
  await clearTasteMixCache()

  const fallbackTracks: Track[] = [
    createMockTrack('t1', 'Artist A', 'Track 1'),
    createMockTrack('t2', 'Artist B', 'Track 2'),
  ]

  const fixedDate = new Date(2026, 10, 24) // 2026-11-24
  const expectedDateKey = getTodayDateKey(fixedDate)

  // 1. Initial generation
  const mix1 = await getDailyTasteMix({
    catalogFallback: fallbackTracks,
    date: fixedDate,
  })

  assert.strictEqual(mix1.dateKey, expectedDateKey)
  let telemetry = getTasteMixTelemetry()
  assert.strictEqual(telemetry.mixesGenerated, 1)
  assert.strictEqual(telemetry.cacheHits, 0)

  // 2. Second retrieval on same date should hit cache
  const mix2 = await getDailyTasteMix({
    catalogFallback: fallbackTracks,
    date: fixedDate,
  })

  assert.strictEqual(mix2.id, mix1.id)
  telemetry = getTasteMixTelemetry()
  assert.strictEqual(telemetry.cacheHits, 1)
  assert.strictEqual(telemetry.mixesGenerated, 1)

  // 3. Force refresh should bypass cache
  const mix3 = await getDailyTasteMix({
    catalogFallback: fallbackTracks,
    date: fixedDate,
    forceRefresh: true,
  })

  assert.strictEqual(mix3.dateKey, expectedDateKey)
  telemetry = getTasteMixTelemetry()
  assert.strictEqual(telemetry.refreshesTriggered, 1)
  assert.strictEqual(telemetry.mixesGenerated, 2)

  // 4. AbortSignal cancellation
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    async () => {
      await getDailyTasteMix({
        catalogFallback: fallbackTracks,
        date: fixedDate,
        signal: controller.signal,
      })
    },
    /cancelled/i,
  )
})
