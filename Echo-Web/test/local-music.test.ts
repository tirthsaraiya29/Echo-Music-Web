import test from 'node:test'
import assert from 'node:assert'
import {
  localFileInputSchema,
  localFileRecordSchema,
  localMusicMetricsSchema,
  getLocalMusicMetrics,
  resetLocalMusicMetrics,
  deleteLocalTrack,
  localRecordToTrack,
  importLocalFile,
} from '../src/services/local/localMusicScanner.ts'
import type { LocalFileRecord } from '../src/services/db/echoDatabase.ts'

test('Local Music: localFileInputSchema validates audio file constraints', () => {
  const valid = localFileInputSchema.safeParse({
    fileName: 'song.mp3',
    fileSize: 10485760, // 10MB
    mimeType: 'audio/mpeg',
  })
  assert.strictEqual(valid.success, true)

  // Empty fileName fails
  assert.strictEqual(
    localFileInputSchema.safeParse({ fileName: '', fileSize: 1000 }).success,
    false,
  )

  // Negative size fails
  assert.strictEqual(
    localFileInputSchema.safeParse({ fileName: 'test.wav', fileSize: -1 }).success,
    false,
  )

  // Oversized file (>500MB) fails
  assert.strictEqual(
    localFileInputSchema.safeParse({
      fileName: 'huge.flac',
      fileSize: 1024 * 1024 * 501,
    }).success,
    false,
  )
})

test('Local Music: localFileRecordSchema validates complete stored records', () => {
  const validRecord = {
    id: 'local_1700000000_abc123',
    fileName: 'nightcall.mp3',
    title: 'Nightcall',
    artist: 'Kavinsky',
    album: 'OutRun',
    durationSeconds: 259,
    year: '2013',
    genre: 'Synthwave',
    mimeType: 'audio/mpeg',
    addedAt: Date.now(),
    fileSize: 8500000,
  }
  assert.strictEqual(localFileRecordSchema.safeParse(validRecord).success, true)

  // Missing title fails
  assert.strictEqual(
    localFileRecordSchema.safeParse({ ...validRecord, title: '' }).success,
    false,
  )

  // Missing artist fails
  assert.strictEqual(
    localFileRecordSchema.safeParse({ ...validRecord, artist: '' }).success,
    false,
  )
})

test('Local Music: localRecordToTrack accurately converts records to Domain Tracks', () => {
  const record: LocalFileRecord = {
    id: 'local_test_track_1',
    fileName: 'song.flac',
    title: 'Resonance',
    artist: 'HOME',
    album: 'Odyssey',
    durationSeconds: 212,
    year: '2014',
    genre: 'Chillwave',
    mimeType: 'audio/flac',
    audioBlob: new Blob(['audio data'], { type: 'audio/flac' }),
    addedAt: 1700000000000,
    fileSize: 25000000,
  }

  const track = localRecordToTrack(record)
  assert.strictEqual(track.id, 'local_test_track_1')
  assert.strictEqual(track.title, 'Resonance')
  assert.strictEqual(track.artistName, 'HOME')
  assert.strictEqual(track.artistId, 'artist_local_HOME')
  assert.strictEqual(track.albumTitle, 'Odyssey')
  assert.strictEqual(track.albumId, 'album_local_Odyssey')
  assert.strictEqual(track.durationSeconds, 212)
  assert.strictEqual(track.durationMs, 212000)
  assert.strictEqual(track.explicit, false)
})

test('Local Music: telemetry metrics, deletion tracking, and cancellation', async () => {
  resetLocalMusicMetrics()
  const initial = getLocalMusicMetrics()
  assert.strictEqual(initial.filesImported, 0)
  assert.strictEqual(initial.filesRejected, 0)
  assert.strictEqual(initial.filesDeleted, 0)
  assert.strictEqual(localMusicMetricsSchema.safeParse(initial).success, true)

  // 1. Deletion tracks metric
  await deleteLocalTrack('local_dummy_id')
  assert.strictEqual(getLocalMusicMetrics().filesDeleted, 1)

  // 2. Cancellation on import
  const abortCtrl = new AbortController()
  abortCtrl.abort()

  const fakeFile = new File(['fake content'], 'test.mp3', { type: 'audio/mpeg' })
  await assert.rejects(
    async () => {
      await importLocalFile(fakeFile, { signal: abortCtrl.signal })
    },
    { message: 'Import cancelled' },
  )
  assert.strictEqual(getLocalMusicMetrics().filesRejected, 1)
  assert.strictEqual(getLocalMusicMetrics().lastError, 'Import cancelled')

  // 3. Reset metrics
  resetLocalMusicMetrics()
  assert.strictEqual(getLocalMusicMetrics().filesImported, 0)
  assert.strictEqual(getLocalMusicMetrics().filesRejected, 0)
  assert.strictEqual(getLocalMusicMetrics().filesDeleted, 0)
  assert.strictEqual(getLocalMusicMetrics().lastError, null)
})
