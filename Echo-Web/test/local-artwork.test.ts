import test from 'node:test'
import assert from 'node:assert'
import {
  artworkKeySchema,
  artworkLifecycleMetricsSchema,
  getArtworkLifecycleMetrics,
  resetArtworkLifecycleMetrics,
  objectUrlRegistry,
  getLocalArtworkUrl,
  revokeLocalArtwork,
} from '../src/services/local/objectUrlRegistry.ts'

test('Local Artwork: artworkKeySchema validates key format and bounds', () => {
  assert.strictEqual(artworkKeySchema.safeParse('art_track_123').success, true)
  assert.strictEqual(artworkKeySchema.safeParse('   trimmed_key   ').success, true)
  assert.strictEqual(artworkKeySchema.safeParse('').success, false)
  assert.strictEqual(artworkKeySchema.safeParse('   ').success, false)
  assert.strictEqual(artworkKeySchema.safeParse('a'.repeat(257)).success, false)
})

test('Local Artwork: registry deduplication, revocation, and metrics tracking', () => {
  resetArtworkLifecycleMetrics()
  objectUrlRegistry.revokeAll()

  const initial = getArtworkLifecycleMetrics()
  assert.strictEqual(initial.createdCount, 0)
  assert.strictEqual(initial.reusedCount, 0)
  assert.strictEqual(initial.activeCount, 0)
  assert.strictEqual(artworkLifecycleMetricsSchema.safeParse(initial).success, true)

  const dummyBlob1 = new Blob(['image 1'], { type: 'image/jpeg' })
  const dummyBlob2 = new Blob(['image 2'], { type: 'image/png' })

  // 1. Create first artwork URL
  const url1 = getLocalArtworkUrl('track_1', dummyBlob1)
  assert.ok(url1)
  assert.strictEqual(objectUrlRegistry.hasKey('art_track_1'), true)
  assert.strictEqual(objectUrlRegistry.getActiveCount(), 1)
  assert.strictEqual(getArtworkLifecycleMetrics().createdCount, 1)

  // 2. Deduplicate: Requesting same track artwork returns existing URL
  const url1Duplicate = getLocalArtworkUrl('track_1', dummyBlob1)
  assert.strictEqual(url1Duplicate, url1)
  assert.strictEqual(getArtworkLifecycleMetrics().reusedCount, 1)
  assert.strictEqual(objectUrlRegistry.getActiveCount(), 1)

  // 3. Create second artwork URL
  const url2 = getLocalArtworkUrl('track_2', dummyBlob2)
  assert.ok(url2)
  assert.notStrictEqual(url2, url1)
  assert.strictEqual(objectUrlRegistry.getActiveCount(), 2)
  assert.strictEqual(getArtworkLifecycleMetrics().createdCount, 2)

  // 4. Revoke single artwork
  revokeLocalArtwork('track_1')
  assert.strictEqual(objectUrlRegistry.hasKey('art_track_1'), false)
  assert.strictEqual(objectUrlRegistry.getActiveCount(), 1)
  assert.strictEqual(getArtworkLifecycleMetrics().revokedCount, 1)

  // 5. Revoke all
  objectUrlRegistry.revokeAll()
  assert.strictEqual(objectUrlRegistry.getActiveCount(), 0)
  assert.strictEqual(getArtworkLifecycleMetrics().revokedCount, 2)

  // 6. Reset metrics
  resetArtworkLifecycleMetrics()
  const resetMetrics = getArtworkLifecycleMetrics()
  assert.strictEqual(resetMetrics.createdCount, 0)
  assert.strictEqual(resetMetrics.reusedCount, 0)
  assert.strictEqual(resetMetrics.revokedCount, 0)
  assert.strictEqual(resetMetrics.activeCount, 0)
})

test('Local Artwork: invalid keys gracefully return empty string without throw', () => {
  const dummyBlob = new Blob(['content'], { type: 'image/jpeg' })
  const emptyKeyUrl = objectUrlRegistry.getOrCreate('', dummyBlob)
  assert.strictEqual(emptyKeyUrl, '')

  const whitespaceKeyUrl = objectUrlRegistry.getOrCreate('    ', dummyBlob)
  assert.strictEqual(whitespaceKeyUrl, '')
})
