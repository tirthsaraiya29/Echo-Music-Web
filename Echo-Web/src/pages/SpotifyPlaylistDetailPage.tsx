/**
 * Spotify Playlist Detail Page Component
 *
 * Implements playlist hero, play all, shuffle, per-track state,
 * resolution to playable YouTube streams, and pagination matching
 * upstream Echo Music architecture:
 * - SpotifyPlaylistDetailScreen.kt
 * - SpotifyPlaylistDetailViewModel.kt
 */

import { useState, useEffect, useTransition, useCallback } from 'react'
import {
  Download,
  Heart,
  Loader2,
  Music,
  Play,
  Search,
  Share2,
  Shuffle,
  Volume2,
} from 'lucide-react'
import { useParams, useNavigate } from 'react-router-dom'
import { AudioEngine } from '../engine/AudioEngine.ts'
import { useEchoStore } from '../stores/useEchoStore.ts'
import {
  fetchSpotifyPlaylistDetail,
  resolveSpotifyTrack,
  importSpotifyPlaylistToLibrary,
  recordSpotifyPlaylistDetailMetric,
  type SpotifyPlaylistDetail,
  type SpotifyPlaylistTrack,
} from '../services/spotify/spotifyPlaylistDetailService.ts'
import { formatDuration, formatDurationLong } from '../utils/format.ts'
import { artwork } from '../utils/artwork.ts'
import { classNames } from '../utils/classNames.ts'
import type { Track } from '../types/domain.ts'

interface SpotifyPlaylistDetailPageProps {
  playlistIdOverride?: string
}

