import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  playlistConflictEntitySchema,
  conflictResolutionResultSchema,
  libraryConflictMetricsSchema,
  resolvePlaylistConflict,
  reconcilePlaylistsWithConflictResolution,
  recordConflictMetric,
  getLibraryConflictMetrics,
  resetLibraryConflictMetrics,
  type PlaylistConflictEntity,
} from '../src/services/sync/libraryConflictResolver.ts'
import { useEchoStore } from '../src/stores/useEchoStore.ts'

describe('Library Conflict Resolution Service', () => {
  beforeEach(() => {
    resetLibraryConflictMetrics()
    useEchoStore.setState({
      playlists: [],
      playlistTombstones: {},
    })
  })

  describe('Schemas', () => {
    it('validates a valid PlaylistConflictEntity', () => {
      const pl = playlistConflictEntitySchema.parse({
        id: 'pl_test_1',
        title: 'Morning Acoustic',
        description: 'Peaceful morning tracks',
        owner: 'You',
        trackIds: ['t1', 't2'],
        createdAt: 1000,
        updatedAt: 2000,
        revision: 2,
      })

      assert.equal(pl.id, 'pl_test_1')
      assert.equal(pl.title, 'Morning Acoustic')
      assert.equal(pl.revision, 2)
      assert.equal(pl.trackIds.length, 2)
    })

    it('validates ConflictResolutionResult schema', () => {
      const result = conflictResolutionResultSchema.parse({
        action: 'merge_tracks',
        resolved: {
          id: 'pl_1',
          title: 'Road Trip',
          description: '',
          owner: 'You',
          image: '',
          trackIds: ['t1', 't2', 't3'],
          curated: false,
          createdAt: 1000,
          updatedAt: 2000,
          revision: 3,
        },
        reason: 'Merged 3 tracks concurrently added across devices',
      })

      assert.equal(result.action, 'merge_tracks')
      assert.ok(result.resolved !== null)
      assert.equal(result.resolved?.trackIds.length, 3)
    })

    it('validates LibraryConflictMetrics schema', () => {
      const metrics = libraryConflictMetricsSchema.parse({
        conflictsDetectedCount: 5,
        conflictsResolvedLWWCount: 3,
        trackMergesCount: 2,
        tombstoneDeletionsCount: 1,
        resurrectionsCount: 1,
      })

      assert.equal(metrics.conflictsDetectedCount, 5)
      assert.equal(metrics.trackMergesCount, 2)
    })
  })

  describe('Core Conflict Resolution Cases', () => {
    const baseLocal: PlaylistConflictEntity = {
      id: 'pl_alpha',
      title: 'Summer Vibes',
      description: 'Original description',
      owner: 'You',
      image: '',
      trackIds: ['t1', 't2'],
      curated: false,
      createdAt: 1000,
      updatedAt: 2000,
      revision: 2,
    }

    it('keeps local when only local exists and has no tombstone', () => {
      const tombstones = new Map<string, number>()
      const res = resolvePlaylistConflict(baseLocal, null, tombstones)

      assert.equal(res.action, 'keep_local')
      assert.equal(res.resolved?.id, 'pl_alpha')
    })

    it('deletes playlist when remote tombstone is newer than local edit', () => {
      const tombstones = new Map<string, number>([['pl_alpha', 3000]]) // Deleted at 3000, local edited at 2000
      const res = resolvePlaylistConflict(baseLocal, null, tombstones)

      assert.equal(res.action, 'delete_tombstone')
      assert.equal(res.resolved, null)
      assert.equal(getLibraryConflictMetrics().tombstoneDeletionsCount, 1)
    })

    it('resurrects playlist when local edit occurred after remote deletion tombstone', () => {
      const tombstones = new Map<string, number>([['pl_alpha', 1500]]) // Deleted at 1500, local edited at 5000
      const recentLocal: PlaylistConflictEntity = {
        ...baseLocal,
        updatedAt: 5000,
      }
      const res = resolvePlaylistConflict(recentLocal, null, tombstones)

      assert.equal(res.action, 'resurrect')
      assert.ok(res.resolved !== null)
      assert.equal(res.resolved?.id, 'pl_alpha')
      assert.equal(getLibraryConflictMetrics().resurrectionsCount, 1)
    })

    it('returns keep_local when both local and remote are identical', () => {
      const tombstones = new Map<string, number>()
      const res = resolvePlaylistConflict(baseLocal, { ...baseLocal }, tombstones)

      assert.equal(res.action, 'keep_local')
      assert.equal(getLibraryConflictMetrics().conflictsDetectedCount, 0)
    })

    it('merges tracks additively when tracks differ concurrently', () => {
      const tombstones = new Map<string, number>()
      const remoteWithTrack3: PlaylistConflictEntity = {
        id: 'pl_alpha',
        title: 'Summer Vibes (Updated)',
        description: 'Original description',
        owner: 'You',
        image: '',
        trackIds: ['t1', 't3'], // Added t3, while local has t2
        curated: false,
        createdAt: 1000,
        updatedAt: 2500,
        revision: 3,
      }

      const res = resolvePlaylistConflict(baseLocal, remoteWithTrack3, tombstones)

      assert.equal(res.action, 'merge_tracks')
      assert.ok(res.resolved !== null)
      // Union of ['t1', 't2'] and ['t1', 't3'] = ['t1', 't2', 't3']
      assert.deepEqual(res.resolved?.trackIds, ['t1', 't2', 't3'])
      // Title from dominant remote revision
      assert.equal(res.resolved?.title, 'Summer Vibes (Updated)')
      assert.equal(getLibraryConflictMetrics().conflictsDetectedCount, 1)
      assert.equal(getLibraryConflictMetrics().trackMergesCount, 1)
    })

    it('resolves metadata conflicts via Last-Write-Wins (LWW) when tracklists match', () => {
      const tombstones = new Map<string, number>()
      const remoteNewer: PlaylistConflictEntity = {
        ...baseLocal,
        title: 'Summer Vibes 2026',
        description: 'New Description',
        updatedAt: 3000,
        revision: 3,
      }

      const res = resolvePlaylistConflict(baseLocal, remoteNewer, tombstones)

      assert.equal(res.action, 'accept_remote')
      assert.equal(res.resolved?.title, 'Summer Vibes 2026')
      assert.equal(getLibraryConflictMetrics().conflictsResolvedLWWCount, 1)
    })
  })

  describe('Multi-Playlist Reconciliation', () => {
    it('reconciles collections and cleans expired tombstones', () => {
      const local = [
        {
          id: 'pl_1',
          title: 'Playlist 1',
          description: '',
          owner: 'You',
          image: '',
          trackIds: ['a'],
          curated: false,
          createdAt: 1000,
          updatedAt: 2000,
          revision: 1,
        },
      ]

      const remote = [
        {
          id: 'pl_2',
          title: 'Playlist 2',
          description: '',
          owner: 'You',
          image: '',
          trackIds: ['b'],
          curated: false,
          createdAt: 1000,
          updatedAt: 2000,
          revision: 1,
        },
      ]

      // Expired tombstone older than 30 days
      const expiredTime = Date.now() - 35 * 24 * 60 * 60 * 1000
      const tombstones = new Map<string, number>([['expired_pl', expiredTime]])

      const result = reconcilePlaylistsWithConflictResolution(local, remote, tombstones)

      assert.equal(result.resolvedPlaylists.length, 2)
      assert.equal(result.updatedTombstones.has('expired_pl'), false)
    })
  })

  describe('Store Integration', () => {
    it('bumps revision and timestamps on playlist creation and updates', () => {
      const store = useEchoStore.getState()
      const plId = store.createPlaylist('Study Beats', 'Focus music')

      const created = useEchoStore.getState().playlists.find((p) => p.id === plId)
      assert.ok(created !== undefined)
      assert.equal(created?.revision, 1)
      assert.ok((created?.updatedAt || 0) > 0)

      useEchoStore.getState().updatePlaylist(plId, 'Deep Focus', 'Updated description')
      const updated = useEchoStore.getState().playlists.find((p) => p.id === plId)
      assert.equal(updated?.title, 'Deep Focus')
      assert.equal(updated?.revision, 2)

      useEchoStore.getState().deletePlaylist(plId)
      const stateAfterDelete = useEchoStore.getState()
      assert.equal(stateAfterDelete.playlists.find((p) => p.id === plId), undefined)
      assert.ok(stateAfterDelete.playlistTombstones[plId] !== undefined)
    })

    it('resolvePlaylistConflicts updates store deterministically', () => {
      useEchoStore.setState({
        playlists: [
          {
            id: 'sync_pl_1',
            title: 'Local Title',
            description: '',
            owner: 'You',
            image: '',
            trackIds: ['track_1'],
            curated: false,
            createdAt: 1000,
            updatedAt: 1000,
            revision: 1,
          },
        ],
      })

      useEchoStore.getState().resolvePlaylistConflicts([
        {
          id: 'sync_pl_1',
          title: 'Remote Title (Newer)',
          description: '',
          owner: 'You',
          image: '',
          trackIds: ['track_1', 'track_2'],
          curated: false,
          createdAt: 1000,
          updatedAt: 2000,
          revision: 2,
        },
      ])

      const state = useEchoStore.getState()
      const resolved = state.playlists.find((p) => p.id === 'sync_pl_1')
      assert.ok(resolved !== undefined)
      assert.deepEqual(resolved?.trackIds, ['track_1', 'track_2'])
      assert.equal(resolved?.title, 'Remote Title (Newer)')
    })
  })
})
