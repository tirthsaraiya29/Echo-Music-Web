import test from 'node:test'
import assert from 'node:assert'
import type { Track, HomeShelf } from '../src/types/domain.ts'
import type { SearchResultCatalog } from '../src/services/innertube/client.ts'
import {
  isVideoSong,
  filterVideoSongsFromTracks,
  filterVideoSongsFromShelves,
  filterVideoSongsFromSearchResults,
  isVideoSongFilterEnabled,
  getVideoSongFilterMetrics,
  resetVideoSongFilterMetrics,
  videoSongFilterOptionsSchema,
} from '../src/services/innertube/videoSongFilterService.ts'

test('videoSongFilterOptionsSchema validates configuration correctly', () => {
  const parsedDefault = videoSongFilterOptionsSchema.parse({})
  assert.strictEqual(parsedDefault.enabled, false)

  const parsedEnabled = videoSongFilterOptionsSchema.parse({ enabled: true })
  assert.strictEqual(parsedEnabled.enabled, true)
})

test('isVideoSong accurately detects video songs and protects official tracks and podcasts', () => {
  resetVideoSongFilterMetrics()

  // 1. Official audio track (ATV) -> NOT a video song
  const officialTrack: Track = {
    id: 'atv1',
    title: 'Karma Police',
    artistId: 'UCradiohead',
    artistName: 'Radiohead',
    albumId: 'MPREb_okc',
    albumTitle: 'OK Computer',
    albumImage: 'https://example.com/art.jpg',
    artwork: 'https://example.com/art.jpg',
    durationMs: 260000,
    durationSeconds: 260,
    explicit: false,
    playCount: 150,
    musicVideoType: 'MUSIC_VIDEO_TYPE_ATV',
  }
  assert.strictEqual(isVideoSong(officialTrack), false)

  // 2. Official music video (OMV) -> IS a video song
  const musicVideo: Track = {
    id: 'omv1',
    title: 'Karma Police (Official Music Video)',
    artistId: 'UCradiohead',
    artistName: 'Radiohead',
    albumId: 'album_vid',
    albumTitle: 'Single',
    albumImage: 'https://example.com/art.jpg',
    artwork: 'https://example.com/art.jpg',
    durationMs: 270000,
    durationSeconds: 270,
    explicit: false,
    playCount: 50,
    musicVideoType: 'MUSIC_VIDEO_TYPE_OMV',
  }
  assert.strictEqual(isVideoSong(musicVideo), true)

  // 3. User generated content (UGC) -> IS a video song
  const userVideo: Track = {
    id: 'ugc1',
    title: 'Cover Video by Fan',
    artistId: 'artist-fan',
    artistName: 'Fan',
    albumId: 'album_fan',
    albumTitle: 'Single',
    albumImage: 'https://example.com/art.jpg',
    artwork: 'https://example.com/art.jpg',
    durationMs: 200000,
    durationSeconds: 200,
    explicit: false,
    playCount: 1,
    musicVideoType: 'MUSIC_VIDEO_TYPE_UGC',
  }
  assert.strictEqual(isVideoSong(userVideo), true)

  // 4. Explicit isVideo / isVideoSong flags -> IS a video song
  assert.strictEqual(isVideoSong({ isVideo: true, title: 'Video' }), true)
  assert.strictEqual(isVideoSong({ isVideoSong: true, title: 'Video' }), true)

  // 5. Podcast episode: ALWAYS protected, even if video type
  const podcastEpisode: Track = {
    id: 'pod1',
    title: 'Episode 42: The Future of Web Audio',
    artistId: 'UCpod',
    artistName: 'Audio Show',
    albumId: 'album_pod',
    albumTitle: 'Podcast',
    albumImage: 'https://example.com/pod.jpg',
    artwork: 'https://example.com/pod.jpg',
    durationMs: 3600000,
    durationSeconds: 3600,
    explicit: false,
    playCount: 5,
    isPodcast: true,
    musicVideoType: 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE',
  }
  assert.strictEqual(isVideoSong(podcastEpisode), false)

  // 6. Title indicators without official album
  assert.strictEqual(
    isVideoSong({
      id: 'vid_lyric',
      title: 'Amazing Song (Official Lyric Video)',
      albumId: 'album_custom',
    }),
    true,
  )
})

test('filterVideoSongsFromTracks purges video songs when enabled and retains them when disabled', () => {
  resetVideoSongFilterMetrics()

  const audioTrack: Track = {
    id: 'audio1',
    title: 'No Surprises',
    artistId: 'UCradiohead',
    artistName: 'Radiohead',
    albumId: 'MPREb_okc',
    albumTitle: 'OK Computer',
    albumImage: 'https://example.com/art.jpg',
    artwork: 'https://example.com/art.jpg',
    durationMs: 228000,
    durationSeconds: 228,
    explicit: false,
    playCount: 100,
    musicVideoType: 'MUSIC_VIDEO_TYPE_ATV',
  }

  const videoTrack: Track = {
    id: 'video1',
    title: 'No Surprises (Official Music Video)',
    artistId: 'UCradiohead',
    artistName: 'Radiohead',
    albumId: 'album_video1',
    albumTitle: 'Single',
    albumImage: 'https://example.com/video.jpg',
    artwork: 'https://example.com/video.jpg',
    durationMs: 230000,
    durationSeconds: 230,
    explicit: false,
    playCount: 80,
    isVideo: true,
  }

  const tracks = [audioTrack, videoTrack]

  // Filter enabled: only audio track remains
  const filtered = filterVideoSongsFromTracks(tracks, true)
  assert.strictEqual(filtered.length, 1)
  assert.strictEqual(filtered[0]!.id, 'audio1')

  // Filter disabled: both remain
  const unfiltered = filterVideoSongsFromTracks(tracks, false)
  assert.strictEqual(unfiltered.length, 2)
})

