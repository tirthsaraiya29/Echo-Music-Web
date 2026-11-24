import test from 'node:test'
import assert from 'node:assert'
import {
  radioContinuationQuerySchema,
  parseTimeStringToMs,
  getRadioMetrics,
  resetRadioMetrics,
  resolveRadioContinuation,
} from '../server/routes/radio.ts'
import { QueueManager } from '../src/engine/QueueManager.ts'
import type { Track } from '../src/types/domain.ts'

test('Radio: radioContinuationQuerySchema validates query parameters correctly', () => {
  // Valid videoId
  const r1 = radioContinuationQuerySchema.safeParse({
    videoId: 'sample-video-id',
    gl: 'US',
    hl: 'en',
    explicit: 'true',
  })
  assert.strictEqual(r1.success, true)
  if (r1.success) {
    assert.strictEqual(r1.data.videoId, 'sample-video-id')
    assert.strictEqual(r1.data.gl, 'US')
    assert.strictEqual(r1.data.hl, 'en')
  }

  // Valid continuation token
  const r2 = radioContinuationQuerySchema.safeParse({
    continuation: 'sample-continuation-token-xyz',
    gl: 'GB',
    hl: 'en-GB',
  })
  assert.strictEqual(r2.success, true)

  // Neither videoId nor continuation provided
  const r3 = radioContinuationQuerySchema.safeParse({
    gl: 'US',
    hl: 'en',
  })
  assert.strictEqual(r3.success, false, 'Should reject when neither videoId nor continuation is provided')

  // Invalid gl format
  const r4 = radioContinuationQuerySchema.safeParse({
    videoId: 'vid1',
    gl: 'USA',
  })
  assert.strictEqual(r4.success, false, 'Should reject invalid gl country code')
})

test('Radio: parseTimeStringToMs parses timestamps with boundary and fallback safety', () => {
  assert.strictEqual(parseTimeStringToMs('3:45'), 225000)
  assert.strictEqual(parseTimeStringToMs('0:30'), 30000)
  assert.strictEqual(parseTimeStringToMs('1:15:30'), 4530000)
  assert.strictEqual(parseTimeStringToMs('45'), 45000)
  assert.strictEqual(parseTimeStringToMs(''), 180000, 'Empty string should return fallback')
  assert.strictEqual(parseTimeStringToMs(undefined), 180000, 'Undefined should return fallback')
  assert.strictEqual(parseTimeStringToMs('-1:30'), 180000, 'Negative parts should return fallback')
  assert.strictEqual(parseTimeStringToMs('25:00:00'), 180000, 'Exceeding 24h should return fallback')
  assert.strictEqual(parseTimeStringToMs('invalid', 240000), 240000, 'Custom fallback should be respected')
})

test('Radio: telemetry metrics record activity and reset cleanly', () => {
  resetRadioMetrics()
  const initial = getRadioMetrics()
  assert.strictEqual(initial.requestsTotal, 0)
  assert.strictEqual(initial.successTotal, 0)
  assert.strictEqual(initial.inFlightDeduplicated, 0)

  // Verify reset function clears state
  resetRadioMetrics()
  assert.deepStrictEqual(getRadioMetrics(), {
    requestsTotal: 0,
    successTotal: 0,
    failuresTotal: 0,
    tracksFetched: 0,
    continuationsUsed: 0,
    inFlightDeduplicated: 0,
    lastError: null,
  })
})

test('Radio: resolveRadioContinuation coalesces concurrent in-flight requests', () => {
  resetRadioMetrics()
  // Two calls with identical videoId, gl, hl
  const p1 = resolveRadioContinuation('test-video-dedup-1', undefined, 'US', 'en', true)
  const p2 = resolveRadioContinuation('test-video-dedup-1', undefined, 'US', 'en', true)

  assert.strictEqual(p1, p2, 'Concurrent requests for same video continuation must share identical in-flight promise')
  assert.strictEqual(getRadioMetrics().inFlightDeduplicated, 1)

  // Silently handle resolution or rejection to prevent unhandled rejection
  p1.catch(() => {})
  p2.catch(() => {})
})

test('Radio: QueueManager deduplicates incoming radio tracks against queue contents', () => {
  const qm = new QueueManager()

  const currentTrack: Track = {
    id: 'track-current',
    title: 'Current Song',
    artistName: 'Artist 1',
    artistId: 'art-1',
    durationMs: 200000,
    durationSeconds: 200,
  }

  const upcomingTrack: Track = {
    id: 'track-upnext',
    title: 'Upcoming Song',
    artistName: 'Artist 2',
    artistId: 'art-2',
    durationMs: 180000,
    durationSeconds: 180,
  }

  qm.playTrackDirectly(currentTrack)
  qm.addToQueue(upcomingTrack)

  const radioBatch: Track[] = [
    { ...currentTrack }, // Should be dropped (already current)
    { ...upcomingTrack }, // Should be dropped (already in upNext)
    {
      id: 'track-radio-1',
      title: 'Radio Song 1',
      artistName: 'Artist 3',
      artistId: 'art-3',
      durationMs: 210000,
      durationSeconds: 210,
    },
    {
      id: 'track-radio-1', // Duplicate in same batch - should be dropped
      title: 'Radio Song 1',
      artistName: 'Artist 3',
      artistId: 'art-3',
      durationMs: 210000,
      durationSeconds: 210,
    },
    {
      id: 'track-radio-2',
      title: 'Radio Song 2',
      artistName: 'Artist 4',
      artistId: 'art-4',
      durationMs: 190000,
      durationSeconds: 190,
    },
  ]

  qm.addRadioTracks(radioBatch)

  assert.strictEqual(qm.radioQueue.length, 2, 'Only the 2 unique radio tracks should be added')
  assert.strictEqual(qm.radioQueue[0]?.id, 'track-radio-1')
  assert.strictEqual(qm.radioQueue[1]?.id, 'track-radio-2')
})
