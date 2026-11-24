import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import {
  episodeSortOrderSchema,
  episodeFilterSchema,
  parseEpisodeDate,
  getEpisodeTimestamp,
  sortPodcastEpisodes,
  filterPodcastEpisodes,
  orderAndFilterEpisodes,
  getPodcastOrderingMetrics,
  resetPodcastOrderingMetrics,
} from '../src/services/podcast/podcastOrderingService.ts'
import type { Track } from '../src/types/domain.ts'
import type { PodcastProgressRecord } from '../src/services/db/echoDatabase.ts'

describe('Podcast Episode Ordering & Filtering [FEATURE-034]', () => {
  beforeEach(() => {
    resetPodcastOrderingMetrics()
  })

  it('validates episodeSortOrderSchema and episodeFilterSchema', () => {
    assert.strictEqual(episodeSortOrderSchema.parse('newest'), 'newest')
    assert.strictEqual(episodeSortOrderSchema.parse('oldest'), 'oldest')
    assert.strictEqual(episodeSortOrderSchema.parse('shortest'), 'shortest')
    assert.strictEqual(episodeSortOrderSchema.parse('longest'), 'longest')
    assert.strictEqual(episodeSortOrderSchema.parse('title'), 'title')

    assert.throws(() => episodeSortOrderSchema.parse('random'))

    assert.strictEqual(episodeFilterSchema.parse('all'), 'all')
    assert.strictEqual(episodeFilterSchema.parse('unplayed'), 'unplayed')
    assert.strictEqual(episodeFilterSchema.parse('in-progress'), 'in-progress')
  })

  it('parses relative and absolute dates accurately with parseEpisodeDate', () => {
    const fixedNow = 1735000000000 // Fixed reference time

    // 1. Today & Yesterday
    assert.strictEqual(parseEpisodeDate('today', fixedNow), fixedNow)
    assert.strictEqual(parseEpisodeDate('yesterday', fixedNow), fixedNow - 86400000)

    // 2. Relative hints
    const twoDaysAgo = parseEpisodeDate('2 days ago', fixedNow)
    assert.strictEqual(twoDaysAgo, fixedNow - 2 * 86400000)

    const threeHoursAgo = parseEpisodeDate('3 hours ago', fixedNow)
    assert.strictEqual(threeHoursAgo, fixedNow - 3 * 3600000)

    // 3. Absolute formats
    const parsedDec19 = parseEpisodeDate('Dec 19, 2024')
    assert.ok(parsedDec19 > 0)
    const dateObj = new Date(parsedDec19)
    assert.strictEqual(dateObj.getFullYear(), 2024)
    assert.strictEqual(dateObj.getMonth(), 11) // Dec is 11 (0-indexed)
    assert.strictEqual(dateObj.getDate(), 19)

    // 4. Fallbacks for empty/unrecognized
    assert.strictEqual(parseEpisodeDate(''), 0)
    assert.strictEqual(parseEpisodeDate(null), 0)
  })

  it('sorts episodes newest first (reverse chronological) and oldest first (chronological)', () => {
    const ep1: Track = {
      id: 'ep_1',
      title: 'Episode 1: The Origin',
      artistId: 'host_1',
      artistName: 'History Show',
      albumId: 'show_1',
      albumTitle: 'History Show',
      albumImage: '',
      artwork: '',
      durationMs: 1800000,
      durationSeconds: 1800,
      explicit: false,
      playCount: 1,
      isPodcast: true,
      publishedAt: 'Jan 1, 2024',
    }

    const ep2: Track = {
      ...ep1,
      id: 'ep_2',
      title: 'Episode 2: The Expansion',
      publishedAt: 'Feb 1, 2024',
    }

    const ep3: Track = {
      ...ep1,
      id: 'ep_3',
      title: 'Episode 3: The Present',
      publishedAt: 'Mar 1, 2024',
    }

    const list = [ep2, ep1, ep3]

    // Newest first (reverse chronological) -> Ep 3, Ep 2, Ep 1
    const sortedNewest = sortPodcastEpisodes(list, 'newest')
    assert.strictEqual(sortedNewest[0]?.id, 'ep_3')
    assert.strictEqual(sortedNewest[1]?.id, 'ep_2')
    assert.strictEqual(sortedNewest[2]?.id, 'ep_1')

    // Oldest first (chronological) -> Ep 1, Ep 2, Ep 3
    const sortedOldest = sortPodcastEpisodes(list, 'oldest')
    assert.strictEqual(sortedOldest[0]?.id, 'ep_1')
    assert.strictEqual(sortedOldest[1]?.id, 'ep_2')
    assert.strictEqual(sortedOldest[2]?.id, 'ep_3')
  })

  it('sorts episodes by duration and title', () => {
    const shortEp: Track = {
      id: 'short',
      title: 'Zeta Episode',
      artistId: 'h1',
      artistName: 'Host',
      albumId: 's1',
      albumTitle: 'Show',
      albumImage: '',
      artwork: '',
      durationMs: 600000,
      durationSeconds: 600,
      explicit: false,
      playCount: 0,
    }

    const longEp: Track = {
      ...shortEp,
      id: 'long',
      title: 'Alpha Episode',
      durationMs: 3600000,
      durationSeconds: 3600,
    }

    // Shortest first
    const byShortest = sortPodcastEpisodes([longEp, shortEp], 'shortest')
    assert.strictEqual(byShortest[0]?.id, 'short')

    // Longest first
    const byLongest = sortPodcastEpisodes([shortEp, longEp], 'longest')
    assert.strictEqual(byLongest[0]?.id, 'long')

    // Title A-Z
    const byTitle = sortPodcastEpisodes([shortEp, longEp], 'title')
    assert.strictEqual(byTitle[0]?.id, 'long') // Alpha comes before Zeta
  })

  it('filters episodes by played, unplayed, and in-progress status', () => {
    const epA: Track = {
      id: 'ep_a',
      title: 'Ep A',
      artistId: 'h',
      artistName: 'H',
      albumId: 's',
      albumTitle: 'S',
      albumImage: '',
      artwork: '',
      durationMs: 1000,
      explicit: false,
      playCount: 0,
    }
    const epB: Track = { ...epA, id: 'ep_b' }
    const epC: Track = { ...epA, id: 'ep_c' }

    const mockProgress: Record<string, PodcastProgressRecord> = {
      ep_a: {
        episodeId: 'ep_a',
        showTitle: 'S',
        episodeTitle: 'Ep A',
        positionMs: 600000,
        durationMs: 1800000,
        completed: false,
        dismissed: false,
        updatedAt: Date.now(),
      },
      ep_b: {
        episodeId: 'ep_b',
        showTitle: 'S',
        episodeTitle: 'Ep B',
        positionMs: 0,
        durationMs: 1800000,
        completed: true,
        dismissed: false,
        updatedAt: Date.now(),
      },
    }

    // Unplayed filter: epC (no record) should be returned
    const unplayed = filterPodcastEpisodes([epA, epB, epC], 'unplayed', mockProgress)
    assert.strictEqual(unplayed.length, 1)
    assert.strictEqual(unplayed[0]?.id, 'ep_c')

    // In-progress filter: epA (position >= 5s, !completed)
    const inProgress = filterPodcastEpisodes([epA, epB, epC], 'in-progress', mockProgress)
    assert.strictEqual(inProgress.length, 1)
    assert.strictEqual(inProgress[0]?.id, 'ep_a')
  })

  it('tracks ordering and filtering metrics correctly', () => {
    sortPodcastEpisodes([], 'newest')
    filterPodcastEpisodes([], 'all')

    const metrics = getPodcastOrderingMetrics()
    assert.strictEqual(metrics.sortOperations, 1)
    assert.strictEqual(metrics.filterOperations, 1)

    resetPodcastOrderingMetrics()
    assert.strictEqual(getPodcastOrderingMetrics().sortOperations, 0)
  })
})
