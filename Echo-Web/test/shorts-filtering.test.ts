import test from 'node:test'
import assert from 'node:assert'
import type { Track, PlaylistSummary, HomeShelf } from '../src/types/domain.ts'
import type { SearchResultCatalog } from '../src/services/innertube/client.ts'
import {
  isYouTubeShort,
  filterShortsFromTracks,
  filterShortsFromPlaylists,
  filterShortsFromShelves,
  filterShortsFromSearchResults,
  isShortsFilterEnabled,
  getShortsFilterMetrics,
  resetShortsFilterMetrics,
  shortsFilterOptionsSchema,
} from '../src/services/innertube/shortsFilterService.ts'

test('shortsFilterOptionsSchema validates configuration correctly', () => {
  const parsedDefault = shortsFilterOptionsSchema.parse({})
  assert.strictEqual(parsedDefault.enabled, true)
  assert.strictEqual(parsedDefault.maxDurationSeconds, 60)

  const parsedCustom = shortsFilterOptionsSchema.parse({ enabled: false, maxDurationSeconds: 45 })
  assert.strictEqual(parsedCustom.enabled, false)
  assert.strictEqual(parsedCustom.maxDurationSeconds, 45)
})

test('isYouTubeShort accurately detects YouTube Shorts by various indicators', () => {
  resetShortsFilterMetrics()

  // 1. Explicit short flag
  assert.strictEqual(isYouTubeShort({ isShort: true, title: 'Sample' }), true)
  assert.strictEqual(isYouTubeShort({ isShorts: true, title: 'Sample' }), true)

  // 2. Upstream SS prefix for shorts playlists or shelves
  assert.strictEqual(isYouTubeShort({ id: 'SSreel123', title: 'Reels' }), true)
  assert.strictEqual(isYouTubeShort({ browseId: 'SSshelf456', title: 'Shorts Shelf' }), true)

  // 3. Navigation endpoints
  assert.strictEqual(
    isYouTubeShort({
      id: 'vid1',
      title: 'Quick Video',
      navigationEndpoint: { reelWatchEndpoint: { videoId: 'vid1' } },
    }),
    true,
  )

  // 4. URL containing /shorts/
  assert.strictEqual(
    isYouTubeShort({
      id: 'vid2',
      title: 'Cool Clip',
      streamUrl: 'https://youtube.com/shorts/vid2',
    }),
    true,
  )

  // 5. Title indicators with hashtags
  assert.strictEqual(
    isYouTubeShort({
      id: 'vid3',
      title: 'Insane Guitar Solo #shorts',
      durationSeconds: 30,
    }),
    true,
  )
  assert.strictEqual(
    isYouTubeShort({
      id: 'vid4',
      title: 'Funniest Moments [Shorts]',
      durationSeconds: 45,
    }),
    true,
  )

  // 6. Regular song: Should NOT be detected as short
  const regularSong: Track = {
    id: 'song1',
    title: 'Paranoid Android',
    artistId: 'UCartist1',
    artistName: 'Radiohead',
    albumId: 'MPREb_album1',
    albumTitle: 'OK Computer',
    albumImage: 'https://example.com/okc.jpg',
    artwork: 'https://example.com/okc.jpg',
    durationMs: 383000,
    durationSeconds: 383,
    explicit: false,
    playCount: 100,
  }
  assert.strictEqual(isYouTubeShort(regularSong), false)

  // 7. Legitimate podcast episode: Should NOT be detected as short even if short duration
  const shortPodcast: Track = {
    id: 'pod1',
    title: 'Daily Tech Update',
    artistId: 'UCpod',
    artistName: 'Tech News',
    albumId: 'album_pod',
    albumTitle: 'Morning Tech',
    albumImage: 'https://example.com/pod.jpg',
    artwork: 'https://example.com/pod.jpg',
    durationMs: 55000,
    durationSeconds: 55,
    explicit: false,
    playCount: 10,
    isPodcast: true,
  }
  assert.strictEqual(isYouTubeShort(shortPodcast), false)
})

