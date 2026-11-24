import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import {
  episodeProgressSchema,
  podcastProgressMetricsSchema,
  isNearEnd,
  shouldResumeEpisode,
  calculateEpisodeFraction,
  calculateRemainingSeconds,
  formatRemainingTime,
  createProgressRecord,
  getPodcastProgressMetrics,
  resetPodcastProgressMetrics,
  recordPodcastProgressMetric,
  MIN_POSITION_MS,
} from '../src/services/podcast/podcastProgressService.ts'
import type { Track } from '../src/types/domain.ts'

describe('Continue Listening & Podcast Progress [FEATURE-033]', () => {
  beforeEach(() => {
    resetPodcastProgressMetrics()
  })

  it('validates episodeProgressSchema correctly', () => {
    const valid = {
      episodeId: 'ep_science_1',
      showTitle: 'Science Weekly',
      episodeTitle: 'The Quantum Leap',
      positionMs: 600000,
      durationMs: 1800000,
      positionSeconds: 600,
      durationSeconds: 1800,
      completed: false,
      dismissed: false,
      updatedAt: 1700000000000,
    }
    const parsed = episodeProgressSchema.parse(valid)
    assert.strictEqual(parsed.episodeId, 'ep_science_1')
    assert.strictEqual(parsed.positionSeconds, 600)
    assert.strictEqual(parsed.completed, false)

    assert.throws(() => {
      episodeProgressSchema.parse({ episodeId: '', positionMs: -50 })
    })
  })

  it('detects when an episode position is near its end with isNearEnd', () => {
    const durationMs = 3600000 // 1 hour (5% = 180,000ms = 3 minutes)

    // 1. Midway (30 minutes in) -> not near end
    assert.strictEqual(isNearEnd(1800000, durationMs), false)

    // 2. 5 minutes before end -> not near end (margin capped at 3 min)
    assert.strictEqual(isNearEnd(3300000, durationMs), false)

    // 3. 2 minutes before end -> near end (within 3 min margin)
    assert.strictEqual(isNearEnd(3480000, durationMs), true)

    // 4. At or beyond duration -> near end
    assert.strictEqual(isNearEnd(3600000, durationMs), true)
    assert.strictEqual(isNearEnd(3601000, durationMs), true)

    // 5. Zero duration edge cases
    assert.strictEqual(isNearEnd(0, 0), false)
    assert.strictEqual(isNearEnd(100, 0), false)
  })

  it('evaluates resume conditions accurately with shouldResumeEpisode', () => {
    const durationMs = 1800000 // 30 minutes

    // 1. Valid in-progress episode (10 minutes in)
    const validRecord = {
      episodeId: 'ep_1',
      showTitle: 'Tech Show',
      episodeTitle: 'Ep 1',
      positionMs: 600000,
      durationMs,
      completed: false,
      dismissed: false,
      updatedAt: Date.now(),
    }
    const res1 = shouldResumeEpisode(validRecord)
    assert.strictEqual(res1.shouldResume, true)
    assert.strictEqual(res1.seekPositionSeconds, 600)

    // 2. Early position (< 5 seconds) -> starts from beginning
    const earlyRecord = { ...validRecord, positionMs: 3000 }
    const res2 = shouldResumeEpisode(earlyRecord)
    assert.strictEqual(res2.shouldResume, false)
    assert.strictEqual(res2.seekPositionSeconds, 0)

    // 3. Completed episode -> starts from beginning
    const completedRecord = { ...validRecord, completed: true }
    const res3 = shouldResumeEpisode(completedRecord)
    assert.strictEqual(res3.shouldResume, false)

    // 4. Dismissed episode -> starts from beginning
    const dismissedRecord = { ...validRecord, dismissed: true }
    const res4 = shouldResumeEpisode(dismissedRecord)
    assert.strictEqual(res4.shouldResume, false)

    // 5. Near end position (> 29 minutes in 30m episode) -> treated as completed
    const nearEndRecord = { ...validRecord, positionMs: 1750000 }
    const res5 = shouldResumeEpisode(nearEndRecord)
    assert.strictEqual(res5.shouldResume, false)
  })

  it('calculates episode progress fraction correctly', () => {
    assert.strictEqual(calculateEpisodeFraction(0, 1000), 0)
    assert.strictEqual(calculateEpisodeFraction(500, 1000), 0.5)
    assert.strictEqual(calculateEpisodeFraction(1000, 1000), 1)
    assert.strictEqual(calculateEpisodeFraction(1200, 1000), 1) // Clamped to 1
    assert.strictEqual(calculateEpisodeFraction(500, 0), 0) // Zero duration
  })

  it('calculates remaining seconds and formats remaining time label', () => {
    assert.strictEqual(calculateRemainingSeconds(600000, 1800000), 1200) // 20 minutes left
    assert.strictEqual(calculateRemainingSeconds(1800000, 1800000), 0)

    assert.strictEqual(formatRemainingTime(0), 'Completed')
    assert.strictEqual(formatRemainingTime(45), '45s left')
    assert.strictEqual(formatRemainingTime(1200), '20m left')
    assert.strictEqual(formatRemainingTime(4500), '1h 15m left')
  })

  it('creates complete PodcastProgressRecord from Track and positions', () => {
    const mockTrack: Track = {
      id: 'ep_track_1',
      title: 'Deep Mind and Transformers',
      artistId: 'host_deep',
      artistName: 'AI Explorers',
      albumId: 'podcasts',
      albumTitle: 'AI Explorers',
      albumImage: 'https://example.com/art.jpg',
      artwork: 'https://example.com/art.jpg',
      durationMs: 3600000,
      durationSeconds: 3600,
      explicit: false,
      playCount: 1,
      isPodcast: true,
      showTitle: 'AI Explorers',
      videoId: 'video_ai_1',
    }

    const record = createProgressRecord(mockTrack, 1200, 3600)
    assert.strictEqual(record.episodeId, 'video_ai_1')
    assert.strictEqual(record.showTitle, 'AI Explorers')
    assert.strictEqual(record.episodeTitle, 'Deep Mind and Transformers')
    assert.strictEqual(record.positionSeconds, 1200)
    assert.strictEqual(record.durationSeconds, 3600)
    assert.strictEqual(record.positionMs, 1200000)
    assert.strictEqual(record.durationMs, 3600000)
    assert.strictEqual(record.completed, false)
    assert.strictEqual(record.dismissed, false)
  })

  it('tracks progress metrics and resets cleanly', () => {
    recordPodcastProgressMetric('resumesTriggered')
    recordPodcastProgressMetric('resumesTriggered')
    recordPodcastProgressMetric('progressSaved')
    recordPodcastProgressMetric('episodesCompleted')
    recordPodcastProgressMetric('episodesDismissed')

    const metrics = getPodcastProgressMetrics()
    assert.strictEqual(metrics.resumesTriggered, 2)
    assert.strictEqual(metrics.progressSaved, 1)
    assert.strictEqual(metrics.episodesCompleted, 1)
    assert.strictEqual(metrics.episodesDismissed, 1)

    const parsed = podcastProgressMetricsSchema.parse(metrics)
    assert.strictEqual(parsed.resumesTriggered, 2)

    resetPodcastProgressMetrics()
    assert.strictEqual(getPodcastProgressMetrics().resumesTriggered, 0)
  })

  it('exposes MIN_POSITION_MS invariant of 30 seconds', () => {
    assert.strictEqual(MIN_POSITION_MS, 30000)
  })
})
