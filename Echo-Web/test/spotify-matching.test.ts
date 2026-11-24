import test from 'node:test'
import assert from 'node:assert'
import {
  scoreCandidate,
  findBestTrackMatch,
  MIN_ACCEPTABLE_SCORE,
  type SpotifyTrackTarget,
} from '../src/services/spotify/spotifyImporter.ts'
import type { Track } from '../src/types/domain.ts'

test('Spotify Matching: exact title, artist, and duration scores high confidence [BUG-23]', () => {
  const target: SpotifyTrackTarget = {
    title: 'Karma Police',
    artist: 'Radiohead',
    durationMs: 264000, // 4m 24s
  }

  const exactCandidate: Track = {
    id: 'track-exact',
    title: 'Karma Police',
    artistName: 'Radiohead',
    durationSeconds: 264,
  }

  const score = scoreCandidate(target, exactCandidate)
  assert.ok(score >= 80, `Expected score >= 80, got ${score}`)

  const best = findBestTrackMatch(target, [exactCandidate])
  assert.ok(best !== null)
  assert.strictEqual(best.track.id, 'track-exact')
  assert.strictEqual(best.confidence, 'high')
})

test('Spotify Matching: prioritizes original over remix and live version [BUG-23]', () => {
  const target: SpotifyTrackTarget = {
    title: 'Levitating',
    artist: 'Dua Lipa',
    durationMs: 203000, // ~3m 23s
  }

  const remixCandidate: Track = {
    id: 'track-remix',
    title: 'Levitating (feat. DaBaby) [Don Diablo Remix]',
    artistName: 'Dua Lipa',
    durationSeconds: 240,
  }

  const liveCandidate: Track = {
    id: 'track-live',
    title: 'Levitating (Live at the BRIT Awards 2021)',
    artistName: 'Dua Lipa',
    durationSeconds: 215,
  }

  const originalCandidate: Track = {
    id: 'track-original',
    title: 'Levitating',
    artistName: 'Dua Lipa',
    durationSeconds: 203,
  }

  // When search returns remix as first item, original should still be picked
  const candidates = [remixCandidate, liveCandidate, originalCandidate]
  const match = findBestTrackMatch(target, candidates)

  assert.ok(match !== null)
  assert.strictEqual(match.track.id, 'track-original')
  assert.ok(match.score > scoreCandidate(target, remixCandidate))
  assert.ok(match.score > scoreCandidate(target, liveCandidate))
})

test('Spotify Matching: rejects candidate below minimum threshold instead of false match [BUG-23]', () => {
  const target: SpotifyTrackTarget = {
    title: 'Clair de Lune',
    artist: 'Claude Debussy',
    durationMs: 300000,
  }

  const completelyDifferentSong: Track = {
    id: 'track-wrong',
    title: 'Moonlight Sonata',
    artistName: 'Ludwig van Beethoven',
    durationSeconds: 360,
  }

  const score = scoreCandidate(target, completelyDifferentSong)
  assert.ok(score < MIN_ACCEPTABLE_SCORE, `Expected score < ${MIN_ACCEPTABLE_SCORE}, got ${score}`)

  const match = findBestTrackMatch(target, [completelyDifferentSong])
  assert.strictEqual(match, null, 'Should return null when candidate score is below acceptable threshold')
})

test('Spotify Matching: matches immediately on matching ISRC [BUG-23]', () => {
  const target: SpotifyTrackTarget = {
    title: 'Starboy',
    artist: 'The Weeknd',
    isrc: 'USUG11601729',
  }

  const candidateWithIsrc: Track = {
    id: 'track-isrc',
    title: 'Starboy (Album Version)',
    artistName: 'The Weeknd feat. Daft Punk',
    isrc: 'USUG11601729',
  }

  const score = scoreCandidate(target, candidateWithIsrc)
  assert.strictEqual(score, 100)

  const match = findBestTrackMatch(target, [candidateWithIsrc])
  assert.ok(match !== null)
  assert.strictEqual(match.confidence, 'high')
})
