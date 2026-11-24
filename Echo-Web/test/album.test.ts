import test from 'node:test'
import assert from 'node:assert'
import {
  albumIdInputSchema,
  albumDetailSchema,
  albumMetricsSchema,
  getAlbumMetrics,
  resetAlbumMetrics,
} from '../src/hooks/useAlbum.ts'

test('Album: albumIdInputSchema validates browse IDs and rejects malformed values', () => {
  const valid = albumIdInputSchema.safeParse('MPREb_ABC123xyz')
  assert.strictEqual(valid.success, true)
  if (valid.success) {
    assert.strictEqual(valid.data, 'MPREb_ABC123xyz')
  }

  // Whitespace trimming
  const withWhitespace = albumIdInputSchema.safeParse('  MPREb_trimmed  ')
  assert.strictEqual(withWhitespace.success, true)
  if (withWhitespace.success) {
    assert.strictEqual(withWhitespace.data, 'MPREb_trimmed')
  }

  // Empty or whitespace-only strings
  assert.strictEqual(albumIdInputSchema.safeParse('').success, false)
  assert.strictEqual(albumIdInputSchema.safeParse('    ').success, false)

  // Oversized ID exceeding 256 chars
  assert.strictEqual(albumIdInputSchema.safeParse('x'.repeat(257)).success, false)
})

test('Album: albumDetailSchema validates complete album payload structures', () => {
  const validPayload = {
    album: {
      id: 'MPREb_test_1',
      title: 'In Rainbows',
      artistName: 'Radiohead',
      year: 2007,
    },
    tracks: [
      { id: 't1', title: '15 Step', durationSeconds: 237 },
      { id: 't2', title: 'Bodysnatchers', durationSeconds: 242 },
    ],
  }
  assert.strictEqual(albumDetailSchema.safeParse(validPayload).success, true)

  const invalidPayload = {
    album: {
      id: '', // Empty id
      title: 'Incomplete Album',
    },
    tracks: [],
  }
  assert.strictEqual(albumDetailSchema.safeParse(invalidPayload).success, false)
})

test('Album: telemetry metrics record album loads and reset cleanly', () => {
  resetAlbumMetrics()
  const initial = getAlbumMetrics()
  assert.strictEqual(initial.loadsCount, 0)
  assert.strictEqual(initial.failuresCount, 0)
  assert.strictEqual(initial.lastError, null)

  assert.strictEqual(albumMetricsSchema.safeParse(initial).success, true)

  resetAlbumMetrics()
  assert.deepStrictEqual(getAlbumMetrics(), {
    loadsCount: 0,
    failuresCount: 0,
    lastError: null,
  })
})
