import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import {
  followedPodcastSchema,
  podcastLibraryMetricsSchema,
  isPodcastShow,
  segregatePlaylists,
  getPodcastLibraryMetrics,
  resetPodcastLibraryMetrics,
  recordPodcastLibraryMetric,
} from '../src/services/podcast/podcastLibraryService.ts'
import { useEchoStore } from '../src/stores/useEchoStore.ts'
import type { PlaylistSummary, PodcastShow } from '../src/types/domain.ts'

describe('Followed Podcast Library [FEATURE-032]', () => {
  beforeEach(() => {
    resetPodcastLibraryMetrics()
  })

  it('validates followedPodcastSchema correctly', () => {
    const valid = {
      id: 'show_huberman',
      title: 'Huberman Lab',
      author: 'Dr. Andrew Huberman',
      description: 'Science and science-based tools for everyday life',
      artworkUrl: 'https://example.com/art.jpg',
      episodeCount: 180,
      browseId: 'MPSP_huberman',
      isFollowed: true,
    }
    const parsed = followedPodcastSchema.parse(valid)
    assert.strictEqual(parsed.id, 'show_huberman')
    assert.strictEqual(parsed.title, 'Huberman Lab')
    assert.strictEqual(parsed.isFollowed, true)

    assert.throws(() => {
      followedPodcastSchema.parse({ id: '', title: '' })
    })
  })

  it('tracks follow and unfollow metrics correctly', () => {
    recordPodcastLibraryMetric('follow', 1)
    recordPodcastLibraryMetric('follow', 2)
    recordPodcastLibraryMetric('unfollow', 1)

    const metrics = getPodcastLibraryMetrics()
    assert.strictEqual(metrics.totalFollowed, 1)
    assert.strictEqual(metrics.followOperations, 2)
    assert.strictEqual(metrics.unfollowOperations, 1)

    const parsed = podcastLibraryMetricsSchema.parse(metrics)
    assert.strictEqual(parsed.totalFollowed, 1)

    resetPodcastLibraryMetrics()
    assert.strictEqual(getPodcastLibraryMetrics().totalFollowed, 0)
    assert.strictEqual(getPodcastLibraryMetrics().followOperations, 0)
  })

  it('accurately identifies podcast shows vs music playlists with isPodcastShow', () => {
    // 1. Explicit flag
    assert.strictEqual(isPodcastShow({ id: 'pl_1', isPodcast: true }), true)

    // 2. MPSP browse prefix
    assert.strictEqual(isPodcastShow({ id: 'MPSP_show_123' }), true)
    assert.strictEqual(isPodcastShow({ id: 'custom_pl', browseId: 'MPSP_custom' }), true)

    // 3. Regular music playlists
    assert.strictEqual(isPodcastShow({ id: 'PL_rock_classics' }), false)
    assert.strictEqual(isPodcastShow({ id: 'RD_mix_1' }), false)
  })

  it('segregates music playlists from followed podcast shows', () => {
    const mixedPlaylists: PlaylistSummary[] = [
      { id: 'PL_lofi_beats', title: 'Lofi Beats', image: 'https://example.com/art1.jpg' },
      { id: 'MPSP_lex_fridman', title: 'Lex Fridman', image: 'https://example.com/art2.jpg' },
      { id: 'PL_daily_mix', title: 'Daily Mix', image: 'https://example.com/art3.jpg' },
      { id: 'custom_show_id', title: 'Indie Creator Talk', image: 'https://example.com/art4.jpg' },
    ]

    const followedSet = new Set(['custom_show_id'])

    const { musicPlaylists, podcastShows } = segregatePlaylists(mixedPlaylists, followedSet)

    assert.strictEqual(musicPlaylists.length, 2)
    assert.strictEqual(podcastShows.length, 2)

    assert.ok(musicPlaylists.some((p) => p.id === 'PL_lofi_beats'))
    assert.ok(musicPlaylists.some((p) => p.id === 'PL_daily_mix'))

    assert.ok(podcastShows.some((p) => p.id === 'MPSP_lex_fridman'))
    assert.ok(podcastShows.some((p) => p.id === 'custom_show_id'))
  })

  it('manages followed podcasts lifecycle in useEchoStore', () => {
    const store = useEchoStore.getState()
    const testShow: PodcastShow = {
      id: 'show_test_radio',
      title: 'Radiolab',
      author: 'WNYC Studios',
      artworkUrl: 'https://example.com/radiolab.jpg',
      episodeCount: 300,
      browseId: 'MPSP_radiolab',
    }

    // 1. Initial state
    assert.strictEqual(store.isPodcastFollowed('show_test_radio'), false)

    // 2. Follow show
    store.followPodcast(testShow)
    assert.strictEqual(useEchoStore.getState().isPodcastFollowed('show_test_radio'), true)
    assert.strictEqual(useEchoStore.getState().isPodcastFollowed('MPSP_radiolab'), true)

    // 3. Prevent duplicate entries
    store.followPodcast(testShow)
    const matchCount = useEchoStore.getState().followedPodcasts.filter((p) => p.id === 'show_test_radio').length
    assert.strictEqual(matchCount, 1)

    // 4. Unfollow show
    store.unfollowPodcast('show_test_radio')
    assert.strictEqual(useEchoStore.getState().isPodcastFollowed('show_test_radio'), false)
  })
})
