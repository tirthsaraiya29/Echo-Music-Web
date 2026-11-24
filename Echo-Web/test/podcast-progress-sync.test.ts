import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import {
  REMOTE_PLAYED_PERCENT,
  REMOTE_AHEAD_MARGIN_MS,
  podcastProgressRecordSchema,
  podcastProgressExportSchema,
  syncBroadcastMessageSchema,
  progressSyncMetricsSchema,
  mergeRemoteProgress,
  PodcastProgressSynchronizer,
  exportPodcastProgress,
  importPodcastProgress,
  recordProgressSyncMetric,
  getProgressSyncMetrics,
  resetProgressSyncMetrics,
} from '../src/services/podcast/podcastProgressSyncService.ts'
import type { PodcastProgressRecord } from '../src/services/db/echoDatabase.ts'

describe('FEATURE-039: Podcast Progress Sync', () => {
  beforeEach(() => {
    resetProgressSyncMetrics()
  })

  describe('Upstream Architecture Constants', () => {
    it('matches upstream Echo Music PodcastProgress.kt remote merge constants', () => {
      assert.strictEqual(REMOTE_PLAYED_PERCENT, 95)
      assert.strictEqual(REMOTE_AHEAD_MARGIN_MS, 60_000)
    })
  })

  describe('Zod Validation Schemas', () => {
    it('validates podcast progress record schema', () => {
      const rec = podcastProgressRecordSchema.parse({
        episodeId: 'ep-sync-01',
        showTitle: 'Daily Podcast',
        episodeTitle: 'Syncing Across Tabs',
        positionSeconds: 300,
        durationSeconds: 1800,
        positionMs: 300_000,
        durationMs: 1_800_000,
        completed: false,
        dismissed: false,
        updatedAt: Date.now(),
      })
      assert.strictEqual(rec.episodeId, 'ep-sync-01')
      assert.strictEqual(rec.completed, false)
    })

    it('validates sync broadcast message discriminated union', () => {
      const msg1 = syncBroadcastMessageSchema.parse({
        type: 'PROGRESS_UPDATE',
        record: {
          episodeId: 'ep-02',
          showTitle: 'Show',
          episodeTitle: 'Ep',
          positionSeconds: 120,
          durationSeconds: 600,
          positionMs: 120_000,
          durationMs: 600_000,
          completed: false,
          dismissed: false,
          updatedAt: Date.now(),
        },
      })
      assert.strictEqual(msg1.type, 'PROGRESS_UPDATE')

      const msg2 = syncBroadcastMessageSchema.parse({
        type: 'DISMISS_EPISODE',
        episodeId: 'ep-02',
      })
      assert.strictEqual(msg2.type, 'DISMISS_EPISODE')
    })

    it('validates export payload schema', () => {
      const exp = podcastProgressExportSchema.parse({
        version: 1,
        timestamp: Date.now(),
        device: 'Echo-Web',
        records: [],
      })
      assert.strictEqual(exp.version, 1)
      assert.strictEqual(exp.device, 'Echo-Web')
    })

    it('validates sync metrics schema', () => {
      const metrics = progressSyncMetricsSchema.parse({
        broadcastsSent: 3,
        broadcastsReceived: 3,
        remoteProgressMerged: 1,
        conflictsResolved: 1,
        exportsGenerated: 2,
        importsProcessed: 5,
      })
      assert.strictEqual(metrics.broadcastsSent, 3)
    })
  })

  describe('mergeRemoteProgress (Upstream Algorithm)', () => {
    it('creates new local record when existing is null', () => {
      const { updatedRecord, wasMerged } = mergeRemoteProgress(null, {
        episodeId: 'ep-remote-1',
        showTitle: 'Show A',
        episodeTitle: 'Episode A',
        playedPercent: 50,
        durationSeconds: 1000,
      })
      assert.strictEqual(wasMerged, true)
      assert.ok(updatedRecord)
      assert.strictEqual(updatedRecord.positionSeconds, 500)
      assert.strictEqual(updatedRecord.completed, false)
    })

    it('marks record as completed when remotePlayedPercent >= 95%', () => {
      const { updatedRecord, wasMerged } = mergeRemoteProgress(null, {
        episodeId: 'ep-remote-2',
        showTitle: 'Show B',
        episodeTitle: 'Episode B',
        playedPercent: 96,
        durationSeconds: 1000,
      })
      assert.strictEqual(wasMerged, true)
      assert.ok(updatedRecord)
      assert.strictEqual(updatedRecord.completed, true)
      assert.strictEqual(updatedRecord.positionSeconds, 0)
    })

    it('preserves locally finished episodes and never un-completes them', () => {
      const existing: PodcastProgressRecord = {
        episodeId: 'ep-finished',
        showTitle: 'Show C',
        episodeTitle: 'Episode C',
        positionSeconds: 0,
        durationSeconds: 1000,
        positionMs: 0,
        durationMs: 1000000,
        completed: true,
        dismissed: false,
        updatedAt: 100,
      }
      const { updatedRecord, wasMerged } = mergeRemoteProgress(existing, {
        episodeId: 'ep-finished',
        playedPercent: 40, // remote thinks only 40%
        durationSeconds: 1000,
      })
      assert.strictEqual(wasMerged, false)
      assert.strictEqual(updatedRecord?.completed, true)
    })

    it('ignores remote if remote is not clearly ahead of local (> 60s margin)', () => {
      const existing: PodcastProgressRecord = {
        episodeId: 'ep-close',
        showTitle: 'Show D',
        episodeTitle: 'Episode D',
        positionSeconds: 500, // 500s
        durationSeconds: 1000,
        positionMs: 500_000,
        durationMs: 1_000_000,
        completed: false,
        dismissed: false,
        updatedAt: 100,
      }
      // Remote says 52% (520s) -> lead is only 20s, less than 60s margin
      const { wasMerged } = mergeRemoteProgress(existing, {
        episodeId: 'ep-close',
        playedPercent: 52,
        durationSeconds: 1000,
      })
      assert.strictEqual(wasMerged, false)
    })

    it('updates local when remote has clear lead (> 60s ahead)', () => {
      const existing: PodcastProgressRecord = {
        episodeId: 'ep-ahead',
        showTitle: 'Show E',
        episodeTitle: 'Episode E',
        positionSeconds: 200, // 200s
        durationSeconds: 1000,
        positionMs: 200_000,
        durationMs: 1_000_000,
        completed: false,
        dismissed: false,
        updatedAt: 100,
      }
      // Remote says 40% (400s) -> lead is 200s, well over 60s margin
      const { updatedRecord, wasMerged } = mergeRemoteProgress(existing, {
        episodeId: 'ep-ahead',
        playedPercent: 40,
        durationSeconds: 1000,
      })
      assert.strictEqual(wasMerged, true)
      assert.strictEqual(updatedRecord?.positionSeconds, 400)
    })
  })

  describe('PodcastProgressSynchronizer', () => {
    it('dispatches broadcast messages and invokes local listeners', () => {
      const sync = PodcastProgressSynchronizer.getInstance()
      let received: unknown = null

      const unsubscribe = sync.subscribe((msg) => {
        received = msg
      })

      const testRecord: PodcastProgressRecord = {
        episodeId: 'ep-test-sync',
        showTitle: 'Sync Show',
        episodeTitle: 'Broadcast Ep',
        positionSeconds: 60,
        durationSeconds: 600,
        positionMs: 60000,
        durationMs: 600000,
        completed: false,
        dismissed: false,
        updatedAt: Date.now(),
      }

      sync.broadcastProgress(testRecord)

      const metrics = getProgressSyncMetrics()
      assert.strictEqual(metrics.broadcastsSent, 1)

      unsubscribe()
    })
  })

  describe('Telemetry Metrics', () => {
    it('increments sync metrics and resets cleanly', () => {
      recordProgressSyncMetric('broadcastsSent')
      recordProgressSyncMetric('broadcastsReceived')
      recordProgressSyncMetric('remoteProgressMerged')
      recordProgressSyncMetric('conflictsResolved')
      recordProgressSyncMetric('exportsGenerated')
      recordProgressSyncMetric('importsProcessed', 3)

      const m = getProgressSyncMetrics()
      assert.strictEqual(m.broadcastsSent, 1)
      assert.strictEqual(m.broadcastsReceived, 1)
      assert.strictEqual(m.remoteProgressMerged, 1)
      assert.strictEqual(m.conflictsResolved, 1)
      assert.strictEqual(m.exportsGenerated, 1)
      assert.strictEqual(m.importsProcessed, 3)

      resetProgressSyncMetrics()
      const r = getProgressSyncMetrics()
      assert.strictEqual(r.broadcastsSent, 0)
      assert.strictEqual(r.importsProcessed, 0)
    })
  })
})