test('filterShortsFromTracks filters shorts when enabled and retains them when disabled', () => {
  resetShortsFilterMetrics()

  const regularTrack: Track = {
    id: 'track1',
    title: 'Comfortably Numb',
    artistId: 'UCpinkfloyd',
    artistName: 'Pink Floyd',
    albumId: 'MPREb_wall',
    albumTitle: 'The Wall',
    albumImage: 'https://example.com/wall.jpg',
    artwork: 'https://example.com/wall.jpg',
    durationMs: 382000,
    durationSeconds: 382,
    explicit: false,
    playCount: 50,
  }

  const shortTrack: Track = {
    id: 'short1',
    title: 'Epic Bass Drop #shorts',
    artistId: 'artist-short1',
    artistName: 'BassGuy',
    albumId: 'album-short1',
    albumTitle: 'Single',
    albumImage: 'https://example.com/short.jpg',
    artwork: 'https://example.com/short.jpg',
    durationMs: 30000,
    durationSeconds: 30,
    explicit: false,
    playCount: 5,
    isShort: true,
  }

  const tracks = [regularTrack, shortTrack]

  // Filter enabled: only regular track remains
  const filtered = filterShortsFromTracks(tracks, true)
  assert.strictEqual(filtered.length, 1)
  assert.strictEqual(filtered[0]!.id, 'track1')

  // Filter disabled: both tracks remain
  const unfiltered = filterShortsFromTracks(tracks, false)
  assert.strictEqual(unfiltered.length, 2)
})

test('filterShortsFromPlaylists removes SS-prefixed playlists and shorts titles', () => {
  resetShortsFilterMetrics()

  const regularPlaylist: PlaylistSummary = {
    id: 'VLplaylist1',
    title: 'Progressive Rock Essentials',
    image: 'https://example.com/prog.jpg',
    author: 'Echo Music',
  }

  const shortsPlaylist1: PlaylistSummary = {
    id: 'SStrending_reels',
    title: 'Trending Reels',
    image: 'https://example.com/reels.jpg',
    author: 'YouTube',
  }

  const shortsPlaylist2: PlaylistSummary = {
    id: 'PLcustom_shorts',
    title: 'Shorts',
    image: 'https://example.com/shorts.jpg',
    author: 'Creator',
  }

  const playlists = [regularPlaylist, shortsPlaylist1, shortsPlaylist2]
  const result = filterShortsFromPlaylists(playlists, true)

  assert.strictEqual(result.length, 1)
  assert.strictEqual(result[0]!.id, 'VLplaylist1')
})

test('filterShortsFromShelves eliminates shorts shelves and excludes empty shelves', () => {
  resetShortsFilterMetrics()

  const regularTrack: Track = {
    id: 'track_normal',
    title: 'Starless',
    artistId: 'UCkc',
    artistName: 'King Crimson',
    albumId: 'MPREb_red',
    albumTitle: 'Red',
    albumImage: 'https://example.com/red.jpg',
    artwork: 'https://example.com/red.jpg',
    durationMs: 738000,
    durationSeconds: 738,
    explicit: false,
    playCount: 40,
  }

  const shortTrack: Track = {
    id: 'short_item',
    title: 'Drum fill trick #shorts',
    artistId: 'artist-short_item',
    artistName: 'Drummer',
    albumId: 'album-short_item',
    albumTitle: 'Single',
    albumImage: 'https://example.com/drum.jpg',
    artwork: 'https://example.com/drum.jpg',
    durationMs: 25000,
    durationSeconds: 25,
    explicit: false,
    playCount: 1,
    isShort: true,
  }

  const shelves: HomeShelf[] = [
    {
      title: 'Top Tracks',
      items: [regularTrack, shortTrack],
    },
    {
      title: 'YouTube Shorts',
      items: [shortTrack],
    },
    {
      title: 'Short Clips Shelf',
      items: [shortTrack], // Will become empty and thus dropped
    },
  ]

  const cleanedShelves = filterShortsFromShelves(shelves, true)

  // Shelf 1 has shortTrack stripped -> 1 item remaining
  // Shelf 2 titled "YouTube Shorts" is dropped
  // Shelf 3 becomes empty after stripping shortTrack -> dropped
  assert.strictEqual(cleanedShelves.length, 1)
  assert.strictEqual(cleanedShelves[0]!.title, 'Top Tracks')
  assert.strictEqual(cleanedShelves[0]!.items.length, 1)
  assert.strictEqual(cleanedShelves[0]!.items[0]!.id, 'track_normal')
})

