import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  likedAlbumEntitySchema,
  likedAlbumsSyncResultSchema,
  likedAlbumsSyncMetricsSchema,
  reconcileLikedAlbums,
  recordLikedAlbumsMetric,
  getLikedAlbumsMetrics,
  resetLikedAlbumsMetrics,
  type LikedAlbumEntity,
} from '../src/services/sync/likedAlbumsSyncService.ts'
import { useEchoStore } from '../src/stores/useEchoStore.ts'

describe('Liked Albums Synchronization & Anti-Wipe Protection', () => {
  beforeEach(() => {
    resetLikedAlbumsMetrics()
    useEchoStore.setState({
      likedAlbumIds: [],
      likedAlbums: [],
    })
  })

  describe('Zod Schemas', () => {
    it('validates a valid LikedAlbumEntity', () => {
      const album = likedAlbumEntitySchema.parse({
        id: 'MPREb_album123',
        title: 'Dark Side of the Moon',
        artistName: 'Pink Floyd',
        artistId: 'UCpinkfloyd',
        year: 1973,
        coverUrl: 'https://example.com/cover.jpg',
        trackCount: 10,
        source: 'cloud',
      })

      assert.equal(album.id, 'MPREb_album123')
      assert.equal(album.title, 'Dark Side of the Moon')
      assert.equal(album.artistName, 'Pink Floyd')
      assert.equal(album.year, 1973)
      assert.equal(album.source, 'cloud')
      assert.ok(album.likedAt > 0)
    })

    it('rejects invalid album entity missing id or title', () => {
      assert.throws(() =>
        likedAlbumEntitySchema.parse({
          id: '',
          title: 'No ID',
          artistName: 'Artist',
        }),
      )

      assert.throws(() =>
        likedAlbumEntitySchema.parse({
          id: 'valid_id',
          title: '',
          artistName: 'Artist',
        }),
      )
    })

    it('validates LikedAlbumsSyncResult schema', () => {
      const result = likedAlbumsSyncResultSchema.parse({
        action: 'additive_merge',
        localCount: 5,
        remoteCount: 3,
        addedCount: 2,
        message: 'Preserved 2 local albums and merged 2 cloud albums',
        syncedAt: 1700000000000,
      })

      assert.equal(result.action, 'additive_merge')
      assert.equal(result.localCount, 5)
    })

    it('validates LikedAlbumsSyncMetrics schema', () => {
      const metrics = likedAlbumsSyncMetricsSchema.parse({
        syncAttemptsCount: 10,
        syncSuccessCount: 9,
        syncErrorsCount: 1,
        wipesPreventedCount: 2,
        albumsSyncedCount: 15,
        additiveSyncsCount: 3,
      })

      assert.equal(metrics.syncAttemptsCount, 10)
      assert.equal(metrics.wipesPreventedCount, 2)
    })
  })

  describe('Anti-Wipe Reconciliation Algorithm', () => {
    const mockAlbum1: LikedAlbumEntity = {
      id: 'album_1',
      title: 'Abbey Road',
      artistName: 'The Beatles',
      likedAt: 1000,
      source: 'local',
    }

    const mockAlbum2: LikedAlbumEntity = {
      id: 'album_2',
      title: 'Thriller',
      artistName: 'Michael Jackson',
      likedAt: 2000,
      source: 'local',
    }

    const mockAlbum3: LikedAlbumEntity = {
      id: 'album_3',
      title: 'Rumours',
      artistName: 'Fleetwood Mac',
      likedAt: 3000,
      source: 'cloud',
    }

    it('prevents accidental wipe when remote returns empty and local has albums', () => {
      const res = reconcileLikedAlbums({
        localAlbums: [mockAlbum1, mockAlbum2],
        remoteAlbums: [],
        allowEmptyRemote: false,
      })

      assert.equal(res.action, 'wipe_prevented')
      assert.equal(res.finalAlbums.length, 2)
      assert.deepEqual(res.finalAlbums.map((a) => a.id), ['album_1', 'album_2'])
      assert.equal(getLikedAlbumsMetrics().wipesPreventedCount, 1)
    })

    it('allows empty remote when allowEmptyRemote is explicitly enabled', () => {
      const res = reconcileLikedAlbums({
        localAlbums: [mockAlbum1],
        remoteAlbums: [],
        allowEmptyRemote: true,
      })

      assert.equal(res.action, 'full_update')
      assert.equal(res.finalAlbums.length, 0)
    })

    it('returns no_change when local and remote match identically', () => {
      const res = reconcileLikedAlbums({
        localAlbums: [mockAlbum1, mockAlbum2],
        remoteAlbums: [mockAlbum1, mockAlbum2],
      })

      assert.equal(res.action, 'no_change')
      assert.equal(res.finalAlbums.length, 2)
      assert.equal(res.addedCount, 0)
    })

    it('performs additive merge preserving local albums not present on cloud', () => {
      const res = reconcileLikedAlbums({
        localAlbums: [mockAlbum1, mockAlbum2],
        remoteAlbums: [mockAlbum1, mockAlbum3], // mockAlbum2 is local-only, mockAlbum3 is cloud-only
      })

      assert.equal(res.action, 'additive_merge')
      assert.equal(res.finalAlbums.length, 3)
      assert.deepEqual(res.finalAlbums.map((a) => a.id), ['album_1', 'album_2', 'album_3'])
      assert.equal(res.addedCount, 1)
      assert.equal(getLikedAlbumsMetrics().additiveSyncsCount, 1)
      assert.equal(getLikedAlbumsMetrics().albumsSyncedCount, 1)
    })

    it('performs full update when cloud contains all local albums plus new cloud albums', () => {
      const res = reconcileLikedAlbums({
        localAlbums: [mockAlbum1],
        remoteAlbums: [mockAlbum1, mockAlbum3],
      })

      assert.equal(res.action, 'full_update')
      assert.equal(res.finalAlbums.length, 2)
      assert.deepEqual(res.finalAlbums.map((a) => a.id), ['album_1', 'album_3'])
      assert.equal(res.addedCount, 1)
    })
  })

  describe('Telemetry & Metrics', () => {
    it('records and resets metrics correctly', () => {
      recordLikedAlbumsMetric('syncAttemptsCount', 3)
      recordLikedAlbumsMetric('syncSuccessCount', 2)
      recordLikedAlbumsMetric('syncErrorsCount', 1)

      const m = getLikedAlbumsMetrics()
      assert.equal(m.syncAttemptsCount, 3)
      assert.equal(m.syncSuccessCount, 2)
      assert.equal(m.syncErrorsCount, 1)

      resetLikedAlbumsMetrics()
      const reset = getLikedAlbumsMetrics()
      assert.equal(reset.syncAttemptsCount, 0)
      assert.equal(reset.syncSuccessCount, 0)
      assert.equal(reset.syncErrorsCount, 0)
    })
  })

  describe('Zustand Store Integration', () => {
    it('toggles album like with metadata and persists both ID and entity', () => {
      const store = useEchoStore.getState()
      assert.equal(store.likedAlbumIds.length, 0)
      assert.equal(store.likedAlbums.length, 0)

      store.toggleAlbumLike('album_xyz', {
        title: 'Random Access Memories',
        artistName: 'Daft Punk',
        artistId: 'UCdaftpunk',
        year: 2013,
        thumbnailUrl: 'https://example.com/ram.jpg',
        trackCount: 13,
      })

      const state1 = useEchoStore.getState()
      assert.deepEqual(state1.likedAlbumIds, ['album_xyz'])
      assert.equal(state1.likedAlbums.length, 1)
      assert.equal(state1.likedAlbums[0]?.id, 'album_xyz')
      assert.equal(state1.likedAlbums[0]?.title, 'Random Access Memories')
      assert.equal(state1.likedAlbums[0]?.artistName, 'Daft Punk')
      assert.equal(state1.likedAlbums[0]?.year, 2013)
      assert.equal(state1.likedAlbums[0]?.coverUrl, 'https://example.com/ram.jpg')

      // Toggling again removes the album
      state1.toggleAlbumLike('album_xyz')
      const state2 = useEchoStore.getState()
      assert.equal(state2.likedAlbumIds.length, 0)
      assert.equal(state2.likedAlbums.length, 0)
    })

    it('setLikedAlbums sets both entities and IDs consistently', () => {
      const store = useEchoStore.getState()
      store.setLikedAlbums([
        {
          id: 'album_a',
          title: 'Album A',
          artistName: 'Artist A',
          likedAt: 100,
          source: 'cloud',
        },
        {
          id: 'album_b',
          title: 'Album B',
          artistName: 'Artist B',
          likedAt: 200,
          source: 'cloud',
        },
      ])

      const state = useEchoStore.getState()
      assert.deepEqual(state.likedAlbumIds, ['album_a', 'album_b'])
      assert.equal(state.likedAlbums.length, 2)
    })
  })
})