test('filterVideoSongsFromShelves removes video shelves and drops empty shelves', () => {
  resetVideoSongFilterMetrics()

  const audioTrack: Track = {
    id: 'audio1',
    title: 'Let Down',
    artistId: 'UCradiohead',
    artistName: 'Radiohead',
    albumId: 'MPREb_okc',
    albumTitle: 'OK Computer',
    albumImage: 'https://example.com/art.jpg',
    artwork: 'https://example.com/art.jpg',
    durationMs: 299000,
    durationSeconds: 299,
    explicit: false,
    playCount: 90,
  }

  const videoTrack: Track = {
    id: 'vid1',
    title: 'Let Down Live Video',
    artistId: 'UCradiohead',
    artistName: 'Radiohead',
    albumId: 'album_vid',
    albumTitle: 'Single',
    albumImage: 'https://example.com/vid.jpg',
    artwork: 'https://example.com/vid.jpg',
    durationMs: 310000,
    durationSeconds: 310,
    explicit: false,
    playCount: 12,
    isVideo: true,
  }

  const shelves: HomeShelf[] = [
    {
      title: 'Popular Tracks',
      items: [audioTrack, videoTrack],
    },
    {
      title: 'Music Videos',
      items: [videoTrack],
    },
    {
      title: 'Video Shelf Only',
      items: [videoTrack], // Drops because it becomes empty
    },
  ]

  const cleaned = filterVideoSongsFromShelves(shelves, true)

  assert.strictEqual(cleaned.length, 1)
  assert.strictEqual(cleaned[0]!.title, 'Popular Tracks')
  assert.strictEqual(cleaned[0]!.items.length, 1)
  assert.strictEqual(cleaned[0]!.items[0]!.id, 'audio1')
})

test('filterVideoSongsFromSearchResults cleans tracks in search catalog', () => {
  resetVideoSongFilterMetrics()

  const catalog: SearchResultCatalog = {
    tracks: [
      {
        id: 'track1',
        title: 'Climbing Up the Walls',
        artistId: 'UCradiohead',
        artistName: 'Radiohead',
        albumId: 'MPREb_okc',
        albumTitle: 'OK Computer',
        albumImage: 'https://example.com/art.jpg',
        artwork: 'https://example.com/art.jpg',
        durationMs: 285000,
        durationSeconds: 285,
        explicit: false,
        playCount: 70,
      },
      {
        id: 'vid1',
        title: 'Climbing Up the Walls (Official Video)',
        artistId: 'UCradiohead',
        artistName: 'Radiohead',
        albumId: 'album_vid',
        albumTitle: 'Single',
        albumImage: 'https://example.com/vid.jpg',
        artwork: 'https://example.com/vid.jpg',
        durationMs: 290000,
        durationSeconds: 290,
        explicit: false,
        playCount: 15,
        isVideo: true,
      },
    ],
    albums: [],
    artists: [],
    playlists: [],
  }

  const filtered = filterVideoSongsFromSearchResults(catalog, true)
  assert.strictEqual(filtered.tracks.length, 1)
  assert.strictEqual(filtered.tracks[0]!.id, 'track1')
})

test('isVideoSongFilterEnabled correctly checks preferences and data saver', () => {
  assert.strictEqual(isVideoSongFilterEnabled(null), false)
  assert.strictEqual(isVideoSongFilterEnabled(undefined), false)
  assert.strictEqual(isVideoSongFilterEnabled({}), false)
  assert.strictEqual(isVideoSongFilterEnabled({ hideVideoSongs: true }), true)
  assert.strictEqual(isVideoSongFilterEnabled({ hideVideoSongs: false }), false)
  assert.strictEqual(isVideoSongFilterEnabled({ dataSaver: true }), true)
  assert.strictEqual(isVideoSongFilterEnabled({ hideVideoSongs: false, dataSaver: true }), true)
})

test('getVideoSongFilterMetrics tracks operations and resets', () => {
  resetVideoSongFilterMetrics()

  const videoTrack: Track = {
    id: 'v1',
    title: 'Test Video',
    artistId: 'a1',
    artistName: 'A1',
    albumId: 'al1',
    albumTitle: 'Single',
    albumImage: 'https://example.com/art.jpg',
    artwork: 'https://example.com/art.jpg',
    durationMs: 180000,
    durationSeconds: 180,
    explicit: false,
    playCount: 1,
    isVideo: true,
  }

  filterVideoSongsFromTracks([videoTrack], true)

  const m = getVideoSongFilterMetrics()
  assert.strictEqual(m.videoSongsDetected >= 1, true)
  assert.strictEqual(m.itemsFiltered >= 1, true)
})
