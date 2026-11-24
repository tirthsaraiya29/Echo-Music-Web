import { useState, useEffect, useTransition } from 'react'
import {
  Play,
  Pause,
  X,
  Radio,
  Clock,
  Sparkles,
  Headphones,
  Search,
  Tv,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import {
  getAllPodcastProgress,
  dismissPodcastProgress,
  type PodcastProgressRecord,
} from '../services/db/echoDatabase.ts'
import {
  PODCAST_CATEGORIES,
  discoverPodcasts,
  searchPodcasts,
  getTrendingPodcastShows,
} from '../services/podcast/podcastDiscoveryService.ts'
import { useEchoStore } from '../stores/useEchoStore.ts'
import { formatDuration } from '../utils/format.ts'
import { artwork } from '../utils/artwork.ts'
import { classNames } from '../utils/classNames.ts'
import type { Track, PodcastShow } from '../types/domain.ts'

type ViewFilter = 'all' | 'episodes' | 'shows'

export function PodcastsPage() {
  const navigate = useNavigate()
  const [, startTransition] = useTransition()
  const [inProgress, setInProgress] = useState<PodcastProgressRecord[]>([])
  const [selectedCategory, setSelectedCategory] = useState(PODCAST_CATEGORIES[0]!.id)
  const [categoryEpisodes, setCategoryEpisodes] = useState<Track[]>([])
  const [categoryShows, setCategoryShows] = useState<PodcastShow[]>(() => getTrendingPodcastShows())
  const [searchQuery, setSearchQuery] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all')
  const [isLoading, setIsLoading] = useState(false)

  const currentTrack = useEchoStore((state) => state.currentTrack)
  const isPlaying = useEchoStore((state) => state.isPlaying)
  const playTrack = useEchoStore((state) => state.playTrack)
  const togglePlayback = useEchoStore((state) => state.togglePlayback)
  const followedPodcasts = useEchoStore((state) => state.followedPodcasts)
  const unfollowPodcast = useEchoStore((state) => state.unfollowPodcast)

  // Load in-progress podcast episodes from IndexedDB
  useEffect(() => {
    let cancelled = false
    const loadProgress = async () => {
      try {
        const records = await getAllPodcastProgress(false)
        if (!cancelled) {
          setInProgress(records)
        }
      } catch {
        // Non-fatal
      }
    }
    void loadProgress()
    return () => {
      cancelled = true
    }
  }, [currentTrack?.id])

  // Discover or Search podcasts
  useEffect(() => {
    let cancelled = false
    const loadData = async () => {
      setIsLoading(true)
      try {
        if (activeSearch.trim()) {
          const res = await searchPodcasts(activeSearch.trim())
          if (!cancelled) {
            setCategoryEpisodes(res.episodes)
            setCategoryShows(res.shows)
          }
        } else {
          const res = await discoverPodcasts(selectedCategory)
          if (!cancelled) {
            setCategoryEpisodes(res.episodes)
            setCategoryShows(res.shows)
          }
        }
      } catch {
        // Non-fatal
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadData()
    return () => {
      cancelled = true
    }
  }, [selectedCategory, activeSearch])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(() => {
      setActiveSearch(searchQuery)
    })
  }

  const handleClearSearch = () => {
    setSearchQuery('')
    startTransition(() => {
      setActiveSearch('')
    })
  }

  const handleDismiss = async (e: React.MouseEvent, episodeId: string) => {
    e.stopPropagation()
    await dismissPodcastProgress(episodeId)
    setInProgress((prev) => prev.filter((p) => p.episodeId !== episodeId))
  }

  const handlePlayProgress = (record: PodcastProgressRecord) => {
    const isCurrent = currentTrack?.id === record.episodeId || currentTrack?.videoId === record.episodeId
    if (isCurrent) {
      togglePlayback()
      return
    }

    const durSec = record.durationSeconds ?? Math.round((record.durationMs || 180000) / 1000)
    const track: Track = {
      id: record.episodeId,
      videoId: record.episodeId,
      title: record.episodeTitle,
      artistId: `podcast_${record.showTitle.toLowerCase().replace(/\s+/g, '_')}`,
      artistName: record.showTitle,
      albumId: 'podcasts',
      albumTitle: record.showTitle,
      albumImage: record.artworkUrl || '',
      artwork: record.artworkUrl || '',
      durationMs: record.durationMs || durSec * 1000,
      durationSeconds: durSec,
      explicit: false,
      playCount: 1,
      isPodcast: true,
      podcastShowId: `podcast_${record.showTitle.toLowerCase().replace(/\s+/g, '_')}`,
      showTitle: record.showTitle,
    }

    playTrack(track)
  }

  const handlePlayEpisode = (track: Track) => {
    const isCurrent = currentTrack?.id === track.id || (track.videoId && currentTrack?.videoId === track.videoId)
    if (isCurrent) {
      togglePlayback()
      return
    }
    playTrack({ ...track, isPodcast: true })
  }

  const handleOpenShow = (show: PodcastShow) => {
    const targetId = show.browseId || show.id
    navigate(`/playlist/${targetId}`)
  }

  const showEpisodes = viewFilter === 'all' || viewFilter === 'episodes'
  const showShows = viewFilter === 'all' || viewFilter === 'shows'

  return (
    <div className="collection-page podcasts-page">
      <header className="page-heading">
        <div className="page-heading__content">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#7c5cff]/30 to-[#b09cff]/10 text-[#b09cff] shadow-inner">
                <Radio size={24} />
              </div>
              <div>
                <h1 className="page-heading__title">Podcasts & Shows</h1>
                <p className="page-heading__subtitle">
                  Browse shows, stream full episodes, and resume stories seamlessly.
                </p>
              </div>
            </div>

            {/* Podcast Search Bar */}
            <form onSubmit={handleSearchSubmit} className="relative w-full sm:w-72">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#a59fad]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search podcast shows or topics..."
                className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-8 text-xs text-white placeholder-white/40 focus:border-[#7c5cff] focus:bg-white/10 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                >
                  <X size={14} />
                </button>
              )}
            </form>
          </div>
        </div>
      </header>

      {/* Resume Listening Shelf */}
      {inProgress.length > 0 && !activeSearch && (
        <section className="shelf mb-8" aria-labelledby="resume-podcasts-heading">
          <div className="shelf__header">
            <h2 id="resume-podcasts-heading" className="shelf__title flex items-center gap-2">
              <Clock size={18} className="text-[#b09cff]" />
              <span>Continue Listening</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {inProgress.map((item) => {
              const posSec = item.positionSeconds ?? Math.round(item.positionMs / 1000)
              const durSec = item.durationSeconds ?? Math.round(item.durationMs / 1000)
              const pct = durSec > 0 ? Math.min(100, Math.round((posSec / durSec) * 100)) : 0
              const remainingSec = Math.max(0, durSec - posSec)
              const isCurrent = currentTrack?.id === item.episodeId || currentTrack?.videoId === item.episodeId
              const itemPlaying = isCurrent && isPlaying

              return (
                <div
                  key={item.episodeId}
                  className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/6 bg-white/[0.03] p-4 transition-all hover:border-white/12 hover:bg-white/[0.06] hover:shadow-lg"
                >
                  <div className="flex items-start gap-3">
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-white/5">
                      <img
                        src={artwork(item.artworkUrl || '', 128)}
                        alt={item.episodeTitle}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                      <button
                        type="button"
                        onClick={() => handlePlayProgress(item)}
                        className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label={itemPlaying ? 'Pause episode' : 'Resume episode'}
                      >
                        {itemPlaying ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
                      </button>
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-[#b09cff]">
                        {item.showTitle}
                      </p>
                      <h3 className="line-clamp-2 text-sm font-semibold text-white/90">
                        {item.episodeTitle}
                      </h3>
                      <p className="mt-1 text-[11px] text-[#a59fad]">
                        {remainingSec > 0 ? `${formatDuration(remainingSec)} left` : 'Completed'}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => handleDismiss(e, item.episodeId)}
                      className="text-white/40 hover:text-white"
                      title="Dismiss from history"
                      aria-label="Dismiss from history"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="mt-3">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#7c5cff] to-[#b09cff]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Followed Podcasts Shelf */}
      {followedPodcasts.length > 0 && !activeSearch && (
        <section className="shelf mb-8" aria-labelledby="followed-podcasts-heading">
          <div className="shelf__header flex items-center justify-between">
            <h2 id="followed-podcasts-heading" className="shelf__title flex items-center gap-2">
              <Radio size={18} className="text-[#7c5cff]" />
              <span>Your Followed Shows</span>
            </h2>
            <Link to="/library?tab=podcasts" className="text-xs font-semibold text-[#b09cff] hover:text-white">
              View all ({followedPodcasts.length})
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {followedPodcasts.map((show) => (
              <div
                key={show.id}
                onClick={() => handleOpenShow(show)}
                className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] p-3 transition-all hover:border-white/12 hover:bg-white/[0.06] hover:shadow-lg"
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-white/5">
                  <img
                    src={artwork(show.artworkUrl, 256)}
                    alt={show.title}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="rounded-full bg-[#7c5cff] px-3 py-1 text-xs font-semibold text-white shadow-md">
                      View Show
                    </span>
                  </div>
                </div>
                <div className="mt-2.5 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="truncate text-xs font-semibold text-white/90 group-hover:text-white">
                      {show.title}
                    </h3>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        unfollowPodcast(show.id)
                      }}
                      className="text-white/40 hover:text-white"
                      title="Unfollow show"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <p className="truncate text-[11px] text-[#a59fad]">
                    {show.author}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Featured / Trending Shows Shelf */}
      {showShows && categoryShows.length > 0 && !activeSearch && (
        <section className="shelf mb-8" aria-labelledby="featured-shows-heading">
          <div className="shelf__header">
            <h2 id="featured-shows-heading" className="shelf__title flex items-center gap-2">
              <Tv size={18} className="text-[#7c5cff]" />
              <span>Trending Shows & Creators</span>
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {categoryShows.slice(0, 6).map((show) => (
              <div
                key={show.id}
                onClick={() => handleOpenShow(show)}
                className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] p-3 transition-all hover:border-white/12 hover:bg-white/[0.06] hover:shadow-lg"
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-white/5">
                  <img
                    src={artwork(show.artworkUrl, 256)}
                    alt={show.title}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="rounded-full bg-[#7c5cff] px-3 py-1 text-xs font-semibold text-white shadow-md">
                      View Show
                    </span>
                  </div>
                </div>
                <div className="mt-2.5 min-w-0">
                  <h3 className="truncate text-xs font-semibold text-white/90 group-hover:text-white">
                    {show.title}
                  </h3>
                  <p className="truncate text-[11px] text-[#a59fad]">
                    {show.author}
                  </p>
                  {show.episodeCount && (
                    <span className="mt-1 inline-block text-[10px] text-white/40">
                      {show.episodeCount} episodes
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Filter Tabs & Category Filter Pills */}
      <section className="shelf" aria-labelledby="browse-podcasts-heading">
        <div className="shelf__header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="browse-podcasts-heading" className="shelf__title flex items-center gap-2">
            <Sparkles size={18} className="text-[#7c5cff]" />
            <span>{activeSearch ? `Results for "${activeSearch}"` : 'Discover Episodes & Shows'}</span>
          </h2>

          <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => setViewFilter('all')}
              className={classNames(
                'rounded-lg px-3 py-1 transition-all',
                viewFilter === 'all' ? 'bg-[#7c5cff] text-white font-semibold' : 'text-[#a59fad] hover:text-white',
              )}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setViewFilter('episodes')}
              className={classNames(
                'rounded-lg px-3 py-1 transition-all',
                viewFilter === 'episodes' ? 'bg-[#7c5cff] text-white font-semibold' : 'text-[#a59fad] hover:text-white',
              )}
            >
              Episodes
            </button>
            <button
              type="button"
              onClick={() => setViewFilter('shows')}
              className={classNames(
                'rounded-lg px-3 py-1 transition-all',
                viewFilter === 'shows' ? 'bg-[#7c5cff] text-white font-semibold' : 'text-[#a59fad] hover:text-white',
              )}
            >
              Shows
            </button>
          </div>
        </div>

        {!activeSearch && (
          <div className="mb-6 flex flex-wrap gap-2">
            {PODCAST_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={classNames(
                  'rounded-full px-4 py-2 text-xs font-semibold transition-all',
                  selectedCategory === cat.id
                    ? 'bg-gradient-to-r from-[#7c5cff] to-[#b09cff] text-white shadow-md'
                    : 'bg-white/5 text-[#a59fad] hover:bg-white/10 hover:text-white',
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>
        )}

        {/* Content View: Shows & Episodes */}
        {isLoading ? (
          <div className="flex h-48 items-center justify-center text-sm text-[#a59fad]">
            Loading podcasts...
          </div>
        ) : (
          <div className="space-y-8">
            {/* Shows List if in 'shows' filter */}
            {viewFilter === 'shows' && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {categoryShows.map((show) => (
                  <div
                    key={show.id}
                    onClick={() => handleOpenShow(show)}
                    className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] p-3 transition-all hover:border-white/12 hover:bg-white/[0.06] hover:shadow-lg"
                  >
                    <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-white/5">
                      <img
                        src={artwork(show.artworkUrl, 256)}
                        alt={show.title}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                    </div>
                    <div className="mt-2.5 min-w-0">
                      <h3 className="truncate text-xs font-semibold text-white/90 group-hover:text-white">
                        {show.title}
                      </h3>
                      <p className="truncate text-[11px] text-[#a59fad]">
                        {show.author}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Episodes Grid if in 'all' or 'episodes' */}
            {showEpisodes && (
              categoryEpisodes.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center gap-2 text-[#a59fad]">
                  <Headphones size={32} className="opacity-40" />
                  <p className="text-sm">No podcast episodes found.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {categoryEpisodes.map((episode) => {
                    const isCurrent =
                      currentTrack?.id === episode.id ||
                      (episode.videoId && currentTrack?.videoId === episode.videoId)
                    const episodePlaying = isCurrent && isPlaying

                    return (
                      <div
                        key={episode.id}
                        onClick={() => handlePlayEpisode(episode)}
                        className="group relative flex cursor-pointer gap-3.5 rounded-2xl border border-white/5 bg-white/[0.02] p-3.5 transition-all hover:border-white/12 hover:bg-white/[0.05] hover:shadow-lg"
                      >
                        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-white/5">
                          <img
                            src={artwork(episode.artwork || episode.albumImage, 160)}
                            alt={episode.title}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                          <div
                            className={classNames(
                              'absolute inset-0 flex items-center justify-center bg-black/40 text-white transition-opacity',
                              episodePlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                            )}
                          >
                            {episodePlaying ? (
                              <Pause size={22} />
                            ) : (
                              <Play size={22} className="ml-0.5" />
                            )}
                          </div>
                        </div>

                        <div className="flex min-w-0 flex-1 flex-col justify-between">
                          <div>
                            <span className="inline-block rounded-md bg-[#7c5cff]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#b09cff]">
                              Episode
                            </span>
                            <h3 className="mt-1 line-clamp-2 text-sm font-semibold text-white/90">
                              {episode.title}
                            </h3>
                            <p className="truncate text-xs text-[#a59fad]">
                              {episode.artistName}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 text-[11px] text-[#a59fad]">
                            {episode.durationSeconds ? (
                              <span>{formatDuration(episode.durationSeconds)}</span>
                            ) : episode.durationMs ? (
                              <span>{formatDuration(Math.round(episode.durationMs / 1000))}</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            )}
          </div>
        )}
      </section>
    </div>
  )
}
