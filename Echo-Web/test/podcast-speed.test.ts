import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import {
  podcastSpeedSchema,
  podcastSpeedMetricsSchema,
  PODCAST_SPEEDS,
  formatPodcastSpeed,
  cyclePodcastSpeed,
  resolveEffectivePlaybackRate,
  getPodcastSpeedMetrics,
  resetPodcastSpeedMetrics,
  recordPodcastSpeedMetric,
} from '../src/services/podcast/podcastSpeedService.ts'
import type { Track, UserPreferences } from '../src/types/domain.ts'

describe('Podcast Playback Speed [FEATURE-035]', () => {
  beforeEach(() => {
    resetPodcastSpeedMetrics()
  })

  it('validates podcastSpeedSchema boundaries', () => {
    assert.strictEqual(podcastSpeedSchema.parse(1.0), 1.0)
    assert.strictEqual(podcastSpeedSchema.parse(1.5), 1.5)
    assert.strictEqual(podcastSpeedSchema.parse(0.5), 0.5)
    assert.strictEqual(podcastSpeedSchema.parse(2.5), 2.5)

    assert.throws(() => podcastSpeedSchema.parse(0.2))
    assert.throws(() => podcastSpeedSchema.parse(3.0))
  })

  it('provides standard upstream podcast speed list', () => {
    assert.ok(PODCAST_SPEEDS.includes(0.75))
    assert.ok(PODCAST_SPEEDS.includes(1.0))
    assert.ok(PODCAST_SPEEDS.includes(1.25))
    assert.ok(PODCAST_SPEEDS.includes(1.5))
    assert.ok(PODCAST_SPEEDS.includes(1.75))
    assert.ok(PODCAST_SPEEDS.includes(2.0))
  })

  it('formats podcast speeds into concise labels with formatPodcastSpeed', () => {
    assert.strictEqual(formatPodcastSpeed(1.0), '1x')
    assert.strictEqual(formatPodcastSpeed(2.0), '2x')
    assert.strictEqual(formatPodcastSpeed(1.25), '1.25x')
    assert.strictEqual(formatPodcastSpeed(1.5), '1.5x')
    assert.strictEqual(formatPodcastSpeed(0.75), '0.75x')
  })

  it('cycles podcast speeds sequentially and wraps around', () => {
    // 0.75 -> 1.0 -> 1.25 -> 1.5 -> 1.75 -> 2.0 -> 0.75
    assert.strictEqual(cyclePodcastSpeed(0.75), 1.0)
    assert.strictEqual(cyclePodcastSpeed(1.0), 1.25)
    assert.strictEqual(cyclePodcastSpeed(1.25), 1.5)
    assert.strictEqual(cyclePodcastSpeed(1.5), 1.75)
    assert.strictEqual(cyclePodcastSpeed(1.75), 2.0)
    assert.strictEqual(cyclePodcastSpeed(2.0), 0.75)

    // Fallback for non-standard rate
    assert.strictEqual(cyclePodcastSpeed(1.1), 1.0)
  })

  it('resolves effective playback rate independently for podcasts vs music', () => {
    const podcastTrack: Track = {
      id: 'ep_1',
      title: 'Podcast Episode',
      artistId: 'host_1',
      artistName: 'Host',
      albumId: 'show_1',
      albumTitle: 'Show',
      albumImage: '',
      artwork: '',
      durationMs: 1800000,
      explicit: false,
      playCount: 0,
      isPodcast: true,
    }

    const musicTrack: Track = {
      ...podcastTrack,
      id: 'music_1',
      title: 'Musical Song',
      isPodcast: false,
    }

    const prefs: Partial<UserPreferences> = {
      podcastPlaybackRate: 1.5,
    }

    // 1. Podcast track receives custom podcastPlaybackRate (1.5x)
    assert.strictEqual(resolveEffectivePlaybackRate(podcastTrack, prefs), 1.5)

    // 2. Music track defaults to standard 1.0x rate regardless of podcast speed
    assert.strictEqual(resolveEffectivePlaybackRate(musicTrack, prefs), 1.0)

    // 3. Null or undefined track defaults to 1.0x
    assert.strictEqual(resolveEffectivePlaybackRate(null, prefs), 1.0)
    assert.strictEqual(resolveEffectivePlaybackRate(undefined, prefs), 1.0)
  })

  it('tracks speed metrics and resets cleanly', () => {
    recordPodcastSpeedMetric('speedChanges')
    recordPodcastSpeedMetric('speedsCycled')
    recordPodcastSpeedMetric('speedsCycled')

    const metrics = getPodcastSpeedMetrics()
    assert.strictEqual(metrics.speedChanges, 1)
    assert.strictEqual(metrics.speedsCycled, 2)

    const parsed = podcastSpeedMetricsSchema.parse(metrics)
    assert.strictEqual(parsed.speedChanges, 1)

    resetPodcastSpeedMetrics()
    assert.strictEqual(getPodcastSpeedMetrics().speedChanges, 0)
    assert.strictEqual(getPodcastSpeedMetrics().speedsCycled, 0)
  })
})
