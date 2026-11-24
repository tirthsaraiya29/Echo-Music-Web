import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  librarySyncSnapshotSchema,
  syncBroadcastMessageSchema,
  multiDeviceSyncMetricsSchema,
  getOrCreateDeviceId,
  getCurrentLibraryRevision,
  incrementLibraryRevision,
  createLocalLibrarySnapshot,
  applyRemoteLibrarySnapshot,
  exportLibrarySnapshotJson,
  importLibrarySnapshotJson,
  recordMultiDeviceSyncMetric,
  getMultiDeviceSyncMetrics,
  resetMultiDeviceSyncMetrics,
  type LibrarySyncSnapshot,
} from '../src/services/sync/multiDeviceLibrarySyncService.ts'
import { useEchoStore } from '../src/stores/useEchoStore.ts'

describe('Multi-Device Library Sync Service', () => {
  beforeEach(() => {
    resetMultiDeviceSyncMetrics()
    useEchoStore.setState({
      playlists: [],
      likedTrackIds: [],
      likedAlbumIds: [],
      likedAlbums: [],
      followedArtistIds: [],
      followedArtists: [],
      recentlyPlayedIds: [],
      recentItems: [],
      currentTrackId: 'local_track_123',
      isPlaying: true,
      queueIds: ['local_track_123'],
    })
  })

  describe('Schemas', () => {
    it('validates a valid LibrarySyncSnapshot', () => {
      const snapshot = librarySyncSnapshotSchema.parse({
        version: 1,
        deviceId: 'device_abc_123',
        timestamp: 1700000000000,
        playlists: [
          {
            id: 'pl_1',
            title: 'Favorites',
            description: '',
            owner: 'You',
            image: '',
            trackIds: ['t1'],
            curated: false,
            createdAt: 1000,
          },
        ],
        likedTrackIds: ['t1', 't2'],
        likedAlbumIds: ['alb_1'],
        likedAlbums: [
          {
            id: 'alb_1',
            title: 'Album 1',
            artistName: 'Artist 1',
            likedAt: 1000,
            source: 'cloud',
          },
        ],
        followedArtistIds: ['art_1'],
        followedArtists: [
          {
            id: 'art_1',
            name: 'Artist 1',
            followedAt: 1000,
            source: 'cloud',
          },
        ],
        recentlyPlayedIds: ['t1'],
        recentItems: [],
        preferences: { volume: 0.8 },
      })

      assert.equal(snapshot.version, 1)
      assert.equal(snapshot.deviceId, 'device_abc_123')
      assert.equal(snapshot.likedTrackIds.length, 2)
      assert.equal(snapshot.playlists.length, 1)
    })

    it('rejects invalid snapshot missing required fields', () => {
      assert.throws(() =>
        librarySyncSnapshotSchema.parse({
          version: 1,
          // missing deviceId and timestamp
          playlists: [],
        }),
      )
    })

    it('validates SyncBroadcastMessage schema', () => {
      const msg = syncBroadcastMessageSchema.parse({
        type: 'SNAPSHOT_BROADCAST',
        senderDeviceId: 'peer_999',
        timestamp: 1700000000000,
      })

      assert.equal(msg.type, 'SNAPSHOT_BROADCAST')
      assert.equal(msg.senderDeviceId, 'peer_999')
    })

    it('validates MultiDeviceSyncMetrics schema', () => {
      const metrics = multiDeviceSyncMetricsSchema.parse({
        messagesSentCount: 5,
        messagesReceivedCount: 10,
        snapshotsBroadcastCount: 4,
        snapshotsAppliedCount: 3,
        syncRequestsHandledCount: 2,
        errorsCount: 0,
      })

      assert.equal(metrics.messagesSentCount, 5)
      assert.equal(metrics.snapshotsAppliedCount, 3)
    })
  })

  describe('Device Identification & Revisions', () => {
    it('returns a valid device ID', () => {
      const id = getOrCreateDeviceId()
      assert.ok(typeof id === 'string')
      assert.ok(id.length > 0)
    })

    it('increments library revision monotonically', () => {
      const rev1 = getCurrentLibraryRevision()
      const rev2 = incrementLibraryRevision()
      assert.equal(rev2, rev1 + 1)
      assert.equal(getCurrentLibraryRevision(), rev2)
    })
  })

  describe('Snapshot Creation & Application', () => {
    it('creates local snapshot reflecting current store state', () => {
      useEchoStore.setState({
        likedTrackIds: ['track_a', 'track_b'],
        likedAlbumIds: ['album_a'],
      })

      const snap = createLocalLibrarySnapshot()
      assert.deepEqual(snap.likedTrackIds, ['track_a', 'track_b'])
      assert.deepEqual(snap.likedAlbumIds, ['album_a'])
      assert.equal(snap.deviceId, getOrCreateDeviceId())
      assert.ok(snap.timestamp > 0)
    })

    it('ignores snapshot originated from self', () => {
      const selfSnap: LibrarySyncSnapshot = {
        version: 5,
        deviceId: getOrCreateDeviceId(),
        timestamp: Date.now(),
        playlists: [],
        likedTrackIds: ['ignored'],
        likedAlbumIds: [],
        likedAlbums: [],
        followedArtistIds: [],
        followedArtists: [],
        recentlyPlayedIds: [],
        recentItems: [],
        preferences: {},
      }

      const applied = applyRemoteLibrarySnapshot(selfSnap)
      assert.equal(applied, false)
      assert.notEqual(useEchoStore.getState().likedTrackIds, ['ignored'])
    })

    it('applies remote snapshot and preserves local playback state', () => {
      const remoteSnap: LibrarySyncSnapshot = {
        version: 10,
        deviceId: 'remote_peer_phone_456',
        timestamp: Date.now() + 1000,
        playlists: [
          {
            id: 'peer_pl_1',
            title: 'Road Trip',
            description: '',
            owner: 'You',
            image: '',
            trackIds: ['t10'],
            curated: false,
            createdAt: 1000,
          },
        ],
        likedTrackIds: ['t10', 't20'],
        likedAlbumIds: ['alb_remote'],
        likedAlbums: [
          {
            id: 'alb_remote',
            title: 'Remote Album',
            artistName: 'Remote Artist',
            likedAt: 2000,
            source: 'cloud',
          },
        ],
        followedArtistIds: ['art_remote'],
        followedArtists: [
          {
            id: 'art_remote',
            name: 'Remote Artist',
            followedAt: 2000,
            source: 'cloud',
          },
        ],
        recentlyPlayedIds: ['t10'],
        recentItems: [],
        preferences: {},
      }

      const applied = applyRemoteLibrarySnapshot(remoteSnap)
      assert.equal(applied, true)

      const state = useEchoStore.getState()
      assert.deepEqual(state.likedTrackIds, ['t10', 't20'])
      assert.equal(state.playlists.length, 1)
      assert.equal(state.playlists[0]?.title, 'Road Trip')
      assert.equal(state.likedAlbums.length, 1)
      assert.equal(state.followedArtists.length, 1)

      // Playback state must remain completely untouched!
      assert.equal(state.currentTrackId, 'local_track_123')
      assert.equal(state.isPlaying, true)
      assert.deepEqual(state.queueIds, ['local_track_123'])

      assert.equal(getMultiDeviceSyncMetrics().snapshotsAppliedCount, 1)
    })
  })

  describe('Export & Import Deltas', () => {
    it('exports and imports library snapshot JSON safely', () => {
      useEchoStore.setState({
        likedTrackIds: ['imported_t1'],
        playlists: [],
      })

      const jsonStr = exportLibrarySnapshotJson()
      assert.ok(jsonStr.includes('imported_t1'))

      // Modify device ID in JSON to simulate coming from another device
      const remoteJson = jsonStr.replace(getOrCreateDeviceId(), 'other_device_xyz')
      const success = importLibrarySnapshotJson(remoteJson)
      assert.equal(success, true)
    })

    it('handles malformed JSON import safely', () => {
      const success = importLibrarySnapshotJson('invalid_json_string')
      assert.equal(success, false)
      assert.equal(getMultiDeviceSyncMetrics().errorsCount, 1)
    })
  })

  describe('Telemetry & Metrics', () => {
    it('records and resets telemetry metrics', () => {
      recordMultiDeviceSyncMetric('messagesSentCount', 3)
      recordMultiDeviceSyncMetric('snapshotsBroadcastCount', 2)

      const m = getMultiDeviceSyncMetrics()
      assert.equal(m.messagesSentCount, 3)
      assert.equal(m.snapshotsBroadcastCount, 2)

      resetMultiDeviceSyncMetrics()
      const reset = getMultiDeviceSyncMetrics()
      assert.equal(reset.messagesSentCount, 0)
      assert.equal(reset.snapshotsBroadcastCount, 0)
    })
  })
})
