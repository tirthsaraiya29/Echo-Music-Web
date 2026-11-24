import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownUp,
  Clock3,
  GripVertical,
  ListMusic,
  Pause,
  Play,
  Radio,
  Search,
  Shuffle,
  Trash2,
  DownloadCloud,
  FileText,
  Calendar,
  Laptop,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import type { RecentlyPlayedItem, Track } from '../types/domain.ts'
import { useAudioEngine } from '../hooks/useAudioEngine.ts'
import { getCachedTrack, useEchoStore } from '../stores/useEchoStore.ts'
import { resolveMissingTrack } from '../services/db/echoDatabase.ts'
import { formatDuration, formatTimestamp } from '../utils/format.ts'
import { artwork } from '../utils/artwork.ts'
import { classNames } from '../utils/classNames.ts'
import {
  queryListeningHistory,
  deleteHistoryRecord,
  clearAllListeningHistory,
  exportHistoryJson,
  exportHistoryCsv,
  downloadFile,
  type HistoryRecord,
  type HistoryFilterOptions,
} from '../services/history/listeningHistoryService.ts'
import {
  MediaCard,
  PageHeading,
  SectionHeading,
  TrackList,
  TrackRow,
} from '../components/MusicUI.tsx'
import { EchoMusicLogo } from '../components/EchoMusicLogo.tsx'

