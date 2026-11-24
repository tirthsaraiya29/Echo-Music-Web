import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import {
  reconcilePlaylistTracks,
  playlistSyncResultSchema,
  recordPlaylistSyncMetric,
  getPlaylistSyncMetrics,
  resetPlaylistSyncMetrics,
} from '../src/services/sync/playlistCloudSyncService.ts'

describe('playlistCloudSyncService', () => {
  beforeEach(() => {
    resetPlaylistSyncMetrics()
  })

  describe('Anti-Wipe Protections (Matching upstream SyncUtils.kt)', () => {
    it('prevents playlist wipe when remote returns empty and local has tracks', () => {
      const local = ['track_1', 'track_2', 'track_3']
      const remote: string[] = []

      const result = reconcilePlaylistTracks({
        localTrackIds: local,
        remoteTrackIds: remote,
      })

      assert.strictEqual(result.action, 'wipe_prevented')
      assert.deepStrictEqual(result.finalTrackIds, local)
      assert.strictEqual(result.addedCount, 0)
      assert.match(result.message, /wipe prevented/)

      const metrics = getPlaylistSyncMetrics()
      assert.strictEqual(metrics.wipesPreventedCount, 1)
    })

    it('allows empty remote when allowEmptyRemote is explicitly enabled', () => {
      const local = ['track_1', 'track_2']
      const remote: string[] = []

      const result = reconcilePlaylistTracks({
        localTrackIds: local,
        remoteTrackIds: remote,
        allowEmptyRemote: true,
      })

      assert.strictEqual(result.action, 'full_update')
      assert.deepStrictEqual(result.finalTrackIds, [])
    })
  })

  describe('Additive-Only Synchronization', () => {
    it('preserves local-only tracks and appends missing remote tracks', () => {
      // Local has track_local (added offline) and track_shared
      const local = ['track_local_1', 'track_shared']
      // Remote has track_shared and track_remote_new
      const remote = ['track_shared', 'track_remote_new']

      const result = reconcilePlaylistTracks({
        localTrackIds: local,
        remoteTrackIds: remote,
      })

      assert.strictEqual(result.action, 'additive_merge')
      // Must contain all local tracks plus the new remote track
      assert.deepStrictEqual(result.finalTrackIds, [
        'track_local_1',
        'track_shared',
        'track_remote_new',
      ])
      assert.strictEqual(result.addedCount, 1)

      const metrics = getPlaylistSyncMetrics()
      assert.strictEqual(metrics.additiveSyncsCount, 1)
      assert.strictEqual(metrics.tracksAddedCount, 1)
    })
  })

  describe('Full Update & Exact Match', () => {
    it('reports no_change when local and remote track lists are identical', () => {
      const tracks = ['t_1', 't_2', 't_3']
      const result = reconcilePlaylistTracks({
        localTrackIds: tracks,
        remoteTrackIds: tracks,
      })

      assert.strictEqual(result.action, 'no_change')
      assert.deepStrictEqual(result.finalTrackIds, tracks)
      assert.strictEqual(result.addedCount, 0)
    })

    it('performs full update when remote has a reordered or updated complete list', () => {
      const local = ['t_1', 't_2']
      const remote = ['t_2', 't_1', 't_3'] // reordered + new track

      const result = reconcilePlaylistTracks({
        localTrackIds: local,
        remoteTrackIds: remote,
      })

      assert.strictEqual(result.action, 'full_update')
      assert.deepStrictEqual(result.finalTrackIds, ['t_2', 't_1', 't_3'])
      assert.strictEqual(result.addedCount, 1)
    })
  })

  describe('Schemas & Telemetry', () => {
    it('validates a playlistSyncResult payload correctly', () => {
      const payload = {
        playlistId: 'pl_001',
        browseId: 'VLPL123',
        action: 'additive_merge',
        localCount: 5,
        remoteCount: 6,
        addedCount: 1,
        message: 'Merged 1 new track',
        syncedAt: Date.now(),
      }
      const parsed = playlistSyncResultSchema.parse(payload)
      assert.strictEqual(parsed.playlistId, 'pl_001')
      assert.strictEqual(parsed.action, 'additive_merge')
      assert.strictEqual(parsed.addedCount, 1)
    })

    it('records and resets telemetry metrics', () => {
      recordPlaylistSyncMetric('syncAttemptsCount', 4)
      recordPlaylistSyncMetric('syncSuccessCount', 3)
      recordPlaylistSyncMetric('syncErrorsCount', 1)

      const metrics = getPlaylistSyncMetrics()
      assert.strictEqual(metrics.syncAttemptsCount, 4)
      assert.strictEqual(metrics.syncSuccessCount, 3)
      assert.strictEqual(metrics.syncErrorsCount, 1)

      resetPlaylistSyncMetrics()
      const reset = getPlaylistSyncMetrics()
      assert.strictEqual(reset.syncAttemptsCount, 0)
      assert.strictEqual(reset.syncSuccessCount, 0)
      assert.strictEqual(reset.syncErrorsCount, 0)
    })
  })
})
