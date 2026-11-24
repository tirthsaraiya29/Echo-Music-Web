import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Play,
  Radio,
  Shuffle,
  RotateCcw,
} from 'lucide-react'
import {
  fetchMoodGenreDetail,
  startMoodGenreRadio,
  type MoodGenreDetail,
} from '../services/recommendations/moodGenreService.ts'
import { useEchoStore } from '../stores/useEchoStore.ts'
import { TrackList } from '../components/MusicUI.tsx'
import { classNames } from '../utils/classNames.ts'

export function MoodGenrePage() {
  const { id } = useParams<{ id: string }>()
  const moodId = id || 'chill'

  const [activeFilter, setActiveFilter] = useState('All')
  const [detail, setDetail] = useState<MoodGenreDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const playQueue = useEchoStore((state) => state.playQueue)
  const setToast = useEchoStore((state) => state.setToast)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)

    fetchMoodGenreDetail(moodId, activeFilter)
      .then((data) => {
        if (!cancelled) setDetail(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load mood content')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [moodId, activeFilter])

  const handleStartRadio = () => {
    if (!detail || detail.tracks.length === 0) return
    startMoodGenreRadio(detail.id, detail.tracks, 0)
  }

  const handlePlayAll = () => {
    if (!detail || detail.tracks.length === 0) return
    playQueue(detail.tracks, 0)
    setToast(`Playing ${detail.title}`)
  }

  const handleShuffle = () => {
    if (!detail || detail.tracks.length === 0) return
    const shuffled = [...detail.tracks]
      .map((val) => ({ val, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ val }) => val)
    playQueue(shuffled, 0)
    setToast(`Shuffling ${detail.title}`)
  }

  return (
    <div className="page space-y-6">
      {/* Navigation breadcrumb */}
      <div>
        <Link
          to="/discover"
          className="inline-flex items-center gap-2 text-xs font-semibold text-[#a59fad] transition-colors hover:text-white min-h-[36px]"
        >
          <ArrowLeft size={16} />
          <span>Back to Discover</span>
        </Link>
      </div>

      {isLoading && (
        <div className="space-y-4" aria-busy="true" aria-label="Loading mood content">
          <div className="h-48 w-full animate-pulse rounded-2xl bg-white/5" />
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 w-full animate-pulse rounded-xl bg-white/5" />
            ))}
          </div>
        </div>
      )}

      {error && !isLoading && (
        <div className="error-banner" role="alert">
          <h2>Could not load {moodId}</h2>
          <p>{error}</p>
          <button
            className="button button--primary"
            type="button"
            onClick={() => {
              setIsLoading(true)
              fetchMoodGenreDetail(moodId, activeFilter)
                .then(setDetail)
                .catch((e) => setError(e.message))
                .finally(() => setIsLoading(false))
            }}
          >
            <RotateCcw size={16} /> Retry
          </button>
        </div>
      )}

      {!isLoading && !error && detail && (
        <>
          {/* Hero Banner with dynamic gradient */}
          <div
            className={`relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br ${detail.gradient} p-6 md:p-8 shadow-2xl backdrop-blur-md`}
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="flex items-start gap-4">
                <span className="text-5xl md:text-6xl drop-shadow-md select-none" aria-hidden="true">
                  {detail.icon}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-white">
                      {detail.type}
                    </span>
                    <span className="text-xs text-white/70">
                      {detail.tracks.length} curated tracks
                    </span>
                  </div>
                  <h1 className="mt-1 text-2xl md:text-4xl font-extrabold text-white tracking-tight">
                    {detail.title}
                  </h1>
                  <p className="mt-1 max-w-xl text-xs md:text-sm text-white/80 leading-relaxed">
                    {detail.description}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleStartRadio}
                  className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-black transition-all hover:bg-white/90 active:scale-95 shadow-lg min-h-[44px]"
                  aria-label={`Start ${detail.title} Radio`}
                >
                  <Radio size={16} className="text-[#7c5cff]" />
                  <span>Start Radio</span>
                </button>

                <button
                  type="button"
                  onClick={handlePlayAll}
                  className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-white/20 min-h-[44px]"
                  aria-label={`Play all ${detail.title} songs`}
                >
                  <Play size={15} fill="currentColor" />
                  <span>Play All</span>
                </button>

                <button
                  type="button"
                  onClick={handleShuffle}
                  className="flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3.5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-white/20 min-h-[44px]"
                  title="Shuffle playlist"
                  aria-label="Shuffle tracks"
                >
                  <Shuffle size={15} />
                  <span>Shuffle</span>
                </button>
              </div>
            </div>
          </div>

          {/* Sub-Filters Pills */}
          {detail.subFilters.length > 0 && (
            <div className="filter-pills" role="tablist" aria-label={`${detail.title} category sub-filters`}>
              {detail.subFilters.map((sub) => (
                <button
                  key={sub}
                  type="button"
                  role="tab"
                  aria-selected={activeFilter === sub}
                  className={classNames('filter-pill', activeFilter === sub && 'is-active')}
                  onClick={() => setActiveFilter(sub)}
                >
                  {sub}
                </button>
              ))}
            </div>
          )}

          {/* Track List */}
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#a59fad]">
              Curated Tracks ({detail.tracks.length})
            </h2>
            <TrackList items={detail.tracks} />
          </section>
        </>
      )}
    </div>
  )
}
