import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  historyRecordSchema,
  historyFilterOptionsSchema,
  historyMetricsSchema,
  getTimeOfDay,
  getDeviceName,
  exportHistoryJson,
  exportHistoryCsv,
  recordHistoryMetric,
  getHistoryMetrics,
  resetHistoryMetrics,
} from '../src/services/history/listeningHistoryService.ts'

describe('Listening History Controls Service', () => {
  beforeEach(() => {
    resetHistoryMetrics()
  })

  describe('Schemas', () => {
    it('validates a valid HistoryRecord', () => {
      const rec = historyRecordSchema.parse({
        id: 1,
        trackId: 'track_test_123',
        trackTitle: 'Midnight City',
        artistName: 'M83',
        albumTitle: 'Hurry Up, We\'re Dreaming',
        playedAt: 1700000000000,
        durationPlayedMs: 240000,
        trackDurationMs: 243000,
        completed: true,
        skipped: false,
        timeOfDay: 'night',
        deviceId: 'device_test_1',
        deviceName: 'Chrome on Windows',
        source: 'youtube',
      })

      assert.equal(rec.id, 1)
      assert.equal(rec.trackTitle, 'Midnight City')
      assert.equal(rec.completed, true)
      assert.equal(rec.source, 'youtube')
    })

    it('rejects invalid history record missing required fields', () => {
      assert.throws(() =>
        historyRecordSchema.parse({
          // missing trackTitle and artistName
          trackId: 'track_1',
          playedAt: 1000,
        }),
      )
    })

    it('validates HistoryFilterOptions schema defaults', () => {
      const opts = historyFilterOptionsSchema.parse({})
      assert.equal(opts.source, 'all')
      assert.equal(opts.dateRange, 'all')
      assert.equal(opts.limit, 100)
      assert.equal(opts.offset, 0)
    })

    it('validates HistoryMetrics schema', () => {
      const m = historyMetricsSchema.parse({
        recordsAddedCount: 15,
        recordsQueriedCount: 20,
        recordsDeletedCount: 2,
        exportsCount: 3,
        historyClearedCount: 1,
      })

      assert.equal(m.recordsAddedCount, 15)
      assert.equal(m.exportsCount, 3)
    })
  })

  describe('Helpers & Context Attribution', () => {
    it('determines time of day accurately', () => {
      const morning = new Date(2026, 0, 1, 8, 0, 0)
      const afternoon = new Date(2026, 0, 1, 14, 0, 0)
      const evening = new Date(2026, 0, 1, 19, 0, 0)
      const night = new Date(2026, 0, 1, 23, 0, 0)

      assert.equal(getTimeOfDay(morning), 'morning')
      assert.equal(getTimeOfDay(afternoon), 'afternoon')
      assert.equal(getTimeOfDay(evening), 'evening')
      assert.equal(getTimeOfDay(night), 'night')
    })

    it('returns a device name', () => {
      const name = getDeviceName()
      assert.ok(typeof name === 'string')
      assert.ok(name.length > 0)
    })
  })

  describe('Export Operations', () => {
    it('exports history as JSON', async () => {
      const jsonStr = await exportHistoryJson()
      assert.ok(typeof jsonStr === 'string')
      assert.doesNotThrow(() => JSON.parse(jsonStr))
      assert.equal(getHistoryMetrics().exportsCount, 1)
    })

    it('exports history as CSV with header and formatting', async () => {
      const csvStr = await exportHistoryCsv()
      assert.ok(typeof csvStr === 'string')
      assert.ok(csvStr.includes('ID,Track ID,Title,Artist,Album'))
      assert.equal(getHistoryMetrics().exportsCount, 1)
    })
  })

  describe('Telemetry & Metrics', () => {
    it('records and resets history metrics', () => {
      recordHistoryMetric('recordsAddedCount', 5)
      recordHistoryMetric('recordsDeletedCount', 2)
      recordHistoryMetric('historyClearedCount', 1)

      const m = getHistoryMetrics()
      assert.equal(m.recordsAddedCount, 5)
      assert.equal(m.recordsDeletedCount, 2)
      assert.equal(m.historyClearedCount, 1)

      resetHistoryMetrics()
      const reset = getHistoryMetrics()
      assert.equal(reset.recordsAddedCount, 0)
      assert.equal(reset.recordsDeletedCount, 0)
      assert.equal(reset.historyClearedCount, 0)
    })
  })
})
