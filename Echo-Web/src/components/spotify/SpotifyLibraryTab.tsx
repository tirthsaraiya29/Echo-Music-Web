/**
 * Live Spotify Library Tab Component
 *
 * Implements Spotify library authentication, profile header, pinned Liked Songs card,
 * sorting, and playlist grid matching upstream Echo Music architecture:
 * - LibrarySpotifyScreen.kt
 * - LibrarySpotifyViewModel.kt
 */

import { useState, useEffect, useCallback, useTransition } from 'react'
import {
  ExternalLink,
  Heart,
  Key,
  LogOut,
  Music,
  Pin,
  RefreshCw,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  getStoredSpotifySession,
  setStoredSpotifySession,
  clearStoredSpotifySession,
  fetchSpotifyProfile,
  fetchSpotifyLibraryPlaylists,
  fetchSpotifyLikedSongsCount,
  sortSpotifyPlaylists,
  type SpotifyLibraryPlaylist,
  type SpotifyUserProfile,
  type SpotifyPlaylistSortType,
  SPOTIFY_LIKED_SONGS_COVER,
} from '../../services/spotify/spotifyLibraryService.ts'
import { artwork } from '../../utils/artwork.ts'
import { classNames } from '../../utils/classNames.ts'

export function SpotifyLibraryTab() {
  const navigate = useNavigate()
  const [, startTransition] = useTransition()

  const [token, setToken] = useState<string>('')
  const [profile, setProfile] = useState<SpotifyUserProfile | null>(null)
  const [playlists, setPlaylists] = useState<SpotifyLibraryPlaylist[]>([])
  const [likedCount, setLikedCount] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [sortType, setSortType] = useState<SpotifyPlaylistSortType>('DEFAULT')
  const [sortDescending, setSortDescending] = useState<boolean>(false)
  const [isConnectModalOpen, setIsConnectModalOpen] = useState<boolean>(false)
  const [inputToken, setInputToken] = useState<string>('')
  const [connectError, setConnectError] = useState<string | null>(null)

  const loadData = useCallback(async (activeToken: string) => {
    setIsRefreshing(true)
    setErrorMessage(null)
    try {
      const [userProfile, playlistsData, likedSongsTotal] = await Promise.all([
        fetchSpotifyProfile(activeToken).catch(() => null),
        fetchSpotifyLibraryPlaylists(activeToken).catch(() => ({ total: 0, items: [] })),
        fetchSpotifyLikedSongsCount(activeToken).catch(() => 0),
      ])

      startTransition(() => {
        if (userProfile) {
          setProfile(userProfile)
          setStoredSpotifySession(activeToken, userProfile)
        }
        setPlaylists(playlistsData.items)
        setLikedCount(likedSongsTotal)
      })
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to synchronize Spotify library')
    } finally {
      setIsRefreshing(false)
      setIsLoading(false)
    }
  }, [])

  // Restore stored session on mount
  useEffect(() => {
    const session = getStoredSpotifySession()
    if (session && session.token) {
      setToken(session.token)
      if (session.profile) setProfile(session.profile)
      void loadData(session.token)
    } else {
      setIsLoading(false)
    }
  }, [loadData])

  const handleConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputToken.trim()) {
      setConnectError('Please enter a Spotify access token.')
      return
    }

    setConnectError(null)
    setIsRefreshing(true)
    try {
      const cleanToken = inputToken.trim()
      const userProfile = await fetchSpotifyProfile(cleanToken)
      setToken(cleanToken)
      setProfile(userProfile)
      setStoredSpotifySession(cleanToken, userProfile)
      setIsConnectModalOpen(false)
      setInputToken('')
      void loadData(cleanToken)
    } catch (err) {
      setConnectError(
        err instanceof Error ? err.message : 'Invalid Spotify access token or credentials.',
      )
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleDisconnect = () => {
    clearStoredSpotifySession()
    setToken('')
    setProfile(null)
    setPlaylists([])
    setLikedCount(null)
  }

  const sortedPlaylists = sortSpotifyPlaylists(playlists, sortType, sortDescending)

  return (
    <div className="space-y-6">
      {/* Not Authenticated: Connect Banner */}
      {!token && !isLoading && (
        <div className="rounded-3xl border border-[#1DB954]/20 bg-gradient-to-b from-[#1DB954]/10 to-transparent p-8 text-center sm:p-12">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#1DB954]/20 text-[#1DB954] shadow-lg">
            <Music size={32} />
          </div>
          <h2 className="mt-4 text-2xl font-bold text-white">Connect Your Spotify Library</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[#a59fad]">
            Access your Spotify saved playlists, liked tracks, and user profile directly within Echo
            Music Web.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setIsConnectModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-full bg-[#1DB954] px-6 py-2.5 text-sm font-semibold text-black transition-all hover:bg-[#1ed760] hover:shadow-lg active:scale-95"
            >
              <Key size={16} />
              <span>Connect with Spotify</span>
            </button>
            <a
              href="https://developer.spotify.com/documentation/web-api"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-medium text-[#a59fad] transition-colors hover:bg-white/10 hover:text-white"
            >
              <span>Spotify Web API Info</span>
              <ExternalLink size={13} />
            </a>
          </div>
        </div>
      )}

      {/* Authenticated State */}
      {token && (
        <>
          {/* Profile Header */}
          <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <img
                src={profile?.avatarUrl || artwork(profile?.displayName || 'Spotify', 96)}
                alt={profile?.displayName || 'User'}
                className="h-14 w-14 rounded-full border border-white/10 object-cover shadow-md"
              />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-white">
                    {profile?.displayName || 'Spotify User'}
                  </h3>
                  {profile?.product && (
                    <span className="rounded-full bg-[#1DB954]/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#1DB954]">
                      {profile.product}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#a59fad]">
                  {profile?.followers !== undefined ? `${profile.followers} followers • ` : ''}
                  Spotify Connected
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void loadData(token)}
                disabled={isRefreshing}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-50"
                title="Sync Spotify Library"
              >
                <RefreshCw size={14} className={classNames(isRefreshing && 'animate-spin text-[#1DB954]')} />
                <span>{isRefreshing ? 'Syncing...' : 'Sync'}</span>
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-[#f87171] transition-colors hover:bg-red-500/10"
                title="Disconnect Spotify"
              >
                <LogOut size={14} />
                <span>Disconnect</span>
              </button>
            </div>
          </div>

          {errorMessage && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
              {errorMessage}
            </div>
          )}

          {/* Playlists & Liked Songs Section */}
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">Spotify Playlists</h2>
                <p className="text-xs text-[#a59fad]">
                  {playlists.length + (likedCount !== null ? 1 : 0)} collections available
                </p>
              </div>

              {/* Sorting Bar */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 text-xs">
                  <SlidersHorizontal size={13} className="ml-1 text-[#a59fad]" />
                  <button
                    type="button"
                    onClick={() => setSortType('DEFAULT')}
                    className={classNames(
                      'rounded-lg px-2.5 py-1 font-medium transition-all',
                      sortType === 'DEFAULT' ? 'bg-[#1DB954] text-black font-semibold' : 'text-[#a59fad] hover:text-white',
                    )}
                  >
                    Default
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortType('NAME')}
                    className={classNames(
                      'rounded-lg px-2.5 py-1 font-medium transition-all',
                      sortType === 'NAME' ? 'bg-[#1DB954] text-black font-semibold' : 'text-[#a59fad] hover:text-white',
                    )}
                  >
                    Name
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortType('SONG_COUNT')}
                    className={classNames(
                      'rounded-lg px-2.5 py-1 font-medium transition-all',
                      sortType === 'SONG_COUNT' ? 'bg-[#1DB954] text-black font-semibold' : 'text-[#a59fad] hover:text-white',
                    )}
                  >
                    Tracks
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setSortDescending((prev) => !prev)}
                  className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-[#a59fad] hover:text-white"
                  title={sortDescending ? 'Descending order' : 'Ascending order'}
                >
                  {sortDescending ? '↓ Desc' : '↑ Asc'}
                </button>
              </div>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {/* Pinned Liked Songs Card */}
              {likedCount !== null && (
                <div
                  onClick={() => navigate('/playlists/spotify_liked')}
                  className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] p-3 transition-all hover:border-[#1DB954]/30 hover:bg-white/[0.06] hover:shadow-lg"
                >
                  <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-gradient-to-br from-[#450AF5] via-[#8E8EE5] to-[#ABEDD8]">
                    <img
                      src={SPOTIFY_LIKED_SONGS_COVER}
                      alt="Liked Songs"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Heart size={36} className="text-white drop-shadow-md" />
                    </div>
                    <span className="absolute top-2 right-2 rounded-full bg-black/60 p-1 text-[#1DB954] shadow-md">
                      <Pin size={12} />
                    </span>
                  </div>
                  <div className="mt-2.5 min-w-0">
                    <h3 className="truncate text-xs font-semibold text-white/90 group-hover:text-white">
                      Liked Songs
                    </h3>
                    <p className="truncate text-[11px] text-[#a59fad]">
                      {likedCount} songs
                    </p>
                  </div>
                </div>
              )}

              {/* User Playlists */}
              {sortedPlaylists.map((pl) => (
                <div
                  key={pl.id}
                  onClick={() => navigate(`/playlist/spotify_${pl.id}`)}
                  className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] p-3 transition-all hover:border-white/12 hover:bg-white/[0.06] hover:shadow-lg"
                >
                  <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-white/5">
                    <img
                      src={pl.coverUrl || artwork(pl.title, 256)}
                      alt={pl.title}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="rounded-full bg-[#1DB954] px-3 py-1 text-xs font-semibold text-black shadow-md">
                        Open
                      </span>
                    </div>
                  </div>
                  <div className="mt-2.5 min-w-0">
                    <h3 className="truncate text-xs font-semibold text-white/90 group-hover:text-white">
                      {pl.title}
                    </h3>
                    <p className="truncate text-[11px] text-[#a59fad]">
                      {pl.trackCount} songs
                      {pl.ownerName ? ` • ${pl.ownerName}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {playlists.length === 0 && !isRefreshing && (
              <div className="flex h-36 flex-col items-center justify-center rounded-2xl border border-white/5 bg-white/[0.01] p-6 text-center text-sm text-[#a59fad]">
                <Music size={28} className="opacity-40 mb-2" />
                <p>No playlists found in your Spotify account.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Connect Modal */}
      {isConnectModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label="Connect Spotify Account"
        >
          <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#16141e] p-6 text-[#f4f1f7] shadow-2xl">
            <button
              type="button"
              onClick={() => {
                setIsConnectModalOpen(false)
                setConnectError(null)
              }}
              className="absolute right-4 top-4 rounded-full p-2 text-[#a59fad] transition-colors hover:bg-white/10 hover:text-white"
              title="Close"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1DB954]/20 text-[#1DB954]">
                <Key size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Connect Spotify</h3>
                <p className="text-xs text-[#a59fad]">Authenticate to access your library</p>
              </div>
            </div>

            <form onSubmit={(e) => void handleConnectSubmit(e)} className="mt-5 space-y-4">
              <div>
                <label htmlFor="spotify-token-input" className="block text-xs font-medium text-[#f4f1f7]">
                  Spotify User Access Token
                </label>
                <textarea
                  id="spotify-token-input"
                  rows={3}
                  value={inputToken}
                  onChange={(e) => setInputToken(e.target.value)}
                  placeholder="Paste Spotify OAuth access token or sp_dc session token..."
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white placeholder-white/30 focus:border-[#1DB954] focus:outline-none"
                  required
                />
                <p className="mt-1 text-[11px] text-[#a59fad]">
                  Generate a token with scopes <code className="text-[#1DB954]">user-library-read playlist-read-private</code> from the Spotify Developer Console.
                </p>
              </div>

              {connectError && (
                <div className="rounded-lg bg-red-500/10 p-2.5 text-xs text-red-300">
                  {connectError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsConnectModalOpen(false)}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs font-medium text-[#a59fad] transition-colors hover:bg-white/5 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRefreshing}
                  className="rounded-xl bg-[#1DB954] px-5 py-2 text-xs font-semibold text-black transition-all hover:bg-[#1ed760] disabled:opacity-50"
                >
                  {isRefreshing ? 'Validating...' : 'Connect'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
