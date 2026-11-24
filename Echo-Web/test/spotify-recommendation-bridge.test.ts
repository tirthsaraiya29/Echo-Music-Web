import test from 'node:test'
import assert from 'node:assert'
import {
  recordSpotifyTasteSignals,
  getSpotifyTasteProfile,
  setSpotifyBridgeEnabled,
  clearSpotifyTasteProfile,
  getSpotifyArtistWeights,
  applySpotifyAffinityBonus,
  getSpotifySeedQueries,
  getSpotifyBridgeTelemetry,
  resetSpotifyBridgeTelemetry,
  spotifyTasteProfileSchema,
} from '../src/services/spotify/spotifyRecommendationBridge.ts'
import {
  calculateTasteScore,
  type ScoredTrack,
} from '../src/services/recommendations/localTasteEngine.ts'
import type { ListeningHistoryRecord } from '../src/services/db/echoDatabase.ts'

function createHistoryItem(trackId: string, artistName: string, title: string): ListeningHistoryRecord {
  return {
    trackId,
    trackTitle: title,
    artistName,
    artistId: `artist-${artistName.toLowerCase().replace(/\s+/g, '-')}`,
    albumTitle: `${title} Album`,
    artwork: 'https://example.com/art.jpg',
    playedAt: Date.now() - 5000,
    durationPlayedMs: 180000,
    trackDurationMs: 180000,
    completed: true,
    skipped: false,
    timeOfDay: 'morning',
  }
}

test('Spotify recommendation bridge: ingests tracks, computes artist weights, and generates seed queries', async () => {
  resetSpotifyBridgeTelemetry()
  await clearSpotifyTasteProfile()

  const sampleTracks = [
    { title: 'Anti-Hero', artistName: 'Taylor Swift' },
    { title: 'Cruel Summer', artistName: 'Taylor Swift' },
    { title: 'Cardigan', artistName: 'Taylor Swift' },
    { title: 'Blinding Lights', artistName: 'The Weeknd' },
    { title: 'Starboy', artistName: 'The Weeknd' },
    { title: 'Levitating', artistName: 'Dua Lipa' },
  ]

  const profile = await recordSpotifyTasteSignals(sampleTracks, { sourcePlaylist: 'Pop Hits' })

  // Conforms to schema
  assert.doesNotThrow(() => spotifyTasteProfileSchema.parse(profile))

  assert.strictEqual(profile.totalTracksIndexed, 6)
  assert.strictEqual(profile.artists.length, 3)

  const taylor = profile.artists.find((a) => a.normalizedName === 'taylor swift')
  assert.ok(taylor)
  assert.strictEqual(taylor.count, 3)
  assert.ok(taylor.weight > 1.0)

  // Seed queries
  assert.ok(profile.seedQueries.some((q) => q.includes('Taylor Swift')))
  assert.ok(profile.seedQueries.some((q) => q.includes('The Weeknd')))

  const telemetry = getSpotifyBridgeTelemetry()
  assert.strictEqual(telemetry.signalsIngested, 6)
  assert.ok(telemetry.seedQueriesGenerated > 0)
  assert.ok(telemetry.lastSyncTimestamp !== null)
})

test('Spotify recommendation bridge: applies affinity bonus to matching tracks and updates telemetry', async () => {
  await setSpotifyBridgeEnabled(true)

  const sampleTracks: ScoredTrack[] = [
    {
      trackId: 't1',
      trackTitle: 'Song 1',
      artistName: 'Taylor Swift',
      durationSeconds: 200,
      score: 10.0,
      lastPlayedAt: Date.now(),
      playCount: 1,
    },
    {
      trackId: 't2',
      trackTitle: 'Song 2',
      artistName: 'Random Unknown Artist',
      durationSeconds: 180,
      score: 10.0,
      lastPlayedAt: Date.now(),
      playCount: 1,
    },
  ]

  const boosted = applySpotifyAffinityBonus(sampleTracks)
  const taylorTrack = boosted.find((t) => t.trackId === 't1')
  const unknownTrack = boosted.find((t) => t.trackId === 't2')

  assert.ok(taylorTrack)
  assert.ok(unknownTrack)
  assert.ok(taylorTrack.score > 10.0, 'Expected Taylor Swift track to receive Spotify affinity boost')
  assert.strictEqual(unknownTrack.score, 10.0, 'Expected unindexed artist to retain base score')

  const telemetry = getSpotifyBridgeTelemetry()
  assert.ok(telemetry.boostedTracksCount > 0)
})

test('Spotify recommendation bridge: respect enabled toggle and clears signals cleanly', async () => {
  await setSpotifyBridgeEnabled(false)

  const weights = getSpotifyArtistWeights()
  assert.strictEqual(weights.size, 0, 'Disabled bridge should yield empty weights map')

  const seeds = getSpotifySeedQueries()
  assert.strictEqual(seeds.length, 0, 'Disabled bridge should yield empty seed queries')

  // Re-enable and clear
  await setSpotifyBridgeEnabled(true)
  await clearSpotifyTasteProfile()

  const profile = await getSpotifyTasteProfile()
  assert.strictEqual(profile.totalTracksIndexed, 0)
  assert.strictEqual(profile.artists.length, 0)
  assert.strictEqual(profile.seedQueries.length, 0)
})

test('Spotify recommendation bridge: integrates with calculateTasteScore', () => {
  const history: ListeningHistoryRecord[] = [
    createHistoryItem('tr-1', 'Daft Punk', 'One More Time'),
    createHistoryItem('tr-2', 'Unknown Indie', 'Track B'),
  ]

  const spotifyWeights = new Map<string, number>([['daft punk', 2.5]])

  const scored = calculateTasteScore(
    history,
    new Set(),
    new Set(),
    Date.now(),
    'morning',
    spotifyWeights,
  )

  const daftPunkScored = scored.find((s) => s.artistName === 'Daft Punk')
  const indieScored = scored.find((s) => s.artistName === 'Unknown Indie')

  assert.ok(daftPunkScored)
  assert.ok(indieScored)
  assert.ok(
    daftPunkScored.score > indieScored.score,
    `Expected Daft Punk (${daftPunkScored.score}) to score higher than Indie (${indieScored.score}) due to Spotify bridge bonus`,
  )
})
