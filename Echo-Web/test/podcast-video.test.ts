import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import {
  videoTrackOptionSchema,
  videoPlayerStateSchema,
  podcastVideoMetricsSchema,
  cleanSongTitle,
  cleanArtistName,
  resolvePodcastVideoTracks,
  clearPodcastVideoCache,
  recordPodcastVideoMetric,
  getPodcastVideoMetrics,
  resetPodcastVideoMetrics,
} from '../src/services/podcast/podcastVideoService.ts'

describe('FEATURE-037: Fullscreen Video Podcast Player', () => {
  beforeEach(() => {
    resetPodcastVideoMetrics()
    clearPodcastVideoCache()
  })

  describe('Zod Schemas', () => {
    it('validates video track options correctly', () => {
      const valid = videoTrackOptionSchema.parse({
        label: '1080p HD',
        height: 1080,
        videoUrl: 'https://example.com/stream-1080p.mp4',
        audioUrl: 'https://example.com/audio.m4a',
        isMuxed: false,
      })
      assert.strictEqual(valid.label, '1080p HD')
      assert.strictEqual(valid.height, 1080)
      assert.strictEqual(valid.isMuxed, false)

      assert.throws(() =>
        videoTrackOptionSchema.parse({
          label: '',
          height: -10,
          videoUrl: '',
        }),
      )
    })

    it('validates player state schema', () => {
      const state = videoPlayerStateSchema.parse({
        videoId: 'abc123xyz00',
        selectedQuality: '720p',
        isPlaying: true,
        currentTime: 42.5,
        duration: 1800,
        isFullscreen: false,
        controlsVisible: true,
      })
      assert.strictEqual(state.videoId, 'abc123xyz00')
      assert.strictEqual(state.selectedQuality, '720p')
    })

    it('validates telemetry metrics schema', () => {
      const metrics = podcastVideoMetricsSchema.parse({
        videoLoadsStarted: 5,
        videoLoadsSucceeded: 5,
        videoLoadsFailed: 0,
        fullscreenToggles: 2,
        qualityChanges: 3,
        audioVideoSwitches: 4,
      })
      assert.strictEqual(metrics.videoLoadsStarted, 5)
    })
  })

  describe('Upstream Title & Artist Cleaning', () => {
    it('strips official tags, video labels, and feature annotations', () => {
      assert.strictEqual(
        cleanSongTitle('The Joe Rogan Experience #2100 [Official Video]'),
        'The Joe Rogan Experience #2100',
      )
      assert.strictEqual(
        cleanSongTitle('Episode 42 - The Future of AI (feat. Sam Altman) (Official Podcast Video)'),
        'Episode 42 - The Future of AI',
      )
      assert.strictEqual(
        cleanSongTitle('Huberman Lab - Focus & Productivity [Remastered]'),
        'Huberman Lab - Focus & Productivity',
      )
    })

    it('cleans collaborative artist names to primary show host', () => {
      assert.strictEqual(cleanArtistName('Lex Fridman & Elon Musk'), 'Lex Fridman')
      assert.strictEqual(cleanArtistName('Andrew Huberman feat. Matthew Walker'), 'Andrew Huberman')
      assert.strictEqual(cleanArtistName('Tim Ferriss with Seth Godin'), 'Tim Ferriss')
    })
  })

  describe('Stream Resolution & Cache', () => {
    it('returns empty array when video ID is blank', async () => {
      const tracks = await resolvePodcastVideoTracks('')
      assert.strictEqual(tracks.length, 0)
    })

    it('resolves standard multi-quality video tracks (1080p, 720p, 480p, 360p)', async () => {
      const tracks = await resolvePodcastVideoTracks('testVideo123', 'AI Podcast', 'Host')
      assert.ok(tracks.length >= 4)
      const labels = tracks.map((t) => t.label)
      assert.ok(labels.includes('1080p HD'))
      assert.ok(labels.includes('720p'))
      assert.ok(labels.includes('480p'))
      assert.ok(labels.includes('360p'))
    })

    it('caches resolved video tracks and deduplicates subsequent calls', async () => {
      const first = await resolvePodcastVideoTracks('cachedVideo456')
      assert.ok(first.length > 0)
      const metrics1 = getPodcastVideoMetrics()
      assert.strictEqual(metrics1.videoLoadsStarted, 1)

      const second = await resolvePodcastVideoTracks('cachedVideo456')
      assert.strictEqual(second.length, first.length)
      const metrics2 = getPodcastVideoMetrics()
      assert.strictEqual(metrics2.videoLoadsStarted, 2)
      assert.strictEqual(metrics2.videoLoadsSucceeded, 2)
    })
  })

  describe('Telemetry Metrics', () => {
    it('records video telemetry operations and supports reset', () => {
      recordPodcastVideoMetric('fullscreenToggles')
      recordPodcastVideoMetric('fullscreenToggles')
      recordPodcastVideoMetric('qualityChanges')
      recordPodcastVideoMetric('audioVideoSwitches', 3)

      const metrics = getPodcastVideoMetrics()
      assert.strictEqual(metrics.fullscreenToggles, 2)
      assert.strictEqual(metrics.qualityChanges, 1)
      assert.strictEqual(metrics.audioVideoSwitches, 3)

      resetPodcastVideoMetrics()
      const reset = getPodcastVideoMetrics()
      assert.strictEqual(reset.fullscreenToggles, 0)
      assert.strictEqual(reset.audioVideoSwitches, 0)
    })
  })
})
