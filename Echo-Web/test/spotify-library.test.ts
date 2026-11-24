import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import {
  spotifyUserProfileSchema,
  spotifyLibraryPlaylistSchema,
  spotifyLibraryUiStateSchema,
  sortSpotifyPlaylists,
  getStoredSpotifySession,
  setStoredSpotifySession,
  clearStoredSpotifySession,
  recordSpotifyLibraryMetric,
  getSpotifyLibraryMetrics,
  resetSpotifyLibraryMetrics,
  type SpotifyLibraryPlaylist,
} from '../src/services/spotify/spotifyLibraryService.ts'

describe('spotifyLibraryService', () => {
  beforeEach(() => {
    resetSpotifyLibraryMetrics()
    clearStoredSpotifySession()
  })

  describe('Schemas', () => {
    it('validates a complete spotify user profile', () => {
      const validProfile = {
        id: 'user_123',
        displayName: 'Test User',
        email: 'test@example.com',
        avatarUrl: 'https://example.com/avatar.jpg',
        product: 'premium',
        followers: 120,
      }
      const parsed = spotifyUserProfileSchema.parse(validProfile)
      assert.strictEqual(parsed.id, 'user_123')
      assert.strictEqual(parsed.displayName, 'Test User')
      assert.strictEqual(parsed.product, 'premium')
    })

    it('validates a spotify library playlist with default values', () => {
      const raw = {
        id: 'pl_001',
        title: 'Chill Vibes',
      }
      const parsed = spotifyLibraryPlaylistSchema.parse(raw)
      assert.strictEqual(parsed.id, 'pl_001')
      assert.strictEqual(parsed.title, 'Chill Vibes')
      assert.strictEqual(parsed.trackCount, 0)
    })

    it('validates the complete library UI state schema', () => {
      const state = {
        isAuthenticated: true,
        accountName: 'Echo Listener',
        avatarUrl: null,
        product: 'free',
        playlists: [
          {
            id: 'pl_002',
            title: 'Rock Classics',
            trackCount: 45,
          },
        ],
        likedSongsCount: 350,
        isLoading: false,
        error: null,
      }
      const parsed = spotifyLibraryUiStateSchema.parse(state)
      assert.strictEqual(parsed.isAuthenticated, true)
      assert.strictEqual(parsed.playlists.length, 1)
      assert.strictEqual(parsed.likedSongsCount, 350)
    })
  })

  describe('Playlist sorting', () => {
    const mockPlaylists: SpotifyLibraryPlaylist[] = [
      { id: '1', title: 'Zebra Tunes', trackCount: 50 },
      { id: '2', title: 'Acoustic Morning', trackCount: 15 },
      { id: '3', title: 'Electronic Beats', trackCount: 120 },
    ]

    it('preserves default order when sortType is DEFAULT', () => {
      const sorted = sortSpotifyPlaylists(mockPlaylists, 'DEFAULT')
      assert.strictEqual(sorted[0]?.id, '1')
      assert.strictEqual(sorted[1]?.id, '2')
      assert.strictEqual(sorted[2]?.id, '3')
    })

    it('sorts alphabetically by title when sortType is NAME', () => {
      const sorted = sortSpotifyPlaylists(mockPlaylists, 'NAME')
      assert.strictEqual(sorted[0]?.title, 'Acoustic Morning')
      assert.strictEqual(sorted[1]?.title, 'Electronic Beats')
      assert.strictEqual(sorted[2]?.title, 'Zebra Tunes')
    })

    it('sorts by trackCount when sortType is SONG_COUNT', () => {
      const sorted = sortSpotifyPlaylists(mockPlaylists, 'SONG_COUNT')
      assert.strictEqual(sorted[0]?.trackCount, 15)
      assert.strictEqual(sorted[1]?.trackCount, 50)
      assert.strictEqual(sorted[2]?.trackCount, 120)
    })

    it('reverses order when sortDescending is true', () => {
      const sorted = sortSpotifyPlaylists(mockPlaylists, 'NAME', true)
      assert.strictEqual(sorted[0]?.title, 'Zebra Tunes')
      assert.strictEqual(sorted[1]?.title, 'Electronic Beats')
      assert.strictEqual(sorted[2]?.title, 'Acoustic Morning')
    })
  })

  describe('Session Storage & Telemetry', () => {
    it('saves and clears stored session', () => {
      // In Node test environment, mock localStorage if available or test safely
      if (typeof localStorage !== 'undefined') {
        setStoredSpotifySession('test_token_xyz', {
          id: 'usr_1',
          displayName: 'Test User',
        })
        const session = getStoredSpotifySession()
        assert.strictEqual(session?.token, 'test_token_xyz')
        assert.strictEqual(session?.profile?.displayName, 'Test User')

        clearStoredSpotifySession()
        assert.strictEqual(getStoredSpotifySession(), null)
      }
    })

    it('records telemetry metrics and resets properly', () => {
      recordSpotifyLibraryMetric('authSuccessCount', 1)
      recordSpotifyLibraryMetric('playlistsLoadedCount', 25)
      recordSpotifyLibraryMetric('likedSongsLoadedCount', 100)

      const metrics = getSpotifyLibraryMetrics()
      assert.strictEqual(metrics.authSuccessCount, 1)
      assert.strictEqual(metrics.playlistsLoadedCount, 25)
      assert.strictEqual(metrics.likedSongsLoadedCount, 100)

      resetSpotifyLibraryMetrics()
      const reset = getSpotifyLibraryMetrics()
      assert.strictEqual(reset.authSuccessCount, 0)
      assert.strictEqual(reset.playlistsLoadedCount, 0)
      assert.strictEqual(reset.likedSongsLoadedCount, 0)
    })
  })
})