export function SpotifyPlaylistDetailPage({ playlistIdOverride }: SpotifyPlaylistDetailPageProps) {
  const { playlistId: paramId = '' } = useParams()
  const activeId = playlistIdOverride || paramId
  const navigate = useNavigate()
  const [, startTransition] = useTransition()

  const [detail, setDetail] = useState<SpotifyPlaylistDetail | null>(null)
  const [tracks, setTracks] = useState<SpotifyPlaylistTrack[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [loadingMore, setLoadingMore] = useState<boolean>(false)
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [filterQuery, setFilterQuery] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const setToast = useEchoStore((state) => state.setToast)
  const likedTrackIds = useEchoStore((state) => state.likedTrackIds)
  const toggleTrackLike = useEchoStore((state) => state.toggleTrackLike)

  const engine = AudioEngine.getInstance()
  const currentTrack = engine.getCurrentTrack()
  const isPlaying = engine.isPlaying

  const loadInitialData = useCallback(async () => {
    if (!activeId) return
    setLoading(true)
    setErrorMessage(null)
    try {
      const res = await fetchSpotifyPlaylistDetail(activeId, { offset: 0, limit: 50 })
      startTransition(() => {
        setDetail(res)
        setTracks(res.tracks)
      })
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load Spotify playlist')
    } finally {
      setLoading(false)
    }
  }, [activeId])

  useEffect(() => {
    void loadInitialData()
  }, [loadInitialData])

  const handleLoadMore = async () => {
    if (!detail || !detail.hasMore || loadingMore) return
    setLoadingMore(true)
    try {
      const nextOffset = tracks.length
      const res = await fetchSpotifyPlaylistDetail(activeId, { offset: nextOffset, limit: 50 })
      startTransition(() => {
        setTracks((prev) => [...prev, ...res.tracks])
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                hasMore: res.hasMore,
                offset: res.offset,
              }
            : res,
        )
      })
    } catch {
      setToast('Failed to load more tracks.')
    } finally {
      setLoadingMore(false)
    }
  }

  const handlePlayTrack = async (item: SpotifyPlaylistTrack) => {
    setResolvingId(item.id)
    try {
      const resolved = await resolveSpotifyTrack(item)
      if (resolved) {
        await engine.play(resolved)
      } else {
        setToast(`Could not resolve stream for "${item.title}".`)
      }
    } catch {
      setToast(`Error playing "${item.title}".`)
    } finally {
      setResolvingId(null)
    }
  }

  const handlePlayAll = async () => {
    if (tracks.length === 0) return
    recordSpotifyPlaylistDetailMetric('playAllTriggersCount')
    const firstItem = tracks[0]!
    setResolvingId(firstItem.id)
    try {
      const resolvedFirst = await resolveSpotifyTrack(firstItem)
      if (resolvedFirst) {
        await engine.play(resolvedFirst)
        // Background resolve remaining tracks for queue
        void Promise.all(tracks.slice(1, 15).map(resolveSpotifyTrack)).then((more) => {
          const valid = more.filter((t): t is Track => Boolean(t))
          for (const track of valid) {
            engine.addToQueue(track)
          }
        })
      }
    } catch {
      setToast('Failed to start playback.')
    } finally {
      setResolvingId(null)
    }
  }

  const handleShuffle = async () => {
    if (tracks.length === 0) return
    recordSpotifyPlaylistDetailMetric('shuffleTriggersCount')
    const randIdx = Math.floor(Math.random() * tracks.length)
    const selected = tracks[randIdx]!
    setResolvingId(selected.id)
    try {
      const resolved = await resolveSpotifyTrack(selected)
      if (resolved) {
        await engine.play(resolved)
        engine.setShuffle(true)
      }
    } catch {
      setToast('Failed to shuffle playlist.')
    } finally {
      setResolvingId(null)
    }
  }

  const handleImportToLibrary = async () => {
    if (!detail || tracks.length === 0) return
    setToast('Resolving and importing playlist...')
    try {
      const resolvedList: Track[] = []
      for (const t of tracks) {
        const res = await resolveSpotifyTrack(t)
        if (res) resolvedList.push(res)
      }

      const newId = importSpotifyPlaylistToLibrary(detail, resolvedList)
      setToast(`Imported ${resolvedList.length} tracks to library!`)
      navigate(`/playlists/${newId}`)
    } catch {
      setToast('Failed to import playlist.')
    }
  }

  const handleShare = () => {
    const url = window.location.href
    void navigator.clipboard?.writeText(url)
    setToast('Link copied to clipboard!')
  }

  const filteredTracks = tracks.filter((t) => {
    if (!filterQuery.trim()) return true
    const q = filterQuery.toLowerCase()
    return t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
  })

  const totalDurationMs = tracks.reduce((sum, t) => sum + (t.durationMs || 180000), 0)

  if (loading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3 text-[#a59fad]">
        <Loader2 size={36} className="animate-spin text-[#1DB954]" />
        <p className="text-sm">Loading Spotify playlist...</p>
      </div>
    )
  }

  if (errorMessage || !detail) {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-3 p-6 text-center text-[#a59fad]">
        <Music size={40} className="opacity-40 text-red-400" />
        <h3 className="text-lg font-bold text-white">Could not load playlist</h3>
        <p className="max-w-md text-xs text-red-300">{errorMessage || 'Playlist not found.'}</p>
        <button
          type="button"
          onClick={() => void loadInitialData()}
          className="mt-2 rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20"
        >
          Try Again
        </button>
      </div>
    )
  }

  const coverSrc = detail.coverUrl || artwork(detail.title, 320)

  return (
    <div className="space-y-8 pb-16">
      {/* Hero Section */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
        <div className="relative aspect-square w-48 shrink-0 overflow-hidden rounded-2xl bg-white/5 shadow-2xl sm:w-56">
          <img
            src={coverSrc}
            alt={detail.title}
            className="h-full w-full object-cover"
            onError={(e) => {
              const fallback = artwork(detail.title, 320)
              if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback
            }}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[#1DB954]/20 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#1DB954]">
              Spotify Playlist
            </span>
          </div>

          <h1 className="mt-2 text-3xl font-extrabold text-white sm:text-4xl line-clamp-2">
            {detail.title}
          </h1>

          {detail.description && (
            <p className="mt-2 text-xs text-[#a59fad] line-clamp-2">
              {detail.description}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[#a59fad]">
            <span className="font-semibold text-white">{detail.ownerName || 'Spotify'}</span>
            <span>•</span>
            <span>{detail.totalTracks} songs</span>
            <span>•</span>
            <span>{formatDurationLong(totalDurationMs)}</span>
          </div>

          {/* Action Buttons */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handlePlayAll()}
              className="inline-flex items-center gap-2 rounded-full bg-[#1DB954] px-6 py-2.5 text-sm font-bold text-black transition-all hover:bg-[#1ed760] hover:shadow-lg active:scale-95"
            >
              <Play size={18} fill="currentColor" />
              <span>Play All</span>
            </button>

            <button
              type="button"
              onClick={() => void handleShuffle()}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-white/10"
              title="Shuffle Playlist"
            >
              <Shuffle size={15} />
              <span>Shuffle</span>
            </button>

            <button
              type="button"
              onClick={() => void handleImportToLibrary()}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-semibold text-[#b09cff] transition-colors hover:bg-white/10 hover:text-white"
              title="Import into your Echo library"
            >
              <Download size={14} />
              <span>Import to Library</span>
            </button>

            <button
              type="button"
              onClick={handleShare}
              className="rounded-full border border-white/10 bg-white/5 p-2.5 text-[#a59fad] transition-colors hover:bg-white/10 hover:text-white"
              title="Share Playlist"
            >
              <Share2 size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Filter and Track Tools */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/5 pb-4">
        <div className="relative max-w-xs flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a59fad]" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Search within playlist..."
            className="w-full rounded-xl border border-white/10 bg-white/5 py-1.5 pl-9 pr-3 text-xs text-white placeholder-white/30 focus:border-[#1DB954] focus:outline-none"
          />
        </div>

        <div className="text-xs text-[#a59fad]">
          Showing {filteredTracks.length} of {detail.totalTracks} tracks
        </div>
      </div>

      {/* Track List */}
      <div className="space-y-1">
        {filteredTracks.map((item, index) => {
          const isResolving = resolvingId === item.id
          const isCurrent =
            currentTrack?.title.toLowerCase() === item.title.toLowerCase() &&
            currentTrack?.artistName.toLowerCase() === item.artist.toLowerCase()
          const isItemPlaying = isCurrent && isPlaying
          const isLiked = likedTrackIds.some((id) => id.includes(item.title.toLowerCase()))

          return (
            <div
              key={item.id}
              onClick={() => void handlePlayTrack(item)}
              className={classNames(
                'group flex cursor-pointer items-center gap-4 rounded-xl px-4 py-2.5 transition-colors',
                isCurrent ? 'bg-white/10 text-white' : 'hover:bg-white/[0.04] text-[#f4f1f7]',
              )}
            >
              {/* Index / Play / Spinner */}
              <div className="w-8 text-center text-xs text-[#a59fad]">
                {isResolving ? (
                  <Loader2 size={15} className="mx-auto animate-spin text-[#1DB954]" />
                ) : isItemPlaying ? (
                  <Volume2 size={15} className="mx-auto text-[#1DB954] animate-pulse" />
                ) : (
                  <>
                    <span className="group-hover:hidden">{index + 1}</span>
                    <Play size={14} className="mx-auto hidden group-hover:block text-white" />
                  </>
                )}
              </div>

              {/* Title & Artist */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4
                    className={classNames(
                      'truncate text-sm font-semibold',
                      isCurrent ? 'text-[#1DB954]' : 'text-white/90 group-hover:text-white',
                    )}
                  >
                    {item.title}
                  </h4>
                </div>
                <p className="truncate text-xs text-[#a59fad]">{item.artist}</p>
              </div>

              {/* Album */}
              {item.album && (
                <div className="hidden md:block flex-1 min-w-0 truncate text-xs text-[#a59fad]">
                  {item.album}
                </div>
              )}

              {/* Like Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleTrackLike(item.id)
                }}
                className={classNames(
                  'rounded-full p-1.5 transition-colors',
                  isLiked ? 'text-[#1DB954]' : 'text-white/30 hover:text-white',
                )}
                title={isLiked ? 'Liked' : 'Like track'}
              >
                <Heart size={15} fill={isLiked ? 'currentColor' : 'none'} />
              </button>

              {/* Duration */}
              <div className="w-14 text-right text-xs text-[#a59fad]">
                {item.durationMs ? formatDuration(Math.round(item.durationMs / 1000)) : '--:--'}
              </div>
            </div>
          )
        })}

        {filteredTracks.length === 0 && (
          <div className="py-12 text-center text-sm text-[#a59fad]">
            No tracks match your search query.
          </div>
        )}
      </div>

      {/* Paging: Load More Button */}
      {detail.hasMore && (
        <div className="flex justify-center pt-4">
          <button
            type="button"
            onClick={() => void handleLoadMore()}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-6 py-2.5 text-xs font-semibold text-white transition-all hover:bg-white/10 hover:border-white/20 disabled:opacity-50"
          >
            {loadingMore ? (
              <>
                <Loader2 size={14} className="animate-spin text-[#1DB954]" />
                <span>Loading more tracks...</span>
              </>
            ) : (
              <span>Load More Tracks ({detail.totalTracks - tracks.length} remaining)</span>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
