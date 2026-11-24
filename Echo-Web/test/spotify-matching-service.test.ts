import test from 'node:test'
import assert from 'node:assert'

import {
  spotifyTrackTargetSchema,
  trackMatchSchema,
  matchingBatchOptionsSchema,
  spotifyMatchingMetricsSchema,
  getSpotifyMatchingMetrics,
  resetSpotifyMatchingMetrics,
  recordSpotifyMatchingMetric,
} from '../src/services/spotify/spotifyMatchingTypes.ts'

import {
  scoreCandidate,
  findBestTrackMatch,
  matchSingleTrack,
  matchTrackBatch,
  clearSpotifyMatchingCache,
  type SpotifyTrackTarget,
} from '../src/services/spotify/spotifyMatchingService.ts'

import type { Track } from '../src/types/domain.ts'

test('SpotifyMatchingService: spotifyTrackTargetSchema validates track inputs [SMALL-33]', () => {
  const valid = {
    title: 'Creep',
    artist: 'Radiohead',
    durationMs: 238000,
    isrc: 'GBAYE9200070',
  }
  assert.strictEqual(spotifyTrackTargetSchema.safeParse(valid).success, true)

  assert.strictEqual(spotifyTrackTargetSchema.safeParse({ title: '', artist: 'Radiohead' }).success, false)
  assert.strictEqual(spotifyTrackTargetSchema.safeParse({ title: 'Creep', artist: '' }).success, false)
})

test('SpotifyMatchingService: matchingBatchOptionsSchema clamps concurrency and timeout [SMALL-33]', () => {
  const def = matchingBatchOptionsSchema.parse({})
  assert.strictEqual(def.concurrency, 3)
  assert.strictEqual(def.timeoutMs, 8000)
  assert.strictEqual(def.minAcceptableScore, 45)

  assert.strictEqual(matchingBatchOptionsSchema.safeParse({ concurrency: 0 }).success, false)
  assert.strictEqual(matchingBatchOptionsSchema.safeParse({ concurrency: 20 }).success, false)
})

test('SpotifyMatchingService: telemetry metrics record match evaluation types [SMALL-33]', () => {
  resetSpotifyMatchingMetrics()
  const initial = getSpotifyMatchingMetrics()

  assert.strictEqual(initial.matchesEvaluated, 0)
  assert.strictEqual(initial.highConfidenceMatches, 0)
  assert.strictEqual(initial.isrcExactMatches, 0)
  assert.strictEqual(spotifyMatchingMetricsSchema.safeParse(initial).success, true)

  recordSpotifyMatchingMetric('matchesEvaluated')
  recordSpotifyMatchingMetric('highConfidenceMatches')
  recordSpotifyMatchingMetric('isrcExactMatches')

  const updated = getSpotifyMatchingMetrics()
  assert.strictEqual(updated.matchesEvaluated, 1)
  assert.strictEqual(updated.highConfidenceMatches, 1)
  assert.strictEqual(updated.isrcExactMatches, 1)

  resetSpotifyMatchingMetrics()
  assert.strictEqual(getSpotifyMatchingMetrics().matchesEvaluated, 0)
})

test('SpotifyMatchingService: matchSingleTrack uses candidate list and caches result [SMALL-33]', async () => {
  clearSpotifyMatchingCache()
  resetSpotifyMatchingMetrics()

  const target: SpotifyTrackTarget = {
    title: 'Paranoid Android',
    artist: 'Radiohead',
    durationMs: 383000,
  }

  const candidate: Track = {
    id: 't-pa-1',
    title: 'Paranoid Android',
    artistName: 'Radiohead',
    durationSeconds: 383,
  } as Track

  const match1 = await matchSingleTrack(target, { candidates: [candidate] })
  assert.ok(match1 !== null)
  assert.strictEqual(match1.track.id, 't-pa-1')
  assert.strictEqual(match1.confidence, 'high')

  // Second evaluation reads from cache
  const match2 = await matchSingleTrack(target, { candidates: [candidate] })
  assert.ok(match2 !== null)
  assert.strictEqual(match2.track.id, 't-pa-1')
  assert.strictEqual(getSpotifyMatchingMetrics().cacheHits, 1)

  clearSpotifyMatchingCache()
})

test('SpotifyMatchingService: matchTrackBatch processes multiple targets with progress updates [SMALL-33]', async () => {
  clearSpotifyMatchingCache()
  resetSpotifyMatchingMetrics()

  const targets: SpotifyTrackTarget[] = [
    { title: 'Song A', artist: 'Artist A', durationMs: 200000 },
    { title: 'Song B', artist: 'Artist B', durationMs: 210000 },
  ]

  const candidateA: Track = { id: 'c-a', title: 'Song A', artistName: 'Artist A', durationSeconds: 200 } as Track
  const candidateB: Track = { id: 'c-b', title: 'Song B', artistName: 'Artist B', durationSeconds: 210 } as Track

  const progressUpdates: number[] = []

  const { matchedTracks, unmatchedTitles } = await matchTrackBatch(targets, {
    onProgress: (p) => {
      progressUpdates.push(p.current)
    },
    candidateProvider: async (target) => {
      return target.title === 'Song A' ? [candidateA] : [candidateB]
    },
    concurrency: 2,
  })

  assert.strictEqual(matchedTracks.length, 2)
  assert.strictEqual(unmatchedTitles.length, 0)
  assert.strictEqual(progressUpdates.length, 2)
  clearSpotifyMatchingCache()
})

test('SpotifyMatchingService: matchTrackBatch respects cancellation via AbortSignal [SMALL-33]', async () => {
  clearSpotifyMatchingCache()

  const targets: SpotifyTrackTarget[] = [
    { title: 'Track 1', artist: 'Artist 1' },
    { title: 'Track 2', artist: 'Artist 2' },
  ]

  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    matchTrackBatch(targets, { signal: controller.signal }),
    (err: Error) => err.name === 'AbortError',
  )
})
