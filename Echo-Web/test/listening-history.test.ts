import test from 'node:test'
import assert from 'node:assert'
import {
  listeningEventInputSchema,
  listeningHistoryRecordSchema,
  listeningHistoryMetricsSchema,
  getListeningHistoryMetrics,
  resetListeningHistoryMetrics,
  recordListeningEvent,
  clearTasteListeningHistory,
  getCurrentTimeOfDay,
  calculateTasteScore,
} from '../src/services/recommendations/localTasteEngine.ts'
import type { Track } from '../src/types/domain.ts'

test('Listening History: listeningEventInputSchema validates structure and bounds', () => {
  const validEvent = {
    track: {
      id: 'track_123',
      title: 'Midnight City',
      artistName: 'M83',
      durationSeconds: 243,
    },
    durationPlayedMs: 240000,
    trackDurationMs: 243000,
    completed: true,
    skipped: false,
  }
  assert.strictEqual(listeningEventInputSchema.safeParse(validEvent).success, true)

  // Empty track title fails
  assert.strictEqual(
    listeningEventInputSchema.safeParse({
      ...validEvent,
      track: { ...validEvent.track, title: '' },
    }).success,
    false,
  )

  // Negative played duration fails
  assert.strictEqual(
    listeningEventInputSchema.safeParse({
      ...validEvent,
      durationPlayedMs: -100,
    }).success,
    false,
  )
})

test('Listening History: listeningHistoryRecordSchema validates persistent records', () => {
  const validRecord = {
    id: 1,
    trackId: 'track_abc',
    trackTitle: 'Song Title',
    artistName: 'Artist Name',
    playedAt: Date.now(),
    durationPlayedMs: 180000,
    trackDurationMs: 180000,
    completed: true,
    skipped: false,
    timeOfDay: 'evening' as const,
  }
  assert.strictEqual(listeningHistoryRecordSchema.safeParse(validRecord).success, true)

  // Invalid timeOfDay fails
  assert.strictEqual(
    listeningHistoryRecordSchema.safeParse({
      ...validRecord,
      timeOfDay: 'dawn',
    }).success,
    false,
  )
})

test('Listening History: telemetry metrics, validation drop, and signal cancellation', async () => {
  resetListeningHistoryMetrics()
  const initial = getListeningHistoryMetrics()
  assert.strictEqual(initial.eventsRecorded, 0)
  assert.strictEqual(initial.eventsDropped, 0)
  assert.strictEqual(initial.historyClearedCount, 0)
  assert.strictEqual(listeningHistoryMetricsSchema.safeParse(initial).success, true)

  const testTrack: Track = {
    id: 'track_test_1',
    title: 'Starboy',
    artistName: 'The Weeknd',
    durationSeconds: 230,
  }

  // 1. Record valid event
  await recordListeningEvent({
    track: testTrack,
    durationPlayedMs: 230000,
    trackDurationMs: 230000,
    completed: true,
    skipped: false,
  })
  assert.strictEqual(getListeningHistoryMetrics().eventsRecorded, 1)

  // 2. Malformed input drops event and tracks error
  await recordListeningEvent({
    track: { ...testTrack, title: '' },
    durationPlayedMs: 1000,
    trackDurationMs: 1000,
    completed: true,
    skipped: false,
  })
  assert.strictEqual(getListeningHistoryMetrics().eventsDropped, 1)
  assert.ok(getListeningHistoryMetrics().lastError)

  // 3. Signal cancellation drops event
  const abortCtrl = new AbortController()
  abortCtrl.abort()
  await recordListeningEvent(
    {
      track: testTrack,
      durationPlayedMs: 5000,
      trackDurationMs: 200000,
      completed: false,
      skipped: true,
    },
    { signal: abortCtrl.signal },
  )
  assert.strictEqual(getListeningHistoryMetrics().eventsDropped, 2)
  assert.strictEqual(
    getListeningHistoryMetrics().lastError,
    'Listening event recording cancelled',
  )

  // 4. Clear history tracks metric
  await clearTasteListeningHistory()
  assert.strictEqual(getListeningHistoryMetrics().historyClearedCount, 1)

  // 5. Reset metrics
  resetListeningHistoryMetrics()
  assert.strictEqual(getListeningHistoryMetrics().eventsRecorded, 0)
  assert.strictEqual(getListeningHistoryMetrics().eventsDropped, 0)
  assert.strictEqual(getListeningHistoryMetrics().historyClearedCount, 0)
  assert.strictEqual(getListeningHistoryMetrics().lastError, null)
})

test('Listening History: getCurrentTimeOfDay and calculateTasteScore scoring', () => {
  const tod = getCurrentTimeOfDay()
  assert.ok(['morning', 'afternoon', 'evening', 'night'].includes(tod))

  const now = Date.now()
  const history = [
    {
      id: 1,
      trackId: 't1',
      trackTitle: 'Song One',
      artistName: 'Artist A',
      playedAt: now - 3600000, // 1 hour ago
      durationPlayedMs: 180000,
      trackDurationMs: 180000,
      completed: true,
      skipped: false,
      timeOfDay: tod,
    },
    {
      id: 2,
      trackId: 't2',
      trackTitle: 'Song Two',
      artistName: 'Artist B',
      playedAt: now - 86400000, // 1 day ago
      durationPlayedMs: 10000,
      trackDurationMs: 200000,
      completed: false,
      skipped: true,
      timeOfDay: tod,
    },
  ]

  const exclusions = new Set(['t3'])
  const liked = new Set(['t1'])

  const scores = calculateTasteScore(history, exclusions, liked, now)
  assert.ok(scores.length > 0)
  const scoreT1 = scores.find((s) => s.trackId === 't1')
  const scoreT2 = scores.find((s) => s.trackId === 't2')

  assert.ok(scoreT1)
  assert.ok(scoreT2)
  // Completed + liked + recent should score noticeably higher than skipped
  assert.ok(scoreT1.score > scoreT2.score)
})