export function LikedPage() {
  const likedIds = useEchoStore((state) => state.likedTrackIds)
  const trackCache = useEchoStore((state) => state.trackCache)
  const cacheTrack = useEchoStore((state) => state.cacheTrack)
  const setToast = useEchoStore((state) => state.setToast)
  const { playQueue } = useAudioEngine()

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'recent' | 'title' | 'artist'>('recent')

  // Automatically resolve any liked tracks missing from memory/cache
  useEffect(() => {
    const missing = likedIds.filter((id) => !trackCache[id] && !getCachedTrack(id))
    if (missing.length === 0) return

    let cancelled = false
    void Promise.all(
      missing.map(async (id) => {
        const resolved = await resolveMissingTrack(id)
        if (resolved && !cancelled) {
          cacheTrack(resolved)
        }
      }),
    )

    return () => {
      cancelled = true
    }
  }, [likedIds, trackCache, cacheTrack])

  const likedTracks = useMemo(() => {
    const items = likedIds
      .map((id) => trackCache[id] || getCachedTrack(id))
      .filter((track): track is Track => Boolean(track))
    const filtered = items.filter((track) =>
      `${track.title} ${track.artistName} ${track.albumTitle}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    )
    if (sort === 'title') return filtered.sort((a, b) => a.title.localeCompare(b.title))
    if (sort === 'artist') return filtered.sort((a, b) => a.artistName.localeCompare(b.artistName))
    return filtered
  }, [likedIds, trackCache, query, sort])

  const playAll = () => {
    if (likedTracks.length > 0) playQueue(likedTracks, 0)
    else setToast('Like a track to start your collection.')
  }
  const shuffle = () => {
    if (likedTracks.length > 0) {
      const rand = Math.floor(Math.random() * likedTracks.length)
      playQueue(likedTracks, rand)
    } else setToast('Like a track to shuffle your collection.')
  }

  return (
    <div className="page">
      <div className="collection-hero">
        <div className="liked-art">
          <EchoMusicLogo size={36} className="text-white" />
          <span>Echo Music</span>
        </div>
        <div>
          <h1>Liked Songs</h1>
          <p>{likedIds.length} songs you want to keep close.</p>
          <div className="detail-actions">
            <button
              className="play-button play-button--large"
              type="button"
              aria-label="Play liked songs"
              onClick={playAll}
            >
              <Play size={20} fill="currentColor" />
            </button>
            <button className="button button--quiet" type="button" onClick={shuffle}>
              <Shuffle size={16} /> Shuffle
            </button>
          </div>
        </div>
      </div>
      <div className="collection-toolbar">
        <label className="library-filter-wrap">
          <Search size={16} />
          <input
            className="library-filter"
            aria-label="Search liked songs"
            placeholder="Find in Liked Songs"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="sort-control">
          <ArrowDownUp size={15} />
          <span className="sr-only">Sort liked songs</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="recent">Recently added</option>
            <option value="title">Title</option>
            <option value="artist">Artist</option>
          </select>
        </label>
      </div>
      <TrackList items={likedTracks} />
    </div>
  )
}

function RecentlyPlayedRow({ item, index }: { item: RecentlyPlayedItem; index: number }) {
  const trackCache = useEchoStore((state) => state.trackCache)

  if (item.kind === 'track') {
    const track = trackCache[item.id] || {
      id: item.id,
      title: item.title,
      artistName: item.subtitle,
      artistId: `artist-${item.id}`,
      albumId: `album-${item.id}`,
      albumTitle: '',
      albumImage: item.image,
      artwork: item.image,
      durationMs: 0,
      durationSeconds: 0,
      explicit: false,
      playCount: 0,
    }
    return (
      <div className="recent-item">
        <TrackRow track={track} index={index} />
        <span className="recent-item__time">{formatTimestamp(item.at)}</span>
      </div>
    )
  }
  const target =
    item.kind === 'album'
      ? `/albums/${item.id}`
      : item.kind === 'artist'
        ? `/artists/${item.id}`
        : `/playlists/${item.id}`
  return (
    <Link className="recent-media-row" to={target}>
      <img
        src={item.image || artwork(item.title || 'echo-item', 120)}
        alt=""
        referrerPolicy="no-referrer"
        onError={(e) => {
          const fallback = artwork(item.title || 'echo-item', 120)
          if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback
        }}
      />
      <span>
        <strong>{item.title}</strong>
        <small>{item.subtitle}</small>
      </span>
      <span className="recent-item__time">{formatTimestamp(item.at)}</span>
    </Link>
  )
}

export function RecentlyPlayedPage() {
  const recentItems = useEchoStore((state) => state.recentItems)
  const setToast = useEchoStore((state) => state.setToast)
  const playTrack = useEchoStore((state) => state.playTrack)

  const [viewMode, setViewMode] = useState<'history' | 'sessions'>('history')
  const [historyItems, setHistoryItems] = useState<HistoryRecord[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [dateRange, setDateRange] = useState<HistoryFilterOptions['dateRange']>('all')
  const [sourceFilter, setSourceFilter] = useState<HistoryFilterOptions['source']>('all')

  const albumsInHistory = recentItems.filter((item) => item.kind === 'album')
  const artistsInHistory = recentItems.filter((item) => item.kind === 'artist')
  const playlistHistory = recentItems.filter((item) => item.kind === 'playlist')

  const loadHistory = async () => {
    setIsLoading(true)
    try {
      const res = await queryListeningHistory({
        query: searchQuery,
        dateRange,
        source: sourceFilter,
        limit: 100,
      })
      setHistoryItems(res.items)
      setTotalCount(res.total)
    } catch {
      // Fallback
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadHistory()
  }, [searchQuery, dateRange, sourceFilter])

  const handleDeleteItem = async (id: number | undefined) => {
    if (typeof id !== 'number') return
    const success = await deleteHistoryRecord(id)
    if (success) {
      setToast('History item removed')
      void loadHistory()
    }
  }

  const handleClearAll = async () => {
    if (!window.confirm('Are you sure you want to clear your entire listening history?')) {
      return
    }
    await clearAllListeningHistory()
    setToast('Listening history cleared')
    void loadHistory()
  }

  const handleExportJson = async () => {
    const jsonStr = await exportHistoryJson()
    downloadFile(jsonStr, 'echo_listening_history.json', 'application/json')
    setToast('Listening history exported as JSON')
  }

  const handleExportCsv = async () => {
    const csvStr = await exportHistoryCsv()
    downloadFile(csvStr, 'echo_listening_history.csv', 'text/csv')
    setToast('Listening history exported as CSV')
  }

  const handlePlayHistoryItem = (item: HistoryRecord) => {
    playTrack({
      id: item.trackId,
      videoId: item.trackId,
      title: item.trackTitle,
      artistName: item.artistName,
      artistId: item.artistId || `yt_${item.artistName}`,
      albumTitle: item.albumTitle || item.trackTitle,
      albumId: `album_${item.trackId}`,
      albumImage: item.artwork || artwork(item.trackTitle, 300),
      artwork: item.artwork || artwork(item.trackTitle, 300),
      durationMs: item.trackDurationMs || 180000,
      durationSeconds: Math.round((item.trackDurationMs || 180000) / 1000),
      explicit: false,
      playCount: 1,
    })
  }

  const getSourceBadgeColor = (source?: string) => {
    switch (source) {
      case 'youtube':
        return 'bg-red-500/20 text-red-300 border-red-500/30'
      case 'local':
        return 'bg-blue-500/20 text-blue-300 border-blue-500/30'
      case 'spotify':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
      case 'cloud':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/30'
      case 'podcast':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/30'
      default:
        return 'bg-white/10 text-white/70 border-white/10'
    }
  }

  return (
    <div className="page">
      <PageHeading
        title="Recently played"
        description="Your complete listening history, device attribution, and playback sessions."
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportJson}
              className="button button--secondary text-xs flex items-center gap-1.5"
              title="Export history as JSON"
            >
              <DownloadCloud size={14} /> JSON
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="button button--secondary text-xs flex items-center gap-1.5"
              title="Export history as CSV"
            >
              <FileText size={14} /> CSV
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="button button--secondary text-xs flex items-center gap-1.5 text-red-300 hover:text-red-400"
              title="Clear all listening history"
            >
              <Trash2 size={14} /> Clear
            </button>
          </div>
        }
      />

      {/* Sub-view toggle */}
      <div className="library-toolbar mb-4">
        <div className="filter-pills" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'history'}
            className={classNames('filter-pill', viewMode === 'history' && 'is-active')}
            onClick={() => setViewMode('history')}
          >
            History Log ({totalCount})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'sessions'}
            className={classNames('filter-pill', viewMode === 'sessions' && 'is-active')}
            onClick={() => setViewMode('sessions')}
          >
            Visited Sessions ({recentItems.length})
          </button>
        </div>
      </div>

      {viewMode === 'history' ? (
        <section className="page-section">
          {/* Controls: Date Ranges & Sources & Search */}
          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-white/6 bg-white/3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-[#a59fad] mr-1 flex items-center gap-1">
                <Calendar size={13} /> Time:
              </span>
              {(['all', 'today', 'last_7_days', 'last_30_days'] as const).map((range) => (
                <button
                  key={range}
                  type="button"
                  onClick={() => setDateRange(range)}
                  className={classNames(
                    'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                    dateRange === range
                      ? 'bg-[#7c5cff] text-white'
                      : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white',
                  )}
                >
                  {range === 'all'
                    ? 'All Time'
                    : range === 'today'
                      ? 'Today'
                      : range === 'last_7_days'
                        ? '7 Days'
                        : '30 Days'}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={sourceFilter}
                onChange={(e) =>
                  setSourceFilter(e.target.value as HistoryFilterOptions['source'])
                }
                className="rounded-lg border border-white/10 bg-black/40 px-2.5 py-1 text-xs text-white"
                aria-label="Filter history by source"
              >
                <option value="all">All Sources</option>
                <option value="youtube">YouTube Music</option>
                <option value="local">Local Files</option>
                <option value="spotify">Spotify</option>
                <option value="cloud">Cloud Media</option>
                <option value="podcast">Podcasts</option>
              </select>

              <input
                type="text"
                placeholder="Search history..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-1 text-xs text-white placeholder-white/40 focus:border-[#7c5cff] focus:outline-none"
              />
            </div>
          </div>

          {/* History Records List */}
          {isLoading ? (
            <div className="py-12 text-center text-xs text-white/40">Loading history...</div>
          ) : historyItems.length > 0 ? (
            <div className="divide-y divide-white/6 rounded-xl border border-white/6 bg-white/3">
              {historyItems.map((item) => (
                <div
                  key={item.id || `${item.trackId}-${item.playedAt}`}
                  className="group flex items-center justify-between gap-3 p-3 transition-colors hover:bg-white/5"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handlePlayHistoryItem(item)}
                      className="relative aspect-square w-11 flex-shrink-0 overflow-hidden rounded-md bg-white/5"
                    >
                      <img
                        src={item.artwork || artwork(item.trackTitle, 100)}
                        alt={item.trackTitle}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        onError={(e) => {
                          const fallback = artwork(item.trackTitle || 'track', 100)
                          if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback
                        }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                        <Play size={16} fill="white" className="text-white ml-0.5" />
                      </div>
                    </button>

                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-xs font-semibold text-white">
                        {item.trackTitle}
                      </h4>
                      <p className="truncate text-[11px] text-[#a59fad]">
                        {item.artistName}
                        {item.albumTitle ? ` · ${item.albumTitle}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    {/* Source badge */}
                    <span
                      className={classNames(
                        'rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize',
                        getSourceBadgeColor(item.source),
                      )}
                    >
                      {item.source || 'youtube'}
                    </span>

                    {/* Device attribution */}
                    {item.deviceName && (
                      <span className="hidden items-center gap-1 text-[10px] text-white/40 md:flex">
                        <Laptop size={11} />
                        {item.deviceName}
                      </span>
                    )}

                    {/* Timestamp */}
                    <span className="text-[11px] text-[#a59fad] min-w-[70px] text-right">
                      {formatTimestamp(item.playedAt)}
                    </span>

                    {/* Delete button */}
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(item.id)}
                      className="rounded-lg p-1.5 text-white/40 opacity-0 transition-opacity hover:bg-white/10 hover:text-red-400 group-hover:opacity-100"
                      title="Delete from history"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Clock3 size={28} />
              <h3>No history found</h3>
              <p>No listening records matched your search or filters.</p>
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="page-section">
            <SectionHeading
              title="Recent activity"
              action={
                <span className="section-note">
                  <Clock3 size={14} /> Most recent first
                </span>
              }
            />
            <div className="recent-list">
              {recentItems.map((item, index) => (
                <RecentlyPlayedRow key={`${item.kind}:${item.id}`} item={item} index={index} />
              ))}
            </div>
          </section>
          {albumsInHistory.length > 0 && (
            <section className="page-section">
              <SectionHeading title="Albums you returned to" />
              <div className="media-grid">
                {albumsInHistory.map((item) => (
                  <MediaCard
                    key={item.id}
                    kind="album"
                    item={{
                      id: item.id,
                      title: item.title,
                      artistName: item.subtitle,
                      artistId: `artist-${item.id}`,
                      image: item.image,
                      thumbnailUrl: item.image,
                      type: 'album',
                    }}
                  />
                ))}
              </div>
            </section>
          )}
          {artistsInHistory.length > 0 && (
            <section className="page-section">
              <SectionHeading title="Artists you visited" />
              <div className="media-grid media-grid--artists">
                {artistsInHistory.map((item) => (
                  <MediaCard
                    key={item.id}
                    kind="artist"
                    item={{
                      id: item.id,
                      name: item.title,
                      image: item.image,
                      thumbnailUrl: item.image,
                    }}
                  />
                ))}
              </div>
            </section>
          )}
          {playlistHistory.length > 0 && (
            <section className="page-section">
              <SectionHeading title="Playlists you opened" />
              <div className="recent-list">
                {playlistHistory.map((item, index) => (
                  <RecentlyPlayedRow key={`${item.kind}:${item.id}`} item={item} index={index} />
                ))}
              </div>
            </section>
          )}
          {recentItems.length === 0 && (
            <div className="empty-state">
              <Clock3 size={28} />
              <h3>Your recent listens will find their way here</h3>
              <p>Play a track or visit an album to get started.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function QueuePage() {
  const {
    currentTrack,
    isPlaying,
    upNext,
    sourceUpcoming,
    history,
    moveQueueItem,
    removeFromQueue,
    removeSourceQueueItem,
    moveSourceQueueItem,
    clearQueue,
    clearEntireQueue,
    play,
    addToQueue,
  } = useAudioEngine()

  const [confirmClear, setConfirmClear] = useState(false)
  const [clearMode, setClearMode] = useState<'upNext' | 'all'>('upNext')
  const [showHistory, setShowHistory] = useState(false)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [dragListType, setDragListType] = useState<'upNext' | 'source'>('upNext')

  const totalUpcoming = upNext.length + sourceUpcoming.length

  const handleDragStart = (e: React.DragEvent, index: number, listType: 'upNext' | 'source') => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', `${listType}:${index}`)
    setDraggingIndex(index)
    setDragListType(listType)
  }

  const handleDragOver = (e: React.DragEvent, index: number, listType: 'upNext' | 'source') => {
    e.preventDefault()
    if (dragListType === listType && draggingIndex !== index) {
      setDragOverIndex(index)
    }
  }

  const handleDrop = (e: React.DragEvent, targetIndex: number, targetType: 'upNext' | 'source') => {
    e.preventDefault()
    if (draggingIndex !== null && dragListType === targetType && draggingIndex !== targetIndex) {
      if (targetType === 'upNext') {
        moveQueueItem(draggingIndex, targetIndex)
      } else {
        moveSourceQueueItem(draggingIndex, targetIndex)
      }
    }
    setDraggingIndex(null)
    setDragOverIndex(null)
  }

  const handleDragEnd = () => {
    setDraggingIndex(null)
    setDragOverIndex(null)
  }

  return (
    <div className="page">
      <PageHeading
        title="Your queue"
        description="See what is playing now, what is queued next, and the remaining context from your listening session."
        action={
          totalUpcoming > 0 ? (
            <div className="flex items-center gap-2">
              {history.length > 0 && (
                <button
                  className="button button--quiet text-xs"
                  type="button"
                  onClick={() => setShowHistory((s) => !s)}
                  aria-pressed={showHistory}
                >
                  <Clock3 size={14} />{' '}
                  {showHistory ? 'Hide history' : `History (${history.length})`}
                </button>
              )}
              <button
                className="text-button queue-clear"
                type="button"
                onClick={() => {
                  setClearMode(upNext.length > 0 ? 'upNext' : 'all')
                  setConfirmClear(true)
                }}
              >
                <Trash2 size={15} /> Clear queue
              </button>
            </div>
          ) : history.length > 0 ? (
            <button
              className="button button--quiet text-xs"
              type="button"
              onClick={() => setShowHistory((s) => !s)}
              aria-pressed={showHistory}
            >
              <Clock3 size={14} /> {showHistory ? 'Hide history' : `History (${history.length})`}
            </button>
          ) : undefined
        }
      />

      {currentTrack?.isPodcast && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-[#7c5cff]/30 bg-[#7c5cff]/10 p-3.5 text-sm text-[#f4f1f7]">
          <Radio size={20} className="text-[#7c5cff] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white">Podcast Episode Queue Active</p>
            <p className="text-xs text-[#a59fad]">
              Spoken audio episodes are strictly segregated from music radio continuation to ensure uninterrupted listening.
            </p>
          </div>
        </div>
      )}

      <section className="page-section">
        <SectionHeading title="Now playing" />
        {currentTrack ? (
          <div className="now-playing-card">
            <img
              src={
                currentTrack.artwork ||
                currentTrack.albumImage ||
                artwork(currentTrack.title || 'echo-track', 160)
              }
              alt=""
              referrerPolicy="no-referrer"
              onError={(e) => {
                const fallback = artwork(currentTrack.title || 'echo-track', 160)
                if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback
              }}
            />
            <span>
              <strong>{currentTrack.title}</strong>
              <small>{currentTrack.artistName}</small>
            </span>
            <span className="now-playing-card__label" aria-live="polite">
              {isPlaying ? (
                <span className="playing-bars" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <Pause size={13} aria-hidden="true" />
              )}
              {isPlaying ? 'Playing' : 'Paused'}
            </span>
          </div>
        ) : (
          <p className="inline-empty">Choose a track to start listening.</p>
        )}
      </section>

      {/* Up Next: User-queued tracks */}
      {upNext.length > 0 && (
        <section className="page-section">
          <SectionHeading
            title="Up Next (queued by you)"
            action={
              <span className="section-note">
                <ListMusic size={14} /> {upNext.length} tracks
              </span>
            }
          />
          <div className="queue-list" role="list">
            {upNext.map((track, index) => {
              const isDragTarget = dragOverIndex === index && dragListType === 'upNext'
              return (
                <div
                  className={`queue-row ${isDragTarget ? 'ring-1 ring-[#7c5cff]' : ''}`}
                  key={`${track.id}-upnext-${index}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index, 'upNext')}
                  onDragOver={(e) => handleDragOver(e, index, 'upNext')}
                  onDrop={(e) => handleDrop(e, index, 'upNext')}
                  onDragEnd={handleDragEnd}
                >
                  <button
                    className="icon-button queue-row__drag cursor-grab active:cursor-grabbing"
                    type="button"
                    aria-label={`Drag to reorder ${track.title}. Or press to move up.`}
                    disabled={index === 0}
                    onClick={() => moveQueueItem(index, index - 1)}
                  >
                    <GripVertical size={17} />
                  </button>
                  <button
                    className="queue-row__play"
                    type="button"
                    aria-label={`Play ${track.title}`}
                    onClick={() => play(track)}
                  >
                    <img
                      src={
                        track.artwork ||
                        track.albumImage ||
                        artwork(track.title || 'echo-track', 80)
                      }
                      alt=""
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        const fallback = artwork(track.title || 'echo-track', 80)
                        if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback
                      }}
                    />
                    <span className="queue-row__meta">
                      <strong>{track.title}</strong>
                      <small>{track.artistName}</small>
                    </span>
                  </button>
                  <span className="queue-row__duration">
                    {formatDuration(track.durationMs || (track.durationSeconds || 0) * 1000)}
                  </span>
                  <div className="queue-row__actions">
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Move ${track.title} down`}
                      disabled={index === upNext.length - 1}
                      onClick={() => moveQueueItem(index, index + 1)}
                    >
                      <ArrowDownUp size={16} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Remove ${track.title} from queue`}
                      onClick={() => removeFromQueue(index)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Next From Context: Album / Playlist context */}
      {sourceUpcoming.length > 0 && (
        <section className="page-section">
          <SectionHeading
            title="Next in this collection"
            action={
              <span className="section-note">
                <ListMusic size={14} /> {sourceUpcoming.length} upcoming
              </span>
            }
          />
          <div className="queue-list" role="list">
            {sourceUpcoming.map((track, index) => {
              const isDragTarget = dragOverIndex === index && dragListType === 'source'
              return (
                <div
                  className={`queue-row ${isDragTarget ? 'ring-1 ring-[#7c5cff]' : ''}`}
                  key={`${track.id}-source-${index}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index, 'source')}
                  onDragOver={(e) => handleDragOver(e, index, 'source')}
                  onDrop={(e) => handleDrop(e, index, 'source')}
                  onDragEnd={handleDragEnd}
                >
                  <button
                    className="icon-button queue-row__drag cursor-grab active:cursor-grabbing"
                    type="button"
                    aria-label={`Move ${track.title} up`}
                    disabled={index === 0}
                    onClick={() => moveSourceQueueItem(index, index - 1)}
                  >
                    <GripVertical size={17} />
                  </button>
                  <button
                    className="queue-row__play"
                    type="button"
                    aria-label={`Play ${track.title}`}
                    onClick={() => play(track)}
                  >
                    <img
                      src={
                        track.artwork ||
                        track.albumImage ||
                        artwork(track.title || 'echo-track', 80)
                      }
                      alt=""
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        const fallback = artwork(track.title || 'echo-track', 80)
                        if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback
                      }}
                    />
                    <span className="queue-row__meta">
                      <strong>{track.title}</strong>
                      <small>{track.artistName}</small>
                    </span>
                  </button>
                  <span className="queue-row__duration">
                    {formatDuration(track.durationMs || (track.durationSeconds || 0) * 1000)}
                  </span>
                  <div className="queue-row__actions">
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Move ${track.title} down`}
                      disabled={index === sourceUpcoming.length - 1}
                      onClick={() => moveSourceQueueItem(index, index + 1)}
                    >
                      <ArrowDownUp size={16} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Remove ${track.title} from upcoming queue`}
                      onClick={() => removeSourceQueueItem(index)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* History section if opened */}
      {showHistory && history.length > 0 && (
        <section className="page-section">
          <SectionHeading
            title="Session history"
            action={
              <span className="section-note">
                <Clock3 size={14} /> {history.length} played
              </span>
            }
          />
          <div className="queue-list" role="list">
            {[...history].reverse().map((track, index) => (
              <div
                className="queue-row opacity-80 hover:opacity-100"
                key={`${track.id}-hist-${index}`}
              >
                <div className="flex w-8 justify-center text-xs text-[#a59fad]">
                  {history.length - index}
                </div>
                <button
                  className="queue-row__play"
                  type="button"
                  aria-label={`Replay ${track.title}`}
                  onClick={() => play(track)}
                >
                  <img
                    src={
                      track.artwork || track.albumImage || artwork(track.title || 'echo-track', 80)
                    }
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                  <span className="queue-row__meta">
                    <strong>{track.title}</strong>
                    <small>{track.artistName}</small>
                  </span>
                </button>
                <span className="queue-row__duration">
                  {formatDuration(track.durationMs || (track.durationSeconds || 0) * 1000)}
                </span>
                <div className="queue-row__actions">
                  <button
                    className="button button--quiet text-xs"
                    type="button"
                    aria-label={`Add ${track.title} back to Up Next`}
                    onClick={() => addToQueue(track)}
                  >
                    Play next
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Empty State when no upcoming tracks */}
      {totalUpcoming === 0 && (
        <div className="empty-state">
          <ListMusic size={27} />
          <h3>Your queue is clear</h3>
          <p>Play an album, search for songs, or use track menus to add music next.</p>
          <Link className="button button--quiet" to="/discover">
            Discover music
          </Link>
        </div>
      )}

      <ClearQueueDialog
        open={confirmClear}
        hasSourceUpcoming={sourceUpcoming.length > 0}
        hasUpNext={upNext.length > 0}
        mode={clearMode}
        onSetMode={setClearMode}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          if (clearMode === 'upNext') {
            clearQueue()
          } else {
            clearEntireQueue()
          }
          setConfirmClear(false)
        }}
      />
    </div>
  )
}

function ClearQueueDialog({
  open,
  hasSourceUpcoming,
  hasUpNext,
  mode,
  onSetMode,
  onCancel,
  onConfirm,
}: {
  open: boolean
  hasSourceUpcoming: boolean
  hasUpNext: boolean
  mode: 'upNext' | 'all'
  onSetMode: (m: 'upNext' | 'all') => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const close = () => onCancel()
    dialog.addEventListener('close', close)
    return () => dialog.removeEventListener('close', close)
  }, [onCancel])
  return (
    <dialog className="dialog dialog--small" ref={dialogRef} aria-labelledby="clear-queue-title">
      <div className="dialog__form">
        <h2 id="clear-queue-title">Clear the queue?</h2>
        <p className="dialog__copy">
          Choose what you want to clear. Your currently playing track will stay in place.
        </p>

        {hasSourceUpcoming && hasUpNext && (
          <div className="my-2 flex flex-col gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-[#dcd7e5]">
              <input
                type="radio"
                name="clearMode"
                value="upNext"
                checked={mode === 'upNext'}
                onChange={() => onSetMode('upNext')}
              />
              <span>Clear user-queued songs only (Up Next)</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-[#dcd7e5]">
              <input
                type="radio"
                name="clearMode"
                value="all"
                checked={mode === 'all'}
                onChange={() => onSetMode('all')}
              />
              <span>Clear entire upcoming queue (including playlist/album tracks)</span>
            </label>
          </div>
        )}

        <div className="dialog__actions">
          <button type="button" className="button button--quiet" onClick={onCancel}>
            Keep queue
          </button>
          <button type="button" className="button button--danger" onClick={onConfirm}>
            <Trash2 size={15} /> Clear queue
          </button>
        </div>
      </div>
    </dialog>
  )
}
