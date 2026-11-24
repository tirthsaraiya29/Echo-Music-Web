import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import {
  podcastCategorySchema,
  podcastShowSchema,
  podcastDiscoveryMetricsSchema,
  PODCAST_CATEGORIES,
  FEATURED_PODCAST_SHOWS,
  extractPodcastShowsAndEpisodes,
  getPodcastDiscoveryMetrics,
  resetPodcastDiscoveryMetrics,
  getTrendingPodcastShows,
} from '../src/services/podcast/podcastDiscoveryService.ts'
import type { Track, PlaylistSummary, SearchResultCatalog } from '../src/types/domain.ts'

describe('Podcast Discovery Service [FEATURE-031]', () => {
  beforeEach(() => {
    resetPodcastDiscoveryMetrics()
  })

  it('validates podcast category schema', () => {
    const valid = {
      id: 'science',
      label: 'Science & Tech',
      query: 'science podcasts',
      description: 'Cosmology, biology and engineering',
    }
    const parsed = podcastCategorySchema.parse(valid)
    assert.strictEqual(parsed.id, 'science')
    assert.strictEqual(parsed.label, 'Science & Tech')

    assert.throws(() => {
      podcastCategorySchema.parse({ id: '', label: 'Invalid' })
    })
  })

  it('validates podcast show schema', () => {
    const validShow = {
      id: 'show_lex',
      title: 'Lex Fridman Podcast',
      author: 'Lex Fridman',
      description: 'Conversations about science, tech, history, and life',
      artworkUrl: 'https://example.com/art.jpg',
      episodeCount: 420,
      browseId: 'MPSP_lex',
      isFollowed: false,
    }
    const parsed = podcastShowSchema.parse(validShow)
    assert.strictEqual(parsed.id, 'show_lex')
    assert.strictEqual(parsed.episodeCount, 420)
    assert.strictEqual(parsed.browseId, 'MPSP_lex')

    // Accepts minimal valid show
    const minimal = podcastShowSchema.parse({
      id: 'show_min',
      title: 'Minimal Show',
      author: 'Author',
    })
    assert.strictEqual(minimal.id, 'show_min')
    assert.strictEqual(minimal.artworkUrl, '')
  })

  it('provides comprehensive curated podcast categories', () => {
    assert.ok(PODCAST_CATEGORIES.length >= 10)
    const ids = new Set(PODCAST_CATEGORIES.map((c) => c.id))
    assert.strictEqual(ids.size, PODCAST_CATEGORIES.length, 'Category IDs must be unique')
    assert.ok(ids.has('all'))
    assert.ok(ids.has('tech'))
    assert.ok(ids.has('crime'))
    assert.ok(ids.has('science'))
  })

  it('provides featured podcast shows', () => {
    const trending = getTrendingPodcastShows()
    assert.ok(trending.length >= 5)
    for (const show of trending) {
      assert.ok(show.id.startsWith('show_'))
      assert.ok(show.title.length > 0)
      assert.ok(show.author.length > 0)
    }
  })

  it('extractPodcastShowsAndEpisodes parses tracks and playlists correctly', () => {
    const mockTracks: Track[] = [
      {
        id: 'ep_1',
        title: 'Episode 1: The Beginning',
        artists: [{ id: 'host_1', name: 'Host One', image: '' }],
        album: { id: 'MPSP_show_1', title: 'The Great Show' },
        durationSeconds: 1800,
        thumbnailUrl: 'https://example.com/ep1.jpg',
        isExplicit: false,
        artistId: 'host_1',
        artistName: 'Host One',
        albumId: 'MPSP_show_1',
        albumTitle: 'The Great Show',
        albumImage: 'https://example.com/ep1.jpg',
        durationMs: 1800000,
        artwork: 'https://example.com/ep1.jpg',
        explicit: false,
        playCount: 10,
        videoId: 'ep_1',
      },
      {
        id: 'ep_1', // Duplicate to verify deduplication
        title: 'Episode 1 Duplicate',
        artistId: 'host_1',
        artistName: 'Host One',
        albumId: 'MPSP_show_1',
        albumTitle: 'The Great Show',
        albumImage: '',
        durationMs: 1800000,
        durationSeconds: 1800,
        artwork: '',
        explicit: false,
        playCount: 0,
      },
    ]

    const mockPlaylists: PlaylistSummary[] = [
      {
        id: 'PL_show_abc',
        title: 'Tech Weekly',
        author: 'Tech Reporter',
        description: 'Weekly tech news',
        image: 'https://example.com/tech.jpg',
        thumbnailUrl: 'https://example.com/tech.jpg',
        trackCount: 45,
      },
      {
        id: 'PL_show_abc', // Duplicate
        title: 'Tech Weekly Dup',
        image: '',
      },
    ]

    const catalog: SearchResultCatalog = {
      tracks: mockTracks,
      albums: [],
      artists: [],
      playlists: mockPlaylists,
    }

    const { shows, episodes } = extractPodcastShowsAndEpisodes(catalog, 'Fallback Show')

    // Verify deduplication
    assert.strictEqual(episodes.length, 1)
    assert.strictEqual(shows.length, 1)

    // Verify episode enrichment
    const ep = episodes[0]!
    assert.strictEqual(ep.id, 'ep_1')
    assert.strictEqual(ep.isPodcast, true)
    assert.strictEqual(ep.showTitle, 'The Great Show')
    assert.ok(ep.podcastShowId?.includes('show'))

    // Verify show enrichment
    const show = shows[0]!
    assert.strictEqual(show.id, 'PL_show_abc')
    assert.strictEqual(show.title, 'Tech Weekly')
    assert.strictEqual(show.author, 'Tech Reporter')
    assert.strictEqual(show.browseId, 'MPSP_PL_show_abc')
    assert.strictEqual(show.episodeCount, 45)
  })

  it('tracks discovery metrics and resets cleanly', () => {
    const initial = getPodcastDiscoveryMetrics()
    assert.strictEqual(initial.totalQueries, 0)
    assert.strictEqual(initial.cacheHits, 0)

    const parsed = podcastDiscoveryMetricsSchema.parse(initial)
    assert.strictEqual(parsed.totalQueries, 0)
  })
})
