import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  followedArtistEntitySchema,
  artistNewReleaseSchema,
  followedArtistsSyncResultSchema,
  followedArtistsSyncMetricsSchema,
  reconcileFollowedArtists,
  recordFollowedArtistsMetric,
  getFollowedArtistsMetrics,
  resetFollowedArtistsMetrics,
  type FollowedArtistEntity,
} from '../src/services/sync/followedArtistsSyncService.ts'
import { useEchoStore } from '../src/stores/useEchoStore.ts'

describe('Followed Artists Synchronization & Anti-Wipe Protection', () => {
  beforeEach(() => {
    resetFollowedArtistsMetrics()
    useEchoStore.setState({
      followedArtistIds: [],
      followedArtists: [],
    })
  })

  describe('Zod Schemas', () => {
    it('validates a valid FollowedArtistEntity', () => {
      const artist = followedArtistEntitySchema.parse({
        id: 'UCartist123',
        name: 'Daft Punk',
        thumbnailUrl: 'https://example.com/daftpunk.jpg',
        subscribers: '5.2M',
        source: 'cloud',
      })

      assert.equal(artist.id, 'UCartist123')
      assert.equal(artist.name, 'Daft Punk')
      assert.equal(artist.subscribers, '5.2M')
      assert.equal(artist.source, 'cloud')
      assert.ok(artist.followedAt > 0)
    })

    it('rejects invalid artist entity missing id or name', () => {
      assert.throws(() =>
        followedArtistEntitySchema.parse({
          id: '',
          name: 'No ID',
        }),
      )

      assert.throws(() =>
        followedArtistEntitySchema.parse({
          id: 'valid_id',
          name: '',
        }),
      )
    })

    it('validates ArtistNewRelease schema', () => {
      const release = artistNewReleaseSchema.parse({
        id: 'MPREb_album999',
        artistId: 'UCartist123',
        artistName: 'Daft Punk',
        title: 'Random Access Memories (10th Anniversary)',
        coverUrl: 'https://example.com/cover.jpg',
        year: 2023,
        type: 'album',
      })

      assert.equal(release.id, 'MPREb_album999')
      assert.equal(release.artistName, 'Daft Punk')
      assert.equal(release.type, 'album')
    })

    it('validates FollowedArtistsSyncResult schema', () => {
      const result = followedArtistsSyncResultSchema.parse({
        action: 'additive_merge',
        localCount: 4,
        remoteCount: 2,
        addedCount: 2,
        message: 'Preserved 2 local artists and merged 2 cloud artists',
        syncedAt: 1700000000000,
      })

      assert.equal(result.action, 'additive_merge')
      assert.equal(result.localCount, 4)
    })

    it('validates FollowedArtistsSyncMetrics schema', () => {
      const metrics = followedArtistsSyncMetricsSchema.parse({
        syncAttemptsCount: 8,
        syncSuccessCount: 7,
        syncErrorsCount: 1,
        wipesPreventedCount: 2,
        artistsSyncedCount: 12,
        additiveSyncsCount: 3,
        newReleasesFetchedCount: 5,
      })

      assert.equal(metrics.syncAttemptsCount, 8)
      assert.equal(metrics.wipesPreventedCount, 2)
      assert.equal(metrics.newReleasesFetchedCount, 5)
    })
  })

  describe('Anti-Wipe Reconciliation Algorithm', () => {
    const mockArtist1: FollowedArtistEntity = {
      id: 'artist_1',
      name: 'Radiohead',
      subscribers: '3.1M',
      followedAt: 1000,
      source: 'local',
    }

    const mockArtist2: FollowedArtistEntity = {
      id: 'artist_2',
      name: 'Portishead',
      subscribers: '800K',
      followedAt: 2000,
      source: 'local',
    }

    const mockArtist3: FollowedArtistEntity = {
      id: 'artist_3',
      name: 'Massive Attack',
      subscribers: '1.5M',
      followedAt: 3000,
      source: 'cloud',
    }

    it('prevents accidental wipe when remote returns empty and local has artists', () => {
      const res = reconcileFollowedArtists({
        localArtists: [mockArtist1, mockArtist2],
        remoteArtists: [],
        allowEmptyRemote: false,
      })

      assert.equal(res.action, 'wipe_prevented')
      assert.equal(res.finalArtists.length, 2)
      assert.deepEqual(res.finalArtists.map((a) => a.id), ['artist_1', 'artist_2'])
      assert.equal(getFollowedArtistsMetrics().wipesPreventedCount, 1)
    })

    it('allows empty remote when allowEmptyRemote is explicitly enabled', () => {
      const res = reconcileFollowedArtists({
        localArtists: [mockArtist1],
        remoteArtists: [],
        allowEmptyRemote: true,
      })

      assert.equal(res.action, 'full_update')
      assert.equal(res.finalArtists.length, 0)
    })

    it('returns no_change when local and remote match identically', () => {
      const res = reconcileFollowedArtists({
        localArtists: [mockArtist1, mockArtist2],
        remoteArtists: [mockArtist1, mockArtist2],
      })

      assert.equal(res.action, 'no_change')
      assert.equal(res.finalArtists.length, 2)
      assert.equal(res.addedCount, 0)
    })

    it('performs additive merge preserving local artists not present on cloud', () => {
      const res = reconcileFollowedArtists({
        localArtists: [mockArtist1, mockArtist2],
        remoteArtists: [mockArtist1, mockArtist3], // mockArtist2 is local-only, mockArtist3 is cloud-only
      })

      assert.equal(res.action, 'additive_merge')
      assert.equal(res.finalArtists.length, 3)
      assert.deepEqual(res.finalArtists.map((a) => a.id), ['artist_1', 'artist_2', 'artist_3'])
      assert.equal(res.addedCount, 1)
      assert.equal(getFollowedArtistsMetrics().additiveSyncsCount, 1)
      assert.equal(getFollowedArtistsMetrics().artistsSyncedCount, 1)
    })

    it('performs full update when cloud contains all local artists plus new cloud artists', () => {
      const res = reconcileFollowedArtists({
        localArtists: [mockArtist1],
        remoteArtists: [mockArtist1, mockArtist3],
      })

      assert.equal(res.action, 'full_update')
      assert.equal(res.finalArtists.length, 2)
      assert.deepEqual(res.finalArtists.map((a) => a.id), ['artist_1', 'artist_3'])
      assert.equal(res.addedCount, 1)
    })
  })

  describe('Telemetry & Metrics', () => {
    it('records and resets metrics correctly', () => {
      recordFollowedArtistsMetric('syncAttemptsCount', 4)
      recordFollowedArtistsMetric('syncSuccessCount', 3)
      recordFollowedArtistsMetric('newReleasesFetchedCount', 10)

      const m = getFollowedArtistsMetrics()
      assert.equal(m.syncAttemptsCount, 4)
      assert.equal(m.syncSuccessCount, 3)
      assert.equal(m.newReleasesFetchedCount, 10)

      resetFollowedArtistsMetrics()
      const reset = getFollowedArtistsMetrics()
      assert.equal(reset.syncAttemptsCount, 0)
      assert.equal(reset.syncSuccessCount, 0)
      assert.equal(reset.newReleasesFetchedCount, 0)
    })
  })

  describe('Zustand Store Integration', () => {
    it('toggles artist follow with metadata and persists both ID and entity', () => {
      const store = useEchoStore.getState()
      assert.equal(store.followedArtistIds.length, 0)
      assert.equal(store.followedArtists.length, 0)

      store.toggleArtistFollow('artist_daft', {
        name: 'Daft Punk',
        image: 'https://example.com/daft.jpg',
        subscribers: '5.2M',
      })

      const state1 = useEchoStore.getState()
      assert.deepEqual(state1.followedArtistIds, ['artist_daft'])
      assert.equal(state1.followedArtists.length, 1)
      assert.equal(state1.followedArtists[0]?.id, 'artist_daft')
      assert.equal(state1.followedArtists[0]?.name, 'Daft Punk')
      assert.equal(state1.followedArtists[0]?.thumbnailUrl, 'https://example.com/daft.jpg')
      assert.equal(state1.followedArtists[0]?.subscribers, '5.2M')

      // Toggling again unfollows the artist
      state1.toggleArtistFollow('artist_daft')
      const state2 = useEchoStore.getState()
      assert.equal(state2.followedArtistIds.length, 0)
      assert.equal(state2.followedArtists.length, 0)
    })

    it('setFollowedArtists sets both entities and IDs consistently', () => {
      const store = useEchoStore.getState()
      store.setFollowedArtists([
        {
          id: 'artist_a',
          name: 'Artist A',
          followedAt: 100,
          source: 'cloud',
        },
        {
          id: 'artist_b',
          name: 'Artist B',
          followedAt: 200,
          source: 'cloud',
        },
      ])

      const state = useEchoStore.getState()
      assert.deepEqual(state.followedArtistIds, ['artist_a', 'artist_b'])
      assert.equal(state.followedArtists.length, 2)
    })
  })
})
