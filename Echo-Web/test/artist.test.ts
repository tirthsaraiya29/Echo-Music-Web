import test from 'node:test'
import assert from 'node:assert'
import {
  artistIdInputSchema,
  artistDetailSchema,
  artistMetricsSchema,
  getArtistMetrics,
  resetArtistMetrics,
} from '../src/hooks/useArtist.ts'

test('Artist: artistIdInputSchema validates browse IDs and rejects malformed values', () => {
  const valid = artistIdInputSchema.safeParse('UC_x5XG1OV2P6uZZ5FSM9Ttw')
  assert.strictEqual(valid.success, true)
  if (valid.success) {
    assert.strictEqual(valid.data, 'UC_x5XG1OV2P6uZZ5FSM9Ttw')
  }

  // Whitespace trimming
  const withWhitespace = artistIdInputSchema.safeParse('  UC_trimmed_artist  ')
  assert.strictEqual(withWhitespace.success, true)
  if (withWhitespace.success) {
    assert.strictEqual(withWhitespace.data, 'UC_trimmed_artist')
  }

  // Empty or whitespace-only strings
  assert.strictEqual(artistIdInputSchema.safeParse('').success, false)
  assert.strictEqual(artistIdInputSchema.safeParse('    ').success, false)

  // Oversized ID exceeding 256 chars
  assert.strictEqual(artistIdInputSchema.safeParse('a'.repeat(257)).success, false)

  // Non-string types
  assert.strictEqual(artistIdInputSchema.safeParse(null).success, false)
  assert.strictEqual(artistIdInputSchema.safeParse(undefined).success, false)
  assert.strictEqual(artistIdInputSchema.safeParse(12345).success, false)
})

test('Artist: artistDetailSchema validates complete artist payload structures', () => {
  const validPayload = {
    artist: {
      id: 'UC_radiohead',
      name: 'Radiohead',
      bio: 'English rock band formed in Abingdon, Oxfordshire in 1985.',
      subscribers: '3.4M',
      monthlyListeners: 15000000,
    },
    topTracks: [
      { id: 't1', title: 'Creep', durationSeconds: 238 },
      { id: 't2', title: 'Karma Police', durationSeconds: 261 },
    ],
    albums: [
      { id: 'alb1', title: 'OK Computer', year: 1997 },
      { id: 'alb2', title: 'Kid A', year: 2000 },
    ],
    singles: [
      { id: 's1', title: 'Burn the Witch', year: 2016 },
    ],
    relatedArtists: [
      { id: 'rel1', name: 'Thom Yorke' },
      { id: 'rel2', name: 'The Smile' },
    ],
  }
  assert.strictEqual(artistDetailSchema.safeParse(validPayload).success, true)

  const invalidPayload = {
    artist: {
      id: '', // Empty ID violates min(1)
      name: 'Invalid Artist',
    },
    topTracks: [],
    albums: [],
    singles: [],
    relatedArtists: [],
  }
  assert.strictEqual(artistDetailSchema.safeParse(invalidPayload).success, false)

  const missingNamePayload = {
    artist: {
      id: 'art1',
      // Missing name
    },
    topTracks: [],
    albums: [],
    singles: [],
    relatedArtists: [],
  }
  assert.strictEqual(artistDetailSchema.safeParse(missingNamePayload).success, false)
})

test('Artist: metrics tracking records activity and resets correctly', () => {
  resetArtistMetrics()
  const initial = getArtistMetrics()
  assert.strictEqual(initial.loadsCount, 0)
  assert.strictEqual(initial.failuresCount, 0)
  assert.strictEqual(initial.lastError, null)
  assert.strictEqual(artistMetricsSchema.safeParse(initial).success, true)

  resetArtistMetrics()
  const resetState = getArtistMetrics()
  assert.strictEqual(resetState.loadsCount, 0)
  assert.strictEqual(resetState.failuresCount, 0)
  assert.strictEqual(resetState.lastError, null)
})
