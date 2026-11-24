import test from 'node:test'
import assert from 'node:assert'
import {
  ObjectUrlRegistry,
  getLocalArtworkUrl,
  revokeLocalArtwork,
} from '../src/services/local/objectUrlRegistry.ts'
import { localRecordToTrack } from '../src/services/local/localMusicScanner.ts'
import type { LocalFileRecord } from '../src/services/db/echoDatabase.ts'

test('ObjectUrlRegistry: caches and deduplicates Object URLs for the same track [BUG-27]', () => {
  const registry = ObjectUrlRegistry.getInstance()
  registry.revokeAll()

  const fakeBlob1 = new Blob(['image data 1'], { type: 'image/jpeg' })
  const fakeBlob2 = new Blob(['image data 2'], { type: 'image/png' })

  // 1. First retrieval creates URL
  const url1 = getLocalArtworkUrl('track-1', fakeBlob1)
  assert.ok(url1.startsWith('blob:'))
  assert.strictEqual(registry.getActiveCount(), 1)
  assert.strictEqual(registry.hasKey('art_track-1'), true)

  // 2. Second retrieval returns the SAME URL without re-creating
  const url1Again = getLocalArtworkUrl('track-1', fakeBlob1)
  assert.strictEqual(url1Again, url1)
  assert.strictEqual(registry.getActiveCount(), 1)

  // 3. Different track gets its own URL
  const url2 = getLocalArtworkUrl('track-2', fakeBlob2)
  assert.ok(url2.startsWith('blob:'))
  assert.notStrictEqual(url2, url1)
  assert.strictEqual(registry.getActiveCount(), 2)

  // 4. localRecordToTrack returns the registered URL
  const record: LocalFileRecord = {
    id: 'track-1',
    fileName: 'song.mp3',
    title: 'Song Title',
    artist: 'Artist',
    album: 'Album',
    durationSeconds: 180,
    artworkBlob: fakeBlob1,
    audioBlob: new Blob(['audio']),
    mimeType: 'audio/mpeg',
    addedAt: Date.now(),
    fileSize: 1000,
  }

  const track = localRecordToTrack(record)
  assert.strictEqual(track.artwork, url1)
  assert.strictEqual(track.albumImage, url1)
  assert.strictEqual(registry.getActiveCount(), 2)

  // 5. Explicit revocation removes URL from registry
  revokeLocalArtwork('track-1')
  assert.strictEqual(registry.hasKey('art_track-1'), false)
  assert.strictEqual(registry.getActiveCount(), 1)

  // 6. Revoke all clears remaining items
  registry.revokeAll()
  assert.strictEqual(registry.getActiveCount(), 0)
})
