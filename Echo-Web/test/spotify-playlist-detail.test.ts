import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import {
  spotifyPlaylistTrackSchema,
  spotifyPlaylistDetailSchema,
  resolveSpotifyTrack,
  importSpotifyPlaylistToLibrary,
  recordSpotifyPlaylistDetailMetric,
  getSpotifyPlaylistDetailMetrics,
  resetSpotifyPlaylistDetailMetrics,
  type SpotifyPlaylistDetail,
} from '../src/services/spotify/spotifyPlaylistDetailService.ts'

describe('spotifyPlaylistDetailService', () => {
  beforeEach(() => {
    resetSpotifyPlaylistDetailMetrics()
  })

  describe('Schemas', () => {
    it('validates a spotify playlist track schema', () => {
      const rawTrack = {
        id: 't_101',
        title: 'Bohemian Rhapsody',
        artist: 'Queen',
        album: 'A Night at the Opera',
        durationMs: 354000,
        isrc: 'GBUM71029604',
      }
      const parsed = spotifyPlaylistTrackSchema.parse(rawTrack)
      assert.strictEqual(parsed.id, 't_101')
      assert.strictEqual(parsed.title, 'Bohemian Rhapsody')
      assert.strictEqual(parsed.artist, 'Queen')
      assert.strictEqual(parsed.durationMs, 354000)
    })

    it('validates a spotify playlist detail payload', () => {
      const rawDetail = {
        id: '37i9dQZF1DXcBWIGoYBM5M',
        title: 'Today Top Hits',
        description: 'The biggest hits right now.',
        coverUrl: 'https://example.com/cover.jpg',
        ownerName: 'Spotify',
        totalTracks: 50,
        offset: 0,
        limit: 50,
        hasMore: false,
        tracks: [
          {
            id: 't_1',
            title: 'Espresso',
            artist: 'Sabrina Carpenter',
          },
        ],
      }
      const parsed = spotifyPlaylistDetailSchema.parse(rawDetail)
      assert.strictEqual(parsed.id, '37i9dQZF1DXcBWIGoYBM5M')
      assert.strictEqual(parsed.title, 'Today Top Hits')
      assert.strictEqual(parsed.tracks.length, 1)
      assert.strictEqual(parsed.tracks[0]?.title, 'Espresso')
    })
  })

  describe('resolveSpotifyTrack', () => {
    it('resolves track to a valid domain Track structure', async () => {
      const trackItem = {
        id: 'tr_sample',
        title: 'Starboy',
        artist: 'The Weeknd',
        durationMs: 230000,
      }
      const resolved = await resolveSpotifyTrack(trackItem)
      assert.ok(resolved)
      assert.ok(resolved.id)
      assert.ok(resolved.title)
      assert.ok(resolved.artistName)
    })
  })

  describe('importSpotifyPlaylistToLibrary', () => {
    it('creates a new user playlist with resolved tracks', () => {
      const detail: SpotifyPlaylistDetail = {
        id: 'sp_pl_1',
        title: 'My Imported Mix',
        description: 'Test playlist description',
        totalTracks: 2,
        offset: 0,
        limit: 50,
        hasMore: false,
        tracks: [],
      }

      const sampleTracks = [
        {
          id: 'yt_1',
          videoId: 'yt_1',
          title: 'Track One',
          artistName: 'Artist One',
          durationMs: 180000,
          explicit: false,
        },
        {
          id: 'yt_2',
          videoId: 'yt_2',
          title: 'Track Two',
          artistName: 'Artist Two',
          durationMs: 200000,
          explicit: false,
        },
      ]

      const createdId = importSpotifyPlaylistToLibrary(detail, sampleTracks)
      assert.ok(createdId)

      const metrics = getSpotifyPlaylistDetailMetrics()
      assert.strictEqual(metrics.importsCount, 1)
    })
  })

  describe('Telemetry Metrics', () => {
    it('records and resets metrics accurately', () => {
      recordSpotifyPlaylistDetailMetric('detailLoadsCount', 3)
      recordSpotifyPlaylistDetailMetric('tracksFetchedCount', 150)
      recordSpotifyPlaylistDetailMetric('playAllTriggersCount', 2)
      recordSpotifyPlaylistDetailMetric('shuffleTriggersCount', 1)

      const metrics = getSpotifyPlaylistDetailMetrics()
      assert.strictEqual(metrics.detailLoadsCount, 3)
      assert.strictEqual(metrics.tracksFetchedCount, 150)
      assert.strictEqual(metrics.playAllTriggersCount, 2)
      assert.strictEqual(metrics.shuffleTriggersCount, 1)

      resetSpotifyPlaylistDetailMetrics()
      const reset = getSpotifyPlaylistDetailMetrics()
      assert.strictEqual(reset.detailLoadsCount, 0)
      assert.strictEqual(reset.tracksFetchedCount, 0)
      assert.strictEqual(reset.playAllTriggersCount, 0)
    })
  })
})
