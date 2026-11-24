import test from 'node:test'
import assert from 'node:assert'
import {
  playlistInputSchema,
  playlistIdSchema,
  playlistMetricsSchema,
  getPlaylistMetrics,
  resetPlaylistMetrics,
  useEchoStore,
} from '../src/stores/useEchoStore.ts'

test('Playlist: playlistInputSchema validates title and description with trimming and bounds', () => {
  const valid = playlistInputSchema.safeParse({
    title: '  Late Night Drive  ',
    description: '  Chill synthwave tracks  ',
  })
  assert.strictEqual(valid.success, true)
  if (valid.success) {
    assert.strictEqual(valid.data.title, 'Late Night Drive')
    assert.strictEqual(valid.data.description, 'Chill synthwave tracks')
  }

  // Empty title fails
  assert.strictEqual(
    playlistInputSchema.safeParse({ title: '', description: 'Some description' }).success,
    false,
  )
  assert.strictEqual(
    playlistInputSchema.safeParse({ title: '   ', description: 'Some description' }).success,
    false,
  )

  // Title exceeding 60 characters fails
  assert.strictEqual(
    playlistInputSchema.safeParse({ title: 'A'.repeat(61), description: 'Desc' }).success,
    false,
  )

  // Description exceeding 240 characters fails
  assert.strictEqual(
    playlistInputSchema.safeParse({ title: 'Valid Title', description: 'B'.repeat(241) }).success,
    false,
  )

  // Default empty description
  const defaultDesc = playlistInputSchema.safeParse({ title: 'Solo Title' })
  assert.strictEqual(defaultDesc.success, true)
  if (defaultDesc.success) {
    assert.strictEqual(defaultDesc.data.description, '')
  }
})

test('Playlist: playlistIdSchema validates non-empty IDs', () => {
  assert.strictEqual(playlistIdSchema.safeParse('playlist_12345').success, true)
  assert.strictEqual(playlistIdSchema.safeParse('').success, false)
  assert.strictEqual(playlistIdSchema.safeParse('   ').success, false)
  assert.strictEqual(playlistIdSchema.safeParse(null).success, false)
})

test('Playlist: lifecycle, deduplication, reordering, and metrics', () => {
  resetPlaylistMetrics()
  const initialMetrics = getPlaylistMetrics()
  assert.strictEqual(initialMetrics.createdCount, 0)
  assert.strictEqual(playlistMetricsSchema.safeParse(initialMetrics).success, true)

  const store = useEchoStore.getState()

  // 1. Create playlist
  const playlistId = store.createPlaylist('Test Flow', 'Initial description')
  assert.ok(playlistId.length > 0)
  assert.strictEqual(getPlaylistMetrics().createdCount, 1)

  let playlist = useEchoStore.getState().playlists.find((p) => p.id === playlistId)
  assert.ok(playlist)
  assert.strictEqual(playlist?.title, 'Test Flow')
  assert.strictEqual(playlist?.trackIds.length, 0)

  // 2. Add tracks
  store.addTrackToPlaylist(playlistId, {
    id: 'track_1',
    title: 'First Song',
    artistName: 'Echo Artist',
    artwork: 'https://example.com/art1.jpg',
  })
  assert.strictEqual(getPlaylistMetrics().tracksAddedCount, 1)

  playlist = useEchoStore.getState().playlists.find((p) => p.id === playlistId)
  assert.deepStrictEqual(playlist?.trackIds, ['track_1'])
  assert.strictEqual(playlist?.image, 'https://example.com/art1.jpg')

  // 3. Deduplication: Adding duplicate track is a safe no-op
  store.addTrackToPlaylist(playlistId, 'track_1')
  assert.strictEqual(getPlaylistMetrics().tracksAddedCount, 1) // Did not increment
  playlist = useEchoStore.getState().playlists.find((p) => p.id === playlistId)
  assert.deepStrictEqual(playlist?.trackIds, ['track_1'])

  // Add a second track
  store.addTrackToPlaylist(playlistId, 'track_2')
  assert.strictEqual(getPlaylistMetrics().tracksAddedCount, 2)
  playlist = useEchoStore.getState().playlists.find((p) => p.id === playlistId)
  assert.deepStrictEqual(playlist?.trackIds, ['track_1', 'track_2'])

  // 4. Reorder tracks
  // from === to should be a no-op
  store.reorderPlaylistTrack(playlistId, 0, 0)
  assert.strictEqual(getPlaylistMetrics().tracksReorderedCount, 0)

  // Out of bounds should be a safe no-op
  store.reorderPlaylistTrack(playlistId, -1, 5)
  assert.strictEqual(getPlaylistMetrics().tracksReorderedCount, 0)

  // Valid reorder
  store.reorderPlaylistTrack(playlistId, 0, 1)
  assert.strictEqual(getPlaylistMetrics().tracksReorderedCount, 1)
  playlist = useEchoStore.getState().playlists.find((p) => p.id === playlistId)
  assert.deepStrictEqual(playlist?.trackIds, ['track_2', 'track_1'])

  // 5. Update playlist details
  store.updatePlaylist(playlistId, 'Updated Flow', 'Updated description')
  assert.strictEqual(getPlaylistMetrics().updatedCount, 1)
  playlist = useEchoStore.getState().playlists.find((p) => p.id === playlistId)
  assert.strictEqual(playlist?.title, 'Updated Flow')
  assert.strictEqual(playlist?.description, 'Updated description')

  // 6. Set playlist cover
  store.setPlaylistCover(playlistId, 'https://example.com/custom-cover.jpg')
  assert.strictEqual(getPlaylistMetrics().coversUpdatedCount, 1)
  playlist = useEchoStore.getState().playlists.find((p) => p.id === playlistId)
  assert.strictEqual(playlist?.image, 'https://example.com/custom-cover.jpg')

  // 7. Remove track
  store.removeTrackFromPlaylist(playlistId, 'track_2')
  assert.strictEqual(getPlaylistMetrics().tracksRemovedCount, 1)
  playlist = useEchoStore.getState().playlists.find((p) => p.id === playlistId)
  assert.deepStrictEqual(playlist?.trackIds, ['track_1'])

  // Removing non-existent track is a safe no-op
  store.removeTrackFromPlaylist(playlistId, 'non_existent')
  assert.strictEqual(getPlaylistMetrics().tracksRemovedCount, 1)

  // 8. Delete playlist
  store.deletePlaylist(playlistId)
  assert.strictEqual(getPlaylistMetrics().deletedCount, 1)
  assert.strictEqual(
    useEchoStore.getState().playlists.some((p) => p.id === playlistId),
    false,
  )

  // 9. Reset metrics
  resetPlaylistMetrics()
  const resetMetrics = getPlaylistMetrics()
  assert.strictEqual(resetMetrics.createdCount, 0)
  assert.strictEqual(resetMetrics.tracksAddedCount, 0)
  assert.strictEqual(resetMetrics.tracksRemovedCount, 0)
  assert.strictEqual(resetMetrics.tracksReorderedCount, 0)
})