test('filterShortsFromSearchResults sanitizes catalog tracks and playlists', () => {
  resetShortsFilterMetrics()

  const catalog: SearchResultCatalog = {
    tracks: [
      {
        id: 'track1',
        title: 'Time',
        artistId: 'UCpinkfloyd',
        artistName: 'Pink Floyd',
        albumId: 'MPREb_dsotm',
        albumTitle: 'The Dark Side of the Moon',
        albumImage: 'https://example.com/dsotm.jpg',
        artwork: 'https://example.com/dsotm.jpg',
        durationMs: 425000,
        durationSeconds: 425,
        explicit: false,
        playCount: 200,
      },
      {
        id: 'short1',
        title: 'Clock ticking intro #shorts',
        artistId: 'artist-short1',
        artistName: 'Uploader',
        albumId: 'album-short1',
        albumTitle: 'Single',
        albumImage: 'https://example.com/clock.jpg',
        artwork: 'https://example.com/clock.jpg',
        durationMs: 15000,
        durationSeconds: 15,
        explicit: false,
        playCount: 2,
        isShort: true,
      },
    ],
    albums: [],
    artists: [],
    playlists: [
      {
        id: 'SSshorts_feed',
        title: 'Shorts',
        image: 'https://example.com/shorts.jpg',
      },
      {
        id: 'VLclassic_rock',
        title: 'Classic Rock Hits',
        image: 'https://example.com/rock.jpg',
      },
    ],
  }

  const filteredCatalog = filterShortsFromSearchResults(catalog, true)

  assert.strictEqual(filteredCatalog.tracks.length, 1)
  assert.strictEqual(filteredCatalog.tracks[0]!.id, 'track1')
  assert.strictEqual(filteredCatalog.playlists.length, 1)
  assert.strictEqual(filteredCatalog.playlists[0]!.id, 'VLclassic_rock')
})

test('isShortsFilterEnabled honors preferences and defaults to true', () => {
  assert.strictEqual(isShortsFilterEnabled(null), true)
  assert.strictEqual(isShortsFilterEnabled(undefined), true)
  assert.strictEqual(isShortsFilterEnabled({}), true)
  assert.strictEqual(isShortsFilterEnabled({ hideYoutubeShorts: false }), false)
  assert.strictEqual(isShortsFilterEnabled({ hideYoutubeShorts: true }), true)
  assert.strictEqual(isShortsFilterEnabled({ filterShorts: false }), false)
  assert.strictEqual(isShortsFilterEnabled({ filterShorts: true }), true)
})

test('getShortsFilterMetrics tracks telemetry accurately', () => {
  resetShortsFilterMetrics()

  const shortTrack: Track = {
    id: 's1',
    title: 'Guitar riff #shorts',
    artistId: 'artist-s1',
    artistName: 'Guitarist',
    albumId: 'album-s1',
    albumTitle: 'Single',
    albumImage: 'https://example.com/riff.jpg',
    artwork: 'https://example.com/riff.jpg',
    durationMs: 20000,
    durationSeconds: 20,
    explicit: false,
    playCount: 1,
    isShort: true,
  }

  filterShortsFromTracks([shortTrack], true)

  const metrics = getShortsFilterMetrics()
  assert.strictEqual(metrics.shortsDetected >= 1, true)
  assert.strictEqual(metrics.itemsFiltered >= 1, true)
})
