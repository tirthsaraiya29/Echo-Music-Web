import { useState, useEffect } from 'react'
import {
  Play,
  Pause,
  X,
  Radio,
  Clock,
  Sparkles,
  Headphones,
} from 'lucide-react'
import {
  getAllPodcastProgress,
  dismissPodcastProgress,
  type PodcastProgressRecord,
} from '../services/db/echoDatabase.ts'
import { InnerTubeClient } from '../services/innertube/client.ts'
import { useEchoStore } from '../stores/useEchoStore.ts'
import { formatDuration } from '../utils/format.ts'
import { artwork } from '../utils/artwork.ts'
import { classNames } from '../utils/classNames.ts'
import type { Track } from '../types/domain.ts'

const PODCAST_CATEGORIES = [
  { id: 'all', label: 'All Podcasts', query: 'popular podcasts full episodes' },
  { id: 'tech', label: 'Technology', query: 'technology podcasts full episodes' },
  { id: 'crime', label: 'True Crime', query: 'true crime podcasts full episodes' },
  { id: 'comedy', label: 'Comedy', query: 'comedy podcasts full episodes' },
  { id: 'news', label: 'News & Politics', query: 'daily news podcasts full episodes' },
  { id: 'science', label: 'Science', query: 'science podcasts full episodes' },
  { id: 'business', label: 'Business', query: 'business entrepreneurship podcasts full episodes' },
]

export function PodcastsPage() {
  const [inProgress, setInProgress] = useState<PodcastProgressRecord[]>([])
  const [selectedCategory, setSelectedCategory] = useState(PODCAST_CATEGORIES[0]!.id)
  const [categoryEpisodes, setCategoryEpisodes] = useState<Track[]>([])
  const [isLoadingCategory, setIsLoadingCategory] = useState(false)

  const currentTrack = useEchoStore((state) => state.currentTrack)
  const isPlaying = useEchoStore((state) => state.isPlaying)
  const playTrack = useEchoStore((state) => state.playTrack)
  const togglePlayback = useEchoStore((state) => state.togglePlayback)

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

  // Fetch episodes for selected category
  useEffect(() => {
    let cancelled = false
    const fetchCategory = async () => {
      const category = PODCAST_CATEGORIES.find((c) => c.id === selectedCategory) || PODCAST_CATEGORIES[0]!
      setIsLoadingCategory(true)
      try {
        const results = await InnerTubeClient.search(category.query, 'podcasts')
        if (!cancelled) {
          const tracks: Track[] = (results.tracks || []).map((t: Track) => ({
            ...t,
            isPodcast: true,
            albumTitle: t.albumTitle || 'Podcast',
          }))
          setCategoryEpisodes(tracks)
        }
      } catch {
        // Non-fatal
      } finally {
        if (!cancelled) {
          setIsLoadingCategory(false)
        }
      }
    }

    void fetchCategory()
    return () => {
      cancelled = true
    }
  }, [selectedCategory])

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
      durationMs: (record.durationMs || durSec * 1000),
      durationSeconds: durSec,
      explicit: false,
      playCount: 1,
      isPodcast: true,
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

  return (
    <div className="collection-page podcasts-page">
      <header className="page-heading">
        <div className="page-heading__content">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#7c5cff]/30 to-[#b09cff]/10 text-[#b09cff] shadow-inner">
              <Radio size={24} />
            </div>
            <div>
              <h1 className="page-heading__title">Podcasts & Shows</h1>
              <p className="page-heading__subtitle">
                Listen to full episodes, resume in-progress stories, and discover top creators.
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Resume Listening Shelf */}
      {inProgress.length > 0 && (
        <section className="shelf" aria-labelledby="resume-podcasts-heading">
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

      {/* Category Filter Pills */}
      <section className="shelf" aria-labelledby="browse-podcasts-heading">
        <div className="shelf__header">
          <h2 id="browse-podcasts-heading" className="shelf__title flex items-center gap-2">
            <Sparkles size={18} className="text-[#7c5cff]" />
            <span>Discover Episodes</span>
          </h2>
        </div>

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

        {/* Episode Grid */}
        {isLoadingCategory ? (
          <div className="flex h-48 items-center justify-center text-sm text-[#a59fad]">
            Loading podcast episodes...
          </div>
        ) : categoryEpisodes.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-[#a59fad]">
            <Headphones size={32} className="opacity-40" />
            <p className="text-sm">No episodes found for this topic.</p>
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
        )}
      </section>
    </div>
  )
}
