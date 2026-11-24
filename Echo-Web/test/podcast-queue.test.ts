import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import {
  podcastQueueItemSchema,
  podcastQueuePolicySchema,
  podcastQueueMetricsSchema,
  isPodcastTrack,
  filterSpokenAudioTracks,
  findNextShowEpisode,
  buildPodcastEpisodeQueue,
  recordPodcastQueueMetric,
  getPodcastQueueMetrics,
  resetPodcastQueueMetrics,
} from '../src/services/podcast/podcastQueueService.ts'
import { QueueManager } from '../src/engine/QueueManager.ts'
import type { Track } from '../src/types/domain.ts'

describe('FEATURE-038: Podcast Queue Segregation', () => {
  beforeEach(() => {
    resetPodcastQueueMetrics()
  })

  describe('Zod Schemas', () => {
    it('validates podcast queue item schema', () => {
      const item = podcastQueueItemSchema.parse({
        trackId: 'ep-001',
        title: 'Episode 1: The Beginning',
        showTitle: 'Tech Talk Daily',
        showBrowseId: 'MPSP12345',
        isPodcast: true,
        episodeIndex: 1,
      })
      assert.strictEqual(item.trackId, 'ep-001')
      assert.strictEqual(item.isPodcast, true)
    })

    it('validates queue policy defaults', () => {
      const policy = podcastQueuePolicySchema.parse({})
      assert.strictEqual(policy.segregateSpokenAudio, true)
      assert.strictEqual(policy.autoQueueNextEpisode, true)
      assert.strictEqual(policy.disallowMusicRadioContinuation, true)
    })

    it('validates metrics schema', () => {
      const m = podcastQueueMetricsSchema.parse({
        episodesQueuedCount: 10,
        musicTracksFilteredCount: 25,
        nextEpisodesAutoQueued: 3,
        queueSegregationEnforcements: 4,
      })
      assert.strictEqual(m.musicTracksFilteredCount, 25)
    })
  })

  describe('isPodcastTrack', () => {
    it('accurately identifies podcast episodes', () => {
      const ep1: Track = { id: 'ep1', title: 'Episode 1', artistName: 'Host', isPodcast: true }
      const ep2: Track = { id: 'ep2', title: 'Episode 2', artistName: 'Host', showTitle: 'Show Name' }
      const ep3: Track = { id: 'ep3', title: 'Episode 3', artistName: 'Host', albumTitle: 'My Podcast' }
      const music: Track = { id: 'm1', title: 'Song 1', artistName: 'Band', albumTitle: 'Album 1' }

      assert.strictEqual(isPodcastTrack(ep1), true)
      assert.strictEqual(isPodcastTrack(ep2), true)
      assert.strictEqual(isPodcastTrack(ep3), true)
      assert.strictEqual(isPodcastTrack(music), false)
      assert.strictEqual(isPodcastTrack(null), false)
      assert.strictEqual(isPodcastTrack(undefined), false)
    })
  })

  describe('filterSpokenAudioTracks', () => {
    it('preserves all tracks when active track is regular music', () => {
      const tracks: Track[] = [
        { id: '1', title: 'Song 1', artistName: 'Artist' },
        { id: '2', title: 'Song 2', artistName: 'Artist' },
      ]
      const { podcastTracks, filteredMusicTracks } = filterSpokenAudioTracks(tracks, false)
      assert.strictEqual(podcastTracks.length, 2)
      assert.strictEqual(filteredMusicTracks.length, 0)
    })

    it('filters out music tracks when active track is a podcast episode (upstream YouTubeQueue parity)', () => {
      const mixed: Track[] = [
        { id: 'ep1', title: 'Episode 1', artistName: 'Host', isPodcast: true },
        { id: 'song1', title: 'Pop Hit', artistName: 'Pop Star' },
        { id: 'ep2', title: 'Episode 2', artistName: 'Host', showTitle: 'Tech Talk' },
        { id: 'song2', title: 'Rock Anthem', artistName: 'Rocker' },
      ]
      const { podcastTracks, filteredMusicTracks } = filterSpokenAudioTracks(mixed, true)
      assert.strictEqual(podcastTracks.length, 2)
      assert.strictEqual(filteredMusicTracks.length, 2)
      assert.strictEqual(podcastTracks[0]!.id, 'ep1')
      assert.strictEqual(podcastTracks[1]!.id, 'ep2')

      const metrics = getPodcastQueueMetrics()
      assert.strictEqual(metrics.musicTracksFilteredCount, 2)
      assert.strictEqual(metrics.queueSegregationEnforcements, 1)
    })
  })

  describe('findNextShowEpisode', () => {
    it('identifies next sequential episode of the show', () => {
      const episodes: Track[] = [
        { id: 'ep1', title: 'Episode 1', artistName: 'Host', showTitle: 'Show' },
        { id: 'ep2', title: 'Episode 2', artistName: 'Host', showTitle: 'Show' },
        { id: 'ep3', title: 'Episode 3', artistName: 'Host', showTitle: 'Show' },
      ]
      const next = findNextShowEpisode(episodes[0]!, episodes)
      assert.ok(next)
      assert.strictEqual(next.id, 'ep2')

      const nextAfterLast = findNextShowEpisode(episodes[2]!, episodes)
      assert.strictEqual(nextAfterLast, null)
    })

    it('handles empty or missing episode lists safely', () => {
      const current: Track = { id: 'ep1', title: 'Episode 1', artistName: 'Host' }
      assert.strictEqual(findNextShowEpisode(current, []), null)
    })
  })

  describe('buildPodcastEpisodeQueue', () => {
    it('slices show episodes from current position', () => {
      const episodes: Track[] = [
        { id: 'ep1', title: 'Ep 1', artistName: 'Host' },
        { id: 'ep2', title: 'Ep 2', artistName: 'Host' },
        { id: 'ep3', title: 'Ep 3', artistName: 'Host' },
      ]
      const q = buildPodcastEpisodeQueue(episodes[1]!, episodes)
      assert.strictEqual(q.length, 2)
      assert.strictEqual(q[0]!.id, 'ep2')
      assert.strictEqual(q[1]!.id, 'ep3')

      const metrics = getPodcastQueueMetrics()
      assert.strictEqual(metrics.episodesQueuedCount, 2)
    })
  })

  describe('QueueManager Segregation Integration', () => {
    it('purges music tracks from addRadioTracks when active track is a podcast episode', () => {
      const qm = new QueueManager()
      const podcastTrack: Track = { id: 'pod-1', title: 'Podcast Episode', artistName: 'Host', isPodcast: true }
      qm.setSourceQueue([podcastTrack], 0)

      const incomingTracks: Track[] = [
        { id: 'song-1', title: 'Radio Song 1', artistName: 'Singer' },
        { id: 'pod-2', title: 'Podcast Ep 2', artistName: 'Host', isPodcast: true },
        { id: 'song-2', title: 'Radio Song 2', artistName: 'Band' },
      ]

      qm.addRadioTracks(incomingTracks)

      const radioQueue = qm.getDetailedQueue().radioQueue
      // Only pod-2 should be added to radioQueue; song-1 and song-2 are filtered out!
      assert.strictEqual(radioQueue.length, 1)
      assert.strictEqual(radioQueue[0]!.id, 'pod-2')
    })
  })
})
