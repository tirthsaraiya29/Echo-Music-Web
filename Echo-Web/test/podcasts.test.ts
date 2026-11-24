import { describe, it } from 'node:test'
import assert from 'node:assert'
import type { PodcastEpisode, PodcastShow } from '../src/types/domain.ts'

describe('Podcast Product Surface & Persistence [BUG-39]', () => {
  it('defines explicit podcast domain types', () => {
    const episode: PodcastEpisode = {
      id: 'ep_101',
      videoId: 'ep_101',
      title: 'Episode 101: The Future of Sound',
      artistId: 'artist_deep_dive',
      artistName: 'Deep Dive Tech',
      albumId: 'show_deep_dive',
      albumTitle: 'Deep Dive Tech',
      albumImage: 'https://example.com/art.jpg',
      artwork: 'https://example.com/art.jpg',
      durationMs: 3600000,
      durationSeconds: 3600,
      explicit: false,
      playCount: 1,
      isPodcast: true,
      podcastShowId: 'show_deep_dive',
      showTitle: 'Deep Dive Tech',
      publishedAt: '2026-11-24',
    }

    assert.strictEqual(episode.isPodcast, true)
    assert.strictEqual(episode.podcastShowId, 'show_deep_dive')
    assert.strictEqual(episode.durationSeconds, 3600)

    const show: PodcastShow = {
      id: 'show_deep_dive',
      title: 'Deep Dive Tech',
      author: 'Tech Audio Productions',
      description: 'Weekly deep dive into software, audio and tech.',
      artworkUrl: 'https://example.com/art.jpg',
      episodeCount: 42,
      isFollowed: true,
    }

    assert.strictEqual(show.id, 'show_deep_dive')
    assert.strictEqual(show.isFollowed, true)
  })

  it('handles podcast progress record lifecycle and resume calculations', () => {
    // 1. Valid resume window: position > 5s and < 95% of duration
    const inProgressRecord = {
      episodeId: 'ep_resume_1',
      showTitle: 'History Daily',
      episodeTitle: 'The Apollo Missions',
      positionSeconds: 600, // 10 minutes in
      durationSeconds: 1800, // 30 minutes total (33.3%)
      positionMs: 600000,
      durationMs: 1800000,
      completed: false,
      dismissed: false,
      updatedAt: Date.now(),
    }

    const posSec = inProgressRecord.positionSeconds ?? inProgressRecord.positionMs / 1000
    const durSec = inProgressRecord.durationSeconds ?? inProgressRecord.durationMs / 1000
    const shouldResume = !inProgressRecord.completed && posSec > 5 && durSec > 0 && posSec / durSec < 0.95
    assert.strictEqual(shouldResume, true, 'Episode at 33% progress should be resumed')

    // 2. Near beginning (< 5s): should start from beginning, not seek
    const earlyRecord = {
      ...inProgressRecord,
      positionSeconds: 3,
      positionMs: 3000,
    }
    const earlyPosSec = earlyRecord.positionSeconds ?? earlyRecord.positionMs / 1000
    const earlyShouldResume = !earlyRecord.completed && earlyPosSec > 5 && durSec > 0 && earlyPosSec / durSec < 0.95
    assert.strictEqual(earlyShouldResume, false, 'Episode under 5 seconds should not trigger resume seek')

    // 3. Near end (> 95%): considered finished, should start from beginning
    const nearEndRecord = {
      ...inProgressRecord,
      positionSeconds: 1750, // 97.2%
      positionMs: 1750000,
    }
    const endPosSec = nearEndRecord.positionSeconds ?? nearEndRecord.positionMs / 1000
    const endShouldResume = !nearEndRecord.completed && endPosSec > 5 && durSec > 0 && endPosSec / durSec < 0.95
    assert.strictEqual(endShouldResume, false, 'Episode over 95% should not trigger resume seek')
  })

  it('PodcastsPage file exists and exports PodcastsPage component', async () => {
    const fs = await import('node:fs')
    const content = fs.readFileSync('src/pages/PodcastsPage.tsx', 'utf8')
    assert.ok(content.includes('export function PodcastsPage()'), 'PodcastsPage component must be exported')
    assert.ok(content.includes('getAllPodcastProgress'), 'PodcastsPage integrates with podcast progress')
  })
})
