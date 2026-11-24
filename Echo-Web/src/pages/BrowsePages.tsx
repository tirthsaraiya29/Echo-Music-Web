import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  Clock3,
  DownloadCloud,
  Headphones,
  Heart,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Search as SearchIcon,
  X,
  Sparkles,
  FileUp,
  Music2,
  Compass,
  Smartphone,
  FolderPlus,
  RefreshCw,
  EyeOff,
  Disc3,
} from 'lucide-react'
import { syncLikedAlbumsWithCloud } from '../services/sync/likedAlbumsSyncService.ts'
import { useLatestRelease } from '../hooks/useLatestRelease.ts'
import type { Track } from '../types/domain.ts'
import {
  useCharts,
  useHomeFeed,
  useMoodsAndGenres,
  useTrending,
  useThemedHomeShelves,
  THEMED_HOME_CATEGORIES,
} from '../hooks/useHomeFeed.ts'
import {
  useSearch,
  useSearchSuggestions,
  getStoredRecentSearches,
  saveRecentSearch,
  removeRecentSearch,
  clearAllRecentSearches,
} from '../hooks/useSearch.ts'
import type { SearchFilterKey } from '../services/innertube/client.ts'
import { getCachedTrack, useEchoStore } from '../stores/useEchoStore.ts'
import { classNames } from '../utils/classNames.ts'
import { artwork } from '../utils/artwork.ts'
import { formatDuration } from '../utils/format.ts'
import {
  CreatePlaylistDialog,
  MediaCard,
  PageHeading,
  SectionHeading,
  TrackList,
} from '../components/MusicUI.tsx'
import {
  getQuickPicks,
  getForgottenFavorites,
  getHeavyRotation,
  getTopArtists,
  generateTastePlaylist,
  getCurrentTimeOfDay,
  getDailyTasteMix,
  type TasteMix,
} from '../services/recommendations/localTasteEngine.ts'
import {
  resolveMissingTrack,
  getAllPodcastProgress,
  dismissPodcastProgress,
  type PodcastProgressRecord,
} from '../services/db/echoDatabase.ts'
import { parseM3UPlaylist, parseCSVPlaylist } from '../services/sharing/playlistPortability.ts'
import { LocalMusicSection } from '../components/library/LocalMusicSection.tsx'
import { SpotifyImportModal } from '../components/modals/SpotifyImportModal.tsx'
import { SpotifyLibraryTab } from '../components/spotify/SpotifyLibraryTab.tsx'
import { InnerTubeClient } from '../services/innertube/client.ts'
import { RankedChartList } from '../components/charts/RankedChartList.tsx'
import {
  SUPPORTED_CHART_REGIONS,
  CHART_CATEGORIES,
  fetchRegionalChart,
  type ChartGroup,
  type ChartCategory,
} from '../services/charts/chartService.ts'
import {
  MOOD_DEFINITIONS,
  GENRE_DEFINITIONS,
} from '../services/recommendations/moodGenreService.ts'

export function HomePage() {
  const release = useLatestRelease()
  const { data: themedShelves, isLoading, isError, error, refetch } = useThemedHomeShelves()
  const [activeCategory, setActiveCategory] = useState<
    'all' | 'bollywood' | 'hollywood' | 'romance' | 'soothing'
  >('all')
  const currentTrack = useEchoStore((state) => state.currentTrack)
  const playing = useEchoStore((state) => state.isPlaying)
  const togglePlayback = useEchoStore((state) => state.togglePlayback)
  const playTrack = useEchoStore((state) => state.playTrack)
  const playQueue = useEchoStore((state) => state.playQueue)
  const playlists = useEchoStore((state) => state.playlists)
  const likedTrackIds = useEchoStore((state) => state.likedTrackIds)
  const recentItems = useEchoStore((state) => state.recentItems)
  const createPlaylist = useEchoStore((state) => state.createPlaylist)
  const addTrackToPlaylist = useEchoStore((state) => state.addTrackToPlaylist)
  const setToast = useEchoStore((state) => state.setToast)

  const [quickPicks, setQuickPicks] = useState<Track[]>([])
  const [forgottenFavs, setForgottenFavs] = useState<Track[]>([])
  const [heavyRotation, setHeavyRotation] = useState<Track[]>([])
  const [topArtists, setTopArtists] = useState<
    Array<{ id: string; name: string; count: number; artwork?: string | undefined }>
  >([])
  const [isGeneratingMix, setIsGeneratingMix] = useState(false)
  const [dailyTasteMix, setDailyTasteMix] = useState<TasteMix | null>(null)
  const [isLoadingTasteMix, setIsLoadingTasteMix] = useState(false)

  const timeOfDay = getCurrentTimeOfDay()
  const greeting =
    timeOfDay === 'morning'
      ? 'Good morning'
      : timeOfDay === 'afternoon'
        ? 'Good afternoon'
        : timeOfDay === 'evening'
          ? 'Good evening'
          : 'Late night listening'

  useEffect(() => {
    let cancelled = false
    Promise.all([
      getQuickPicks(likedTrackIds, 8),
      getForgottenFavorites(likedTrackIds, 8),
      getHeavyRotation(likedTrackIds, 8),
      getTopArtists(6),
    ])
      .then(([qp, ff, hr, ta]) => {
        if (!cancelled) {
          setQuickPicks(qp)
          setForgottenFavs(ff)
          setHeavyRotation(hr)
          setTopArtists(ta)
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [likedTrackIds, recentItems.length])

  useEffect(() => {
    let cancelled = false
    setIsLoadingTasteMix(true)
    getDailyTasteMix({
      catalogFallback: quickPicks,
      likedTrackIds,
    })
      .then((mix) => {
        if (!cancelled) {
          setDailyTasteMix(mix)
        }
      })
      .catch((err) => {
        console.warn('[TasteMix] Failed to load daily mix', err)
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingTasteMix(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [likedTrackIds, quickPicks.length])

  const handlePlayTasteMix = () => {
    if (!dailyTasteMix || dailyTasteMix.tracks.length === 0) return
    playQueue(dailyTasteMix.tracks, 0)
    setToast(`Playing ${dailyTasteMix.title}`)
  }

  const handleSaveTasteMix = () => {
    if (!dailyTasteMix || dailyTasteMix.tracks.length === 0) return
    const plId = createPlaylist(dailyTasteMix.title, dailyTasteMix.subtitle)
    for (const t of dailyTasteMix.tracks) {
      addTrackToPlaylist(plId, t)
    }
    setToast(`Saved "${dailyTasteMix.title}" to library`)
  }

  const handleRefreshTasteMix = async () => {
    setIsLoadingTasteMix(true)
    try {
      const refreshed = await getDailyTasteMix({
        forceRefresh: true,
        catalogFallback: quickPicks,
        likedTrackIds,
      })
      setDailyTasteMix(refreshed)
      setToast('Refreshed your Daily Taste Mix')
    } catch {
      setToast('Could not refresh Daily Taste Mix')
    } finally {
      setIsLoadingTasteMix(false)
    }
  }

  const handleGenerateTasteMix = async () => {
    if (dailyTasteMix && dailyTasteMix.tracks.length > 0) {
      handlePlayTasteMix()
      return
    }
    setIsGeneratingMix(true)
    try {
      const catalogTracks = quickPicks
      const mix = await generateTastePlaylist(likedTrackIds, catalogTracks)
      const plId = createPlaylist(mix.title, mix.description)
      for (const t of mix.tracks) {
        addTrackToPlaylist(plId, t)
      }
      setToast(`Created "${mix.title}" with ${mix.tracks.length} songs`)
    } catch {
      setToast('Could not generate taste playlist')
    } finally {
      setIsGeneratingMix(false)
    }
  }

  const isBrandNewUser =
    likedTrackIds.length === 0 &&
    playlists.length === 0 &&
    recentItems.length === 0 &&
    quickPicks.length === 0

  const heroTrack = currentTrack || quickPicks[0]
  const visibleShelves =
    activeCategory === 'all' ? themedShelves : themedShelves?.filter((s) => s.id === activeCategory)

  return (
    <div className="page page--home">
      <header className="page-heading mb-4">
        <div>
          <h1>{greeting}</h1>
          <p className="text-xs text-[#a59fad]">
            Your listening instrument. Tracks stay in local memory, ready when you are.
          </p>
        </div>
        <a
          href={release.apkUrl}
          className="button button--quiet download-app-btn"
          download
          rel="noopener noreferrer"
          title={`Download Echo Music Android APK (${release.version})`}
        >
          <Smartphone size={15} className="text-[#ed5564]" />
          <span>Download Mobile App</span>
        </a>
      </header>

      {/* Category Filter Pills */}
      <div className="filter-pills mb-6" role="tablist" aria-label="Music categories">
        <button
          type="button"
          role="tab"
          aria-selected={activeCategory === 'all'}
          className={classNames('filter-pill', activeCategory === 'all' && 'is-active')}
          onClick={() => setActiveCategory('all')}
        >
          All
        </button>
        {THEMED_HOME_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            role="tab"
            aria-selected={activeCategory === cat.id}
            className={classNames('filter-pill', activeCategory === cat.id && 'is-active')}
            onClick={() => setActiveCategory(cat.id)}
          >
            {cat.id === 'bollywood'
              ? 'Bollywood'
              : cat.id === 'hollywood'
                ? 'Hollywood'
                : cat.id === 'romance'
                  ? 'Romance'
                  : 'Soothing'}
          </button>
        ))}
      </div>

      {/* Hero Track Card */}
      {heroTrack && (
        <section className="home-now" aria-labelledby="home-now-title">
          <img
            className="home-now__art"
            src={
              heroTrack.artwork ||
              heroTrack.thumbnailUrl ||
              artwork(heroTrack.title || 'echo-track', 480)
            }
            alt={`${heroTrack.title} artwork`}
            width={480}
            height={480}
            fetchPriority="high"
            referrerPolicy="no-referrer"
            onError={(e) => {
              const fallback = artwork(heroTrack.title || 'echo-track', 480)
              if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback
            }}
          />
          <div className="home-now__copy">
            <p className="home-now__state">
              {currentTrack ? 'In your player' : 'Recommended pick'}
            </p>
            <h1 id="home-now-title">{heroTrack.title}</h1>
            <div className="home-now__links">
              <Link to={`/artists/${heroTrack.artistId}`}>{heroTrack.artistName}</Link>
              {heroTrack.albumTitle && (
                <Link to={`/albums/${heroTrack.albumId}`}>{heroTrack.albumTitle}</Link>
              )}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                className="button button--primary home-now__play"
                type="button"
                aria-label={
                  currentTrack && playing ? `Pause ${heroTrack.title}` : `Play ${heroTrack.title}`
                }
                onClick={() => {
                  if (currentTrack && currentTrack.id === heroTrack.id) {
                    togglePlayback()
                  } else {
                    playTrack(heroTrack)
                  }
                }}
              >
                {currentTrack && playing ? (
                  <Pause size={17} fill="currentColor" />
                ) : (
                  <Play size={17} fill="currentColor" />
                )}
                {currentTrack && playing ? 'Pause' : 'Play'}
              </button>

              <button
                type="button"
                onClick={handleGenerateTasteMix}
                disabled={isGeneratingMix}
                className="flex items-center gap-1.5 rounded-xl bg-white/6 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10"
                title="Generate Taste Mix playlist"
              >
                <Sparkles size={14} className="text-[#b09cff]" />
                <span>{isGeneratingMix ? 'Generating...' : 'Taste Mix'}</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* New User Onboarding Discovery */}
      {isBrandNewUser && (
        <section className="page-section rounded-2xl border border-white/10 bg-white/4 p-6">
          <div className="mb-2 flex items-center gap-3 text-[#b09cff]">
            <Compass size={22} />
            <h2 className="text-base font-semibold text-white">Welcome to Echo</h2>
          </div>
          <p className="mb-4 max-w-xl text-xs text-[#a59fad]">
            Echo learns what you like entirely on this device, without tracking accounts. Start
            listening to any track, search for your favorite artists, or import playlists from
            Spotify.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/discover" className="button button--primary text-xs">
              <Compass size={14} /> Explore Charts & Genres
            </Link>
            <Link to="/search" className="button button--quiet text-xs">
              <SearchIcon size={14} /> Search Music
            </Link>
          </div>
        </section>
      )}

      {/* Daily Taste Mix */}
      {dailyTasteMix && dailyTasteMix.tracks.length > 0 && (
        <section className="page-section" aria-labelledby="daily-taste-mix-heading">
          <div className="rounded-2xl border border-white/10 bg-gradient-to-r from-purple-950/40 via-indigo-950/30 to-black/60 p-5 backdrop-blur-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#b09cff] to-[#7052ff] text-white shadow-lg shadow-purple-500/20">
                  <Sparkles size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-[#b09cff]/20 px-2 py-0.5 text-[10px] font-bold tracking-wider text-[#b09cff] uppercase">
                      Daily Mix
                    </span>
                    <span className="text-xs text-white/50">{dailyTasteMix.dateKey}</span>
                  </div>
                  <h2 id="daily-taste-mix-heading" className="text-base sm:text-lg font-bold text-white mt-1">
                    {dailyTasteMix.title}
                  </h2>
                  <p className="text-xs text-white/70 max-w-xl mt-0.5">
                    {dailyTasteMix.subtitle}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handlePlayTasteMix}
                  className="flex items-center gap-2 rounded-xl bg-[#b09cff] px-4 py-2 text-xs font-bold text-black transition-all hover:bg-[#c2b2ff] active:scale-95 min-h-[44px]"
                  aria-label={`Play ${dailyTasteMix.title}`}
                >
                  <Play size={15} fill="currentColor" />
                  <span>Play Mix ({dailyTasteMix.tracks.length})</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveTasteMix}
                  className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10 min-h-[44px]"
                  title="Save mix to your library"
                  aria-label="Save mix to playlists"
                >
                  <FolderPlus size={14} />
                  <span>Save</span>
                </button>

                <button
                  type="button"
                  onClick={handleRefreshTasteMix}
                  disabled={isLoadingTasteMix}
                  className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10 min-h-[44px] disabled:opacity-50"
                  title="Refresh mix for today"
                  aria-label="Refresh daily taste mix"
                >
                  <RefreshCw size={14} className={isLoadingTasteMix ? 'animate-spin' : ''} />
                  <span>{isLoadingTasteMix ? 'Refreshing...' : 'Refresh'}</span>
                </button>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-white/10">
              <TrackList items={dailyTasteMix.tracks.slice(0, 5)} />
            </div>
          </div>
        </section>
      )}

      {/* Jump Back In: Recently Played */}
      {recentItems.length > 0 && (
        <section className="page-section">
          <SectionHeading title="Jump back in" to="/recently-played" />
          <div className="media-grid">
            {recentItems.slice(0, 6).map((item) => {
              const cardItem =
                item.kind === 'artist'
                  ? { id: item.id, name: item.title, image: item.image, thumbnailUrl: item.image }
                  : item.kind === 'album'
                    ? {
                        id: item.id,
                        title: item.title,
                        artistName: item.subtitle,
                        image: item.image,
                        thumbnailUrl: item.image,
                        type: 'album' as const,
                      }
                    : item.kind === 'playlist'
                      ? { id: item.id, title: item.title, image: item.image }
                      : {
                          id: item.id,
                          title: item.title,
                          artistName: item.subtitle,
                          artistId: `artist-${item.id}`,
                          albumId: `album-${item.id}`,
                          albumTitle: 'Single',
                          albumImage: item.image,
                          artwork: item.image,
                          thumbnailUrl: item.image,
                          durationMs: 0,
                          durationSeconds: 0,
                          explicit: false,
                          playCount: 0,
                        }
              return <MediaCard key={`${item.kind}:${item.id}`} kind={item.kind} item={cardItem} />
            })}
          </div>
        </section>
      )}

      {/* Heavy Rotation */}
      {heavyRotation.length > 0 && (
        <section className="page-section">
          <SectionHeading title="Your Heavy Rotation" />
          <TrackList items={heavyRotation} />
        </section>
      )}

      {/* Quick Picks */}
      {quickPicks.length > 0 && (
        <section className="page-section">
          <SectionHeading title="Quick Picks" />
          <TrackList items={quickPicks} />
        </section>
      )}

      {/* Top Artists Visited */}
      {topArtists.length > 0 && (
        <section className="page-section">
          <SectionHeading title="Your Favourite Artists" />
          <div className="media-grid media-grid--artists">
            {topArtists.map((artist) => (
              <MediaCard
                key={artist.id}
                kind="artist"
                item={{
                  id: artist.id,
                  name: artist.name,
                  image: artist.artwork || '',
                  thumbnailUrl: artist.artwork || '',
                }}
              />
            ))}
          </div>
        </section>
      )}

      {/* Forgotten Favorites */}
      {forgottenFavs.length > 0 && (
        <section className="page-section">
          <SectionHeading title="Forgotten Favorites" />
          <TrackList items={forgottenFavs} />
        </section>
      )}

      {/* User Playlists */}
      {playlists.length > 0 && (
        <section className="page-section">
          <SectionHeading title="Your playlists" to="/library" />
          <div className="quick-grid">
            {playlists.slice(0, 4).map((playlist) => (
              <Link className="quick-card" key={playlist.id} to={`/playlists/${playlist.id}`}>
                {playlist.image && (
                  <img
                    src={playlist.image}
                    alt=""
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      const fallback = artwork(playlist.title || 'echo-playlist', 80)
                      if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback
                    }}
                  />
                )}
                <span>{playlist.title}</span>
                <span className="quick-card__arrow">
                  <ArrowRight size={16} />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Remote Catalog Shelves Section */}
      {isLoading && (
        <div className="my-6" aria-busy="true" aria-label="Loading catalog shelves">
          <div className="skeleton-section">
            <div className="skeleton-title" />
            <div className="skeleton-grid">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton-card" />
              ))}
            </div>
          </div>
        </div>
      )}

      {isError && (
        <div className="my-4 rounded-xl border border-white/10 bg-white/4 p-5" role="alert">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Online catalog is unavailable</h3>
              <p className="mt-1 text-xs text-[#a59fad]">
                {error?.message ||
                  'Check your network connection. Your local music, history, and playlists remain active.'}
              </p>
            </div>
            <button
              className="button button--quiet text-xs"
              type="button"
              onClick={() => refetch()}
            >
              <RotateCcw size={14} /> Retry
            </button>
          </div>
        </div>
      )}

      {/* Themed Playlist Shelves (Bollywood, Hollywood, Romance, Soothing) */}
      {visibleShelves?.map((shelf) => (
        <section className="page-section" key={shelf.id}>
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">{shelf.title}</h2>
              <p className="mt-0.5 text-xs text-[#a59fad]">{shelf.subtitle}</p>
            </div>
            {activeCategory === 'all' ? (
              <button
                type="button"
                className="text-xs font-medium text-[#b09cff] transition-colors hover:text-white"
                onClick={() => setActiveCategory(shelf.id)}
              >
                View all
              </button>
            ) : (
              <button
                type="button"
                className="text-xs font-medium text-[#b09cff] transition-colors hover:text-white"
                onClick={() => setActiveCategory('all')}
              >
                Show all categories
              </button>
            )}
          </div>
          <div className="media-grid">
            {shelf.items.map((item) => (
              <MediaCard key={item.id} kind="playlist" item={item} />
            ))}
          </div>
        </section>
      ))}

      {!isLoading && !isError && (!visibleShelves || visibleShelves.length === 0) && (
        <div className="empty-state py-8 text-center text-xs text-[#a59fad]" role="status">
          <Compass className="mx-auto mb-2 text-[#b09cff]" size={28} />
          <p>No discovery shelves available for this category right now.</p>
          <button
            type="button"
            onClick={() => setActiveCategory('all')}
            className="mt-2 text-[#b09cff] underline"
          >
            Show all categories
          </button>
        </div>
      )}
    </div>
  )
}

export function DiscoverPage() {
  const [activeTab, setActiveTab] = useState<'curated' | 'charts' | 'moods' | 'trending'>('curated')
  const contentRegion = useEchoStore((state) => state.preferences.contentRegion)
  const [selectedRegion, setSelectedRegion] = useState(contentRegion || 'GLOBAL')
  const [selectedChartCategory, setSelectedChartCategory] = useState<ChartCategory>('top-songs')
  const [regionalChart, setRegionalChart] = useState<ChartGroup | null>(null)
  const [isLoadingChart, setIsLoadingChart] = useState(false)
  const [chartError, setChartError] = useState<string | null>(null)

  const curated = useHomeFeed()
  const charts = useCharts(selectedRegion === 'GLOBAL' ? 'US' : selectedRegion)
  const moods = useMoodsAndGenres()
  const trending = useTrending()

  useEffect(() => {
    if (activeTab !== 'charts') return
    let cancelled = false
    setIsLoadingChart(true)
    setChartError(null)

    fetchRegionalChart(selectedRegion, selectedChartCategory)
      .then((group) => {
        if (!cancelled) setRegionalChart(group)
      })
      .catch((err) => {
        if (!cancelled) setChartError(err instanceof Error ? err.message : 'Failed to load chart')
      })
      .finally(() => {
        if (!cancelled) setIsLoadingChart(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeTab, selectedRegion, selectedChartCategory])

  const currentQuery =
    activeTab === 'charts'
      ? charts
      : activeTab === 'moods'
        ? moods
        : activeTab === 'trending'
          ? trending
          : curated

  const { data: shelves, isLoading, isError, error, refetch } = currentQuery

  const discoverTabs = [
    { id: 'curated' as const, label: 'Curated' },
    { id: 'charts' as const, label: 'Top Charts' },
    { id: 'moods' as const, label: 'Moods & Genres' },
    { id: 'trending' as const, label: 'Trending' },
  ]

  return (
    <div className="page">
      <PageHeading
        title="Discover"
        description="Explore curated sets, seasonal arrivals, charts, and deep catalog selections."
      />

      <div className="filter-pills mb-6" role="tablist" aria-label="Discover catalog views">
        {discoverTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={classNames('filter-pill', activeTab === tab.id && 'is-active')}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Charts Controls: Categories & Regional Selector */}
      {activeTab === 'charts' && (
        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/3 p-3.5">
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Chart category filters">
            {CHART_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={selectedChartCategory === cat.id}
                className={classNames(
                  'rounded-lg px-3 py-1.5 text-xs font-semibold transition-all min-h-[36px]',
                  selectedChartCategory === cat.id
                    ? 'bg-[#b09cff] text-black shadow-md shadow-purple-500/20'
                    : 'bg-white/5 text-white/80 hover:bg-white/10 hover:text-white',
                )}
                onClick={() => setSelectedChartCategory(cat.id)}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="chart-region-select" className="text-xs text-[#a59fad] whitespace-nowrap">
              Region:
            </label>
            <select
              id="chart-region-select"
              className="rounded-lg border border-white/15 bg-black/40 px-3 py-1.5 text-xs font-semibold text-white focus:border-[#b09cff] focus:outline-none min-h-[36px]"
              value={selectedRegion}
              onChange={(e) => setSelectedRegion(e.target.value)}
              aria-label="Select chart region"
            >
              {SUPPORTED_CHART_REGIONS.map((region) => (
                <option key={region.code} value={region.code} className="bg-[#181324] text-white">
                  {region.flag} {region.name} ({region.code})
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Charts View */}
      {activeTab === 'charts' ? (
        <>
          {isLoadingChart && (
            <div className="space-y-2" aria-busy="true" aria-label="Loading regional chart">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-14 w-full animate-pulse rounded-xl bg-white/5" />
              ))}
            </div>
          )}

          {chartError && !isLoadingChart && (
            <div className="error-banner" role="alert">
              <h2>Could not load regional chart</h2>
              <p>{chartError}</p>
              <button
                className="button button--primary"
                type="button"
                onClick={() => {
                  setIsLoadingChart(true)
                  fetchRegionalChart(selectedRegion, selectedChartCategory)
                    .then(setRegionalChart)
                    .catch((err) => setChartError(err.message))
                    .finally(() => setIsLoadingChart(false))
                }}
              >
                <RotateCcw size={16} /> Retry
              </button>
            </div>
          )}

          {!isLoadingChart && !chartError && regionalChart && (
            <RankedChartList chart={regionalChart} />
          )}

          {!isLoadingChart && !chartError && (!regionalChart || regionalChart.items.length === 0) && (
            <div className="empty-state">
              <p>No ranking entries found for this region and category.</p>
            </div>
          )}
        </>
      ) : (
        /* Curated, Moods, Trending Shelves */
        <>
          {activeTab === 'moods' && (
            <div className="space-y-6 mb-8" aria-label="Moods and Genres Catalog">
              <div>
                <h2 className="text-base font-bold text-white mb-3">Moods & Moments</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {MOOD_DEFINITIONS.map((mood) => (
                    <Link
                      key={mood.id}
                      to={`/moods/${mood.id}`}
                      className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br ${mood.gradient} p-4 transition-all hover:scale-[1.02] hover:shadow-lg hover:border-white/20 min-h-[110px]`}
                      aria-label={`Browse ${mood.title} mood`}
                    >
                      <span className="text-3xl select-none" aria-hidden="true">
                        {mood.icon}
                      </span>
                      <div>
                        <h3 className="text-sm font-bold text-white group-hover:text-white/90">
                          {mood.title}
                        </h3>
                        <p className="text-[11px] text-white/70 line-clamp-1">{mood.description}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              <div>
                <h2 className="text-base font-bold text-white mb-3">Genres</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {GENRE_DEFINITIONS.map((genre) => (
                    <Link
                      key={genre.id}
                      to={`/genre/${genre.id}`}
                      className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br ${genre.gradient} p-4 transition-all hover:scale-[1.02] hover:shadow-lg hover:border-white/20 min-h-[110px]`}
                      aria-label={`Browse ${genre.title} genre`}
                    >
                      <span className="text-3xl select-none" aria-hidden="true">
                        {genre.icon}
                      </span>
                      <div>
                        <h3 className="text-sm font-bold text-white group-hover:text-white/90">
                          {genre.title}
                        </h3>
                        <p className="text-[11px] text-white/70 line-clamp-1">
                          {genre.description}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="skeleton-grid" aria-busy="true" aria-label={`Loading ${activeTab}`}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="skeleton-card" />
              ))}
            </div>
          )}

          {isError && (
            <div className="error-banner" role="alert">
              <h2>Could not load catalog</h2>
              <p>{error?.message || 'Check your internet connection or proxy server status.'}</p>
              <button className="button button--primary" type="button" onClick={() => refetch()}>
                <RotateCcw size={16} /> Retry
              </button>
            </div>
          )}

          {!isLoading &&
            !isError &&
            shelves &&
            shelves.length > 0 &&
            shelves.map((shelf, shelfIndex) => (
              <section className="page-section" key={`${shelf.title}-${shelfIndex}`}>
                <SectionHeading title={shelf.title} />
                <div className="media-grid">
                  {shelf.items.map((item) => (
                    <MediaCard
                      key={item.id}
                      kind={
                        'durationSeconds' in item
                          ? 'track'
                          : 'trackCount' in item
                            ? 'album'
                            : 'playlist'
                      }
                      item={item}
                    />
                  ))}
                </div>
              </section>
            ))}

          {!isLoading && !isError && (!shelves || shelves.length === 0) && (
            <div className="empty-state">
              <p>No catalog shelves found for this view.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const searchCategories: Array<{ id: SearchFilterKey; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'songs', label: 'Songs' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'videos', label: 'Videos' },
  { id: 'podcasts', label: 'Podcasts' },
]

export function SearchPage() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<SearchFilterKey>('all')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const [spotifyModalOpen, setSpotifyModalOpen] = useState(false)
  const [recentSearches, setRecentSearches] = useState<string[]>(() => getStoredRecentSearches())

  const { data: searchResults, isLoading, isError, error } = useSearch(query, category)
  const { data: suggestions = [] } = useSearchSuggestions(query)
  const playTrack = useEchoStore((state) => state.playTrack)
  const setToast = useEchoStore((state) => state.setToast)
  const preferences = useEchoStore((state) => state.preferences)
  const isShortsFiltered = preferences.hideYoutubeShorts ?? preferences.filterShorts ?? true
  const isVideoFiltered = preferences.hideVideoSongs === true || preferences.dataSaver === true

  const handleSelectSearch = (term: string) => {
    setQuery(term)
    setShowSuggestions(false)
    const updated = saveRecentSearch(term)
    setRecentSearches(updated)
  }

  const hasQuery = query.trim().length > 0
  const tracks = searchResults?.tracks || []
  const albums = searchResults?.albums || []
  const artists = searchResults?.artists || []
  const playlists = searchResults?.playlists || []

  const totalResults = tracks.length + albums.length + artists.length + playlists.length

  // Omni-link detection
  const isYouTubeUrl =
    query.includes('youtube.com/watch') ||
    query.includes('youtu.be/') ||
    query.includes('music.youtube.com/watch')

  const detectedVideoId = isYouTubeUrl
    ? query.match(/[?&]v=([a-zA-Z0-9_-]{11})/)?.[1] ||
      query.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/)?.[1]
    : null

  const detectedPlaylistMatch = query.match(/[?&]list=([a-zA-Z0-9_-]+)/)?.[1]
  const detectedPlaylistId = detectedPlaylistMatch
    ? detectedPlaylistMatch.startsWith('VL')
      ? detectedPlaylistMatch
      : `VL${detectedPlaylistMatch}`
    : null

  const detectedChannelId =
    query.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/)?.[1] ||
    query.match(/music\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/)?.[1] ||
    null

  const isSpotifyLink = query.includes('spotify.com')

  const handlePlayDirectVideo = () => {
    if (!detectedVideoId) return
    const directTrack: Track = {
      id: detectedVideoId,
      videoId: detectedVideoId,
      title: 'YouTube Direct Audio Stream',
      artistName: 'Echo Link Resolution',
      artistId: `artist_${detectedVideoId}`,
      albumId: `album_${detectedVideoId}`,
      albumTitle: 'Direct Audio',
      albumImage: `https://i.ytimg.com/vi/${detectedVideoId}/hqdefault.jpg`,
      artwork: `https://i.ytimg.com/vi/${detectedVideoId}/hqdefault.jpg`,
      thumbnailUrl: `https://i.ytimg.com/vi/${detectedVideoId}/hqdefault.jpg`,
      durationMs: 240000,
      durationSeconds: 240,
      explicit: false,
      playCount: 1,
    }
    playTrack(directTrack)
    setToast('Resolving and playing direct YouTube stream')
  }

  return (
    <div className="page">
      <PageHeading
        title="Search"
        description="Search millions of songs, albums, artists, or paste any YouTube or Spotify link."
      />

      <div className="search-field" style={{ position: 'relative' }}>
        <SearchIcon size={20} />
        <input
          id="global-search"
          type="search"
          autoComplete="off"
          placeholder="Search catalog or paste YouTube / Spotify URL..."
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveSuggestion(-1)
            setShowSuggestions(true)
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => window.setTimeout(() => setShowSuggestions(false), 120)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setQuery('')
              setActiveSuggestion(-1)
              setShowSuggestions(false)
            } else if (event.key === 'ArrowDown' && suggestions.length > 0) {
              event.preventDefault()
              setActiveSuggestion((index) => (index + 1) % suggestions.length)
            } else if (event.key === 'ArrowUp' && suggestions.length > 0) {
              event.preventDefault()
              setActiveSuggestion((index) => (index <= 0 ? suggestions.length - 1 : index - 1))
            } else if (event.key === 'Enter') {
              if (activeSuggestion >= 0 && suggestions[activeSuggestion]) {
                event.preventDefault()
                handleSelectSearch(suggestions[activeSuggestion]!)
              } else if (query.trim()) {
                handleSelectSearch(query.trim())
              }
            }
          }}
          aria-expanded={showSuggestions && suggestions.length > 0}
          aria-haspopup="listbox"
          aria-activedescendant={
            activeSuggestion >= 0 ? `search-suggestion-${activeSuggestion}` : undefined
          }
          role="combobox"
          aria-controls="search-suggestions-list"
        />
        {query && (
          <button
            className="icon-button"
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery('')
              setShowSuggestions(false)
            }}
          >
            <X size={18} />
          </button>
        )}
        <kbd>ESC</kbd>

        {showSuggestions && suggestions.length > 0 && (
          <div
            className="search-suggestions-dropdown"
            role="listbox"
            id="search-suggestions-list"
            aria-label="Search suggestions"
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: '0.375rem',
              background: 'var(--color-surface, #181524)',
              border: '1px solid var(--color-border, #2d2642)',
              borderRadius: '0.75rem',
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
              zIndex: 50,
              overflow: 'hidden',
            }}
          >
            {suggestions.map((sugg, index) => (
              <button
                key={sugg}
                type="button"
                id={`search-suggestion-${index}`}
                className="suggestion-item"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  width: '100%',
                  padding: '0.75rem 1rem',
                  border: 'none',
                  background:
                    index === activeSuggestion
                      ? 'var(--color-hover, rgba(255,255,255,0.08))'
                      : 'transparent',
                  color: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: '0.9375rem',
                }}
                aria-selected={index === activeSuggestion}
                onMouseEnter={() => setActiveSuggestion(index)}
                onClick={() => {
                  handleSelectSearch(sugg)
                  setActiveSuggestion(-1)
                }}
              >
                <SearchIcon size={15} opacity={0.6} />
                <span>{sugg}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Direct Link Detection Banner */}
      {detectedVideoId && (
        <div className="my-2 flex items-center justify-between gap-4 rounded-xl border border-[#7c5cff]/30 bg-[#7c5cff]/15 p-4">
          <div className="flex items-center gap-3">
            <img
              src={`https://i.ytimg.com/vi/${detectedVideoId}/hqdefault.jpg`}
              alt=""
              className="h-12 w-12 rounded-lg object-cover"
            />
            <div>
              <span className="block text-xs font-semibold text-white">YouTube Link Detected</span>
              <span className="font-mono text-[11px] text-[#b09cff]">
                Video ID: {detectedVideoId}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handlePlayDirectVideo}
            className="flex items-center gap-1.5 rounded-xl bg-[#7c5cff] px-4 py-2 text-xs font-semibold text-black shadow-md transition-colors hover:bg-[#6c48ff]"
          >
            <Play size={14} fill="currentColor" />
            <span>Play Now</span>
          </button>
        </div>
      )}

      {detectedPlaylistId && (
        <div className="my-2 flex items-center justify-between gap-4 rounded-xl border border-[#7c5cff]/30 bg-[#7c5cff]/15 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-[#7c5cff]/20 p-2.5 text-[#7c5cff]">
              <Music2 size={20} />
            </div>
            <div>
              <span className="block text-xs font-semibold text-white">
                YouTube Playlist Link Detected
              </span>
              <span className="font-mono text-[11px] text-[#b09cff]">
                Playlist ID: {detectedPlaylistId}
              </span>
            </div>
          </div>
          <Link
            to={`/playlists/${detectedPlaylistId}`}
            className="flex items-center gap-1.5 rounded-xl bg-[#7c5cff] px-4 py-2 text-xs font-semibold text-black shadow-md transition-colors hover:bg-[#6c48ff]"
          >
            <span>Open Playlist</span>
          </Link>
        </div>
      )}

      {detectedChannelId && (
        <div className="my-2 flex items-center justify-between gap-4 rounded-xl border border-[#7c5cff]/30 bg-[#7c5cff]/15 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-[#7c5cff]/20 p-2.5 text-[#7c5cff]">
              <Music2 size={20} />
            </div>
            <div>
              <span className="block text-xs font-semibold text-white">
                YouTube Artist Link Detected
              </span>
              <span className="font-mono text-[11px] text-[#b09cff]">
                Channel ID: {detectedChannelId}
              </span>
            </div>
          </div>
          <Link
            to={`/artists/${detectedChannelId}`}
            className="flex items-center gap-1.5 rounded-xl bg-[#7c5cff] px-4 py-2 text-xs font-semibold text-black shadow-md transition-colors hover:bg-[#6c48ff]"
          >
            <span>View Artist</span>
          </Link>
        </div>
      )}

      {isSpotifyLink && (
        <div className="my-2 flex items-center justify-between gap-4 rounded-xl border border-[#58ad83]/30 bg-[#58ad83]/15 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-[#58ad83]/20 p-2.5 text-[#58ad83]">
              <Music2 size={20} />
            </div>
            <div>
              <span className="block text-xs font-semibold text-white">Spotify Link Detected</span>
              <span className="text-[11px] text-[#a59fad]">
                Import playlist directly into your Echo library
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSpotifyModalOpen(true)}
            className="flex items-center gap-1.5 rounded-xl bg-[#58ad83] px-4 py-2 text-xs font-semibold text-black shadow-md transition-colors hover:bg-[#489972]"
          >
            <DownloadCloud size={14} />
            <span>Import with Echo</span>
          </button>
        </div>
      )}

      {hasQuery && (
        <div className="filter-pills" role="tablist" aria-label="Filter search results">
          {searchCategories.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={category === item.id}
              className={classNames('filter-pill', category === item.id && 'is-active')}
              onClick={() => {
                setCategory(item.id)
                setShowSuggestions(false)
              }}
            >
              {item.label}
            </button>
          ))}
          {isShortsFiltered && (
            <span
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-[#a59fad]"
              title="YouTube Shorts are excluded per Content settings"
            >
              <EyeOff size={12} />
              <span>Shorts hidden</span>
            </span>
          )}
          {isVideoFiltered && (
            <span
              className={classNames(
                'inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-[#a59fad]',
                !isShortsFiltered && 'ml-auto',
              )}
              title="Video songs are excluded per Content settings"
            >
              <EyeOff size={12} />
              <span>Videos hidden</span>
            </span>
          )}
        </div>
      )}

      {isLoading && hasQuery && (
        <div className="route-loading" role="status">
          <span className="route-loading__mark" />
          <span>Searching live catalog...</span>
        </div>
      )}

      {isError && hasQuery && (
        <div className="error-banner" role="alert">
          <h2>Search request failed</h2>
          <p>{error?.message || 'Check your internet connection or proxy server status.'}</p>
        </div>
      )}

      {!isLoading && hasQuery && totalResults === 0 && !isError && (
        <div className="search-empty">
          <SearchIcon size={25} />
          <h2>No matches found for “{query}”</h2>
          <p>Try searching for a different song, artist, or album title.</p>
        </div>
      )}

      {!hasQuery && (
        <div className="search-start">
          {recentSearches.length > 0 && (
            <section className="page-section mb-6">
              <SectionHeading
                title="Recent searches"
                action={
                  <button
                    type="button"
                    className="button button--quiet text-xs"
                    onClick={() => {
                      clearAllRecentSearches()
                      setRecentSearches([])
                    }}
                  >
                    Clear all
                  </button>
                }
              />
              <div className="flex flex-wrap gap-2">
                {recentSearches.map((term) => (
                  <div
                    key={term}
                    className="flex items-center gap-1 rounded-full bg-white/6 px-3 py-1.5 text-xs text-white transition-colors hover:bg-white/10"
                  >
                    <button
                      type="button"
                      className="cursor-pointer text-left hover:underline"
                      onClick={() => handleSelectSearch(term)}
                    >
                      <Clock3 size={13} className="mr-1.5 inline text-[#a59fad]" />
                      <span>{term}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${term} from recent searches`}
                      className="ml-1 cursor-pointer rounded-full p-0.5 text-[#a59fad] hover:text-white"
                      onClick={(e) => {
                        e.stopPropagation()
                        const updated = removeRecentSearch(term)
                        setRecentSearches(updated)
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="page-section">
            <SectionHeading title="Suggested searches" />
            <div className="search-suggestions">
              {['Radiohead', 'Billie Eilish', 'Kendrick Lamar', 'Daft Punk', 'Fleetwood Mac'].map(
                (suggestion) => (
                  <button
                    key={suggestion}
                    className="suggestion-chip"
                    type="button"
                    onClick={() => handleSelectSearch(suggestion)}
                  >
                    {suggestion}
                  </button>
                ),
              )}
            </div>
          </section>
        </div>
      )}

      {!isLoading && hasQuery && totalResults > 0 && (
        <>
          {tracks.length > 0 && (category === 'all' || category === 'songs') && (
            <section className="page-section">
              <SectionHeading
                title="Songs"
                action={
                  category === 'all' && tracks.length > 4 ? (
                    <button
                      className="button-link"
                      type="button"
                      onClick={() => setCategory('songs')}
                    >
                      See all {tracks.length}
                    </button>
                  ) : undefined
                }
              />
              <TrackList items={category === 'all' ? tracks.slice(0, 4) : tracks} />
            </section>
          )}

          {albums.length > 0 && (category === 'all' || category === 'albums') && (
            <section className="page-section">
              <SectionHeading
                title="Albums"
                action={
                  category === 'all' && albums.length > 4 ? (
                    <button
                      className="button-link"
                      type="button"
                      onClick={() => setCategory('albums')}
                    >
                      See all {albums.length}
                    </button>
                  ) : undefined
                }
              />
              <div className="media-grid">
                {(category === 'all' ? albums.slice(0, 4) : albums).map((album) => (
                  <MediaCard key={album.id} kind="album" item={album} />
                ))}
              </div>
            </section>
          )}

          {artists.length > 0 && (category === 'all' || category === 'artists') && (
            <section className="page-section">
              <SectionHeading
                title="Artists"
                action={
                  category === 'all' && artists.length > 4 ? (
                    <button
                      className="button-link"
                      type="button"
                      onClick={() => setCategory('artists')}
                    >
                      See all {artists.length}
                    </button>
                  ) : undefined
                }
              />
              <div className="media-grid">
                {(category === 'all' ? artists.slice(0, 4) : artists).map((artist) => (
                  <MediaCard key={artist.id} kind="artist" item={artist} />
                ))}
              </div>
            </section>
          )}

          {playlists.length > 0 && (category === 'all' || category === 'playlists') && (
            <section className="page-section">
              <SectionHeading
                title="Playlists"
                action={
                  category === 'all' && playlists.length > 4 ? (
                    <button
                      className="button-link"
                      type="button"
                      onClick={() => setCategory('playlists')}
                    >
                      See all {playlists.length}
                    </button>
                  ) : undefined
                }
              />
              <div className="media-grid">
                {(category === 'all' ? playlists.slice(0, 4) : playlists).map((playlist) => (
                  <MediaCard key={playlist.id} kind="playlist" item={playlist} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <SpotifyImportModal isOpen={spotifyModalOpen} onClose={() => setSpotifyModalOpen(false)} />
    </div>
  )
}

const libraryTabs = ['All', 'Playlists', 'Albums', 'Liked', 'Spotify', 'Local Music', 'Podcasts'] as const
type LibraryTab = (typeof libraryTabs)[number]

export function LibraryPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')?.toLowerCase()
  const tab = libraryTabs.find((item) => item.toLowerCase() === requestedTab) ?? 'All'
  const preferences = useEchoStore((state) => state.preferences)
  const setPreference = useEchoStore((state) => state.setPreference)
  const [layout, setLayout] = useState<'grid' | 'list'>(preferences.lastPlayedLayout)
  const [filter, setFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [spotifyModalOpen, setSpotifyModalOpen] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const playlists = useEchoStore((state) => state.playlists)
  const likedTrackIds = useEchoStore((state) => state.likedTrackIds)
  const likedAlbums = useEchoStore((state) => state.likedAlbums || [])
  const toggleAlbumLike = useEchoStore((state) => state.toggleAlbumLike)
  const [isSyncingAlbums, setIsSyncingAlbums] = useState(false)
  const trackCache = useEchoStore((state) => state.trackCache)
  const cacheTrack = useEchoStore((state) => state.cacheTrack)
  const createPlaylist = useEchoStore((state) => state.createPlaylist)
  const addTrackToPlaylist = useEchoStore((state) => state.addTrackToPlaylist)
  const setToast = useEchoStore((state) => state.setToast)
  const followedPodcasts = useEchoStore((state) => state.followedPodcasts)
  const unfollowPodcast = useEchoStore((state) => state.unfollowPodcast)
  const currentTrack = useEchoStore((state) => state.currentTrack)
  const isPlaying = useEchoStore((state) => state.isPlaying)
  const playTrack = useEchoStore((state) => state.playTrack)
  const togglePlayback = useEchoStore((state) => state.togglePlayback)
  const [inProgressPodcasts, setInProgressPodcasts] = useState<PodcastProgressRecord[]>([])

  useEffect(() => {
    if (tab !== 'Podcasts' && tab !== 'All') return
    let cancelled = false
    getAllPodcastProgress(false)
      .then((records) => {
        if (!cancelled) setInProgressPodcasts(records)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [tab, currentTrack?.id])

  // Resolve any liked tracks missing from memory/cache
  useEffect(() => {
    if (tab !== 'All' && tab !== 'Liked') return
    const missing = likedTrackIds.filter((id) => !trackCache[id] && !getCachedTrack(id))
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
  }, [tab, likedTrackIds, trackCache, cacheTrack])

  const selectTab = (nextTab: LibraryTab) => {
    const nextParams = new URLSearchParams(searchParams)
    if (nextTab === 'All') nextParams.delete('tab')
    else nextParams.set('tab', nextTab.toLowerCase())
    setSearchParams(nextParams)
  }

  const filteredPlaylists = playlists.filter((p) =>
    p.title.toLowerCase().includes(filter.toLowerCase()),
  )
  const filteredAlbums = likedAlbums.filter(
    (a) =>
      a.title.toLowerCase().includes(filter.toLowerCase()) ||
      a.artistName.toLowerCase().includes(filter.toLowerCase()),
  )
  const filteredPodcasts = followedPodcasts.filter(
    (p) =>
      p.title.toLowerCase().includes(filter.toLowerCase()) ||
      p.author.toLowerCase().includes(filter.toLowerCase()),
  )

  const handleSyncAlbums = async () => {
    setIsSyncingAlbums(true)
    try {
      const res = await syncLikedAlbumsWithCloud()
      setToast(res.message)
    } catch {
      setToast('Failed to sync liked albums with cloud')
    } finally {
      setIsSyncingAlbums(false)
    }
  }

  const likedTracks: Track[] = likedTrackIds
    .map((id) => trackCache[id] || getCachedTrack(id))
    .filter((t): t is Track => Boolean(t))

  const handleM3UOrCSVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const content = await file.text()
    let parsedItems: Array<{ title: string; artist: string }> = []
    if (file.name.endsWith('.m3u') || file.name.endsWith('.m3u8')) {
      parsedItems = parseM3UPlaylist(content)
    } else if (file.name.endsWith('.csv')) {
      parsedItems = parseCSVPlaylist(content)
    }

    if (parsedItems.length === 0) {
      setToast('Could not find songs in the uploaded file')
      return
    }

    const plTitle = file.name.replace(/\.[^/.]+$/, '')
    const plId = createPlaylist(plTitle, `Imported from ${file.name}`)
    let resolvedCount = 0

    for (let i = 0; i < Math.min(parsedItems.length, 30); i++) {
      const item = parsedItems[i]!
      try {
        const cat = await InnerTubeClient.search(`${item.title} ${item.artist}`, 'songs')
        if (cat.tracks && cat.tracks[0]) {
          addTrackToPlaylist(plId, cat.tracks[0])
          resolvedCount++
        }
      } catch {
        // Continue
      }
    }

    setToast(`Imported "${plTitle}" (${resolvedCount} tracks matched)`)
    if (e.target) e.target.value = ''
  }

  return (
    <div className="page">
      <PageHeading
        title="Your library"
        description="All your music. Everything you have saved, followed, and scanned."
        action={
          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleM3UOrCSVUpload}
              accept=".m3u,.m3u8,.csv"
              className="hidden"
            />
            <button
              className="button button--secondary"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Import M3U or CSV playlist"
            >
              <FileUp size={16} /> Import File
            </button>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => setSpotifyModalOpen(true)}
              title="Import from Spotify"
            >
              <Music2 size={16} /> Spotify
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={() => setCreateOpen(true)}
            >
              <span className="plus-mark">+</span> New playlist
            </button>
          </div>
        }
      />

      <div className="library-toolbar">
        <div className="filter-pills" role="tablist" aria-label="Library category">
          {libraryTabs.map((item) => (
            <button
              type="button"
              role="tab"
              key={item}
              aria-selected={tab === item}
              className={classNames('filter-pill', tab === item && 'is-active')}
              onClick={() => selectTab(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="library-tools">
          <label className="sr-only" htmlFor="library-filter">
            Filter your library
          </label>
          <input
            id="library-filter"
            className="library-filter"
            placeholder="Filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <div className="layout-toggle" aria-label="Library layout">
            <button
              type="button"
              aria-label="Grid layout"
              aria-pressed={layout === 'grid'}
              onClick={() => {
                setLayout('grid')
                setPreference('lastPlayedLayout', 'grid')
              }}
              className={layout === 'grid' ? 'is-active' : ''}
            >
              Grid
            </button>
            <button
              type="button"
              aria-label="List layout"
              aria-pressed={layout === 'list'}
              onClick={() => {
                setLayout('list')
                setPreference('lastPlayedLayout', 'list')
              }}
              className={layout === 'list' ? 'is-active' : ''}
            >
              List
            </button>
          </div>
        </div>
      </div>

      {/* Tab: Local Music */}
      {tab === 'Local Music' && (
        <section className="page-section">
          <LocalMusicSection />
        </section>
      )}

      {(tab === 'All' || tab === 'Playlists') && (
        <section className="page-section">
          {tab === 'All' && <SectionHeading title="Playlists" />}
          <div
            className={classNames(
              'library-collections',
              layout === 'list' && 'library-collections--list',
            )}
          >
            {filteredPlaylists.map((item) => (
              <MediaCard
                key={item.id}
                kind="playlist"
                item={item}
                subtitle={`${item.trackIds.length} tracks · ${item.owner}`}
              />
            ))}
            <button
              className="library-create-card"
              type="button"
              onClick={() => setCreateOpen(true)}
            >
              <span>
                <span className="plus-mark">+</span>
              </span>
              <strong>Create a playlist</strong>
              <small>Put a few favorites together.</small>
            </button>
          </div>
        </section>
      )}

      {/* Tab: Albums */}
      {tab === 'Albums' && (
        <section className="page-section">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Liked Albums ({filteredAlbums.length})</h2>
            <button
              type="button"
              onClick={handleSyncAlbums}
              disabled={isSyncingAlbums}
              className="button button--secondary flex items-center gap-1.5 text-xs"
              title="Sync liked albums with YouTube Music"
            >
              <RefreshCw size={14} className={isSyncingAlbums ? 'animate-spin' : ''} />
              {isSyncingAlbums ? 'Syncing...' : 'Sync Cloud'}
            </button>
          </div>
          {filteredAlbums.length > 0 ? (
            <div
              className={classNames(
                'library-collections',
                layout === 'list' && 'library-collections--list',
              )}
            >
              {filteredAlbums.map((album) => (
                <div key={album.id} className="media-card group relative">
                  <Link to={`/albums/${album.id}`} className="block">
                    <div className="media-card__artwork aspect-square overflow-hidden rounded-md bg-white/5">
                      <img
                        src={album.coverUrl || artwork(album.title, 300)}
                        alt={album.title}
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                        loading="lazy"
                        onError={(e) => {
                          const fallback = artwork(album.title || 'album', 300)
                          if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback
                        }}
                      />
                    </div>
                    <div className="media-card__info mt-2">
                      <h4 className="truncate text-sm font-medium text-white">{album.title}</h4>
                      <p className="truncate text-xs text-white/60">
                        {album.artistName}{album.year ? ` · ${album.year}` : ''}
                      </p>
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      toggleAlbumLike(album.id)
                      setToast(`Removed "${album.title}" from library`)
                    }}
                    className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-red-400 opacity-0 transition-opacity hover:scale-110 group-hover:opacity-100"
                    title="Remove from library"
                  >
                    <Heart size={16} fill="currentColor" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Disc3 size={27} />
              <h3>No liked albums yet</h3>
              <p>Like albums while browsing to keep them saved in your library.</p>
            </div>
          )}
        </section>
      )}

      {tab === 'All' && likedAlbums.length > 0 && (
        <section className="page-section">
          <SectionHeading title="Saved albums" to="/library?tab=albums" />
          <div
            className={classNames(
              'library-collections',
              layout === 'list' && 'library-collections--list',
            )}
          >
            {likedAlbums.slice(0, 4).map((album) => (
              <MediaCard
                key={album.id}
                kind="album"
                item={{
                  id: album.id,
                  title: album.title,
                  artistName: album.artistName,
                  artistId: album.artistId || '',
                  image: album.coverUrl || '',
                  year: album.year,
                  trackCount: album.trackCount || 0,
                }}
                subtitle={`${album.artistName}${album.year ? ` · ${album.year}` : ''}`}
              />
            ))}
          </div>
        </section>
      )}

      {(tab === 'All' || tab === 'Liked') && likedTracks.length > 0 && (
        <section className="page-section">
          {tab === 'All' && <SectionHeading title="Liked songs" to="/liked" />}
          <TrackList items={likedTracks} />
        </section>
      )}

      {tab === 'All' && (
        <section className="page-section library-shortcuts">
          <SectionHeading title="Made for you" />
          <div className="shortcut-links">
            <Link to="/liked">
              <span className="shortcut-icon">
                <Heart size={20} />
              </span>
              <span>
                <strong>Liked Songs</strong>
                <small>{likedTrackIds.length} tracks in collection</small>
              </span>
              <ArrowRight size={17} />
            </Link>
            <Link to="/recently-played">
              <span className="shortcut-icon">
                <Clock3 size={20} />
              </span>
              <span>
                <strong>Recently Played</strong>
                <small>Pick up where you left off</small>
              </span>
              <ArrowRight size={17} />
            </Link>
          </div>
        </section>
      )}

      {tab === 'Playlists' && filteredPlaylists.length === 0 && (
        <div className="empty-state">
          <Headphones size={27} />
          <h3>No playlists yet</h3>
          <p>Create your first playlist to begin organizing your music.</p>
        </div>
      )}

      {/* Tab: Followed Podcasts */}
      {(tab === 'All' || tab === 'Podcasts') && inProgressPodcasts.length > 0 && (
        <section className="page-section">
          <SectionHeading title="Continue listening" to="/podcasts" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {inProgressPodcasts.slice(0, 4).map((item) => {
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
                    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white/5">
                      <img
                        src={artwork(item.artworkUrl || '', 128)}
                        alt={item.episodeTitle}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (isCurrent) {
                            togglePlayback()
                          } else {
                            playTrack({
                              id: item.episodeId,
                              videoId: item.episodeId,
                              title: item.episodeTitle,
                              artistId: `podcast_${item.showTitle.toLowerCase().replace(/\s+/g, '_')}`,
                              artistName: item.showTitle,
                              albumId: 'podcasts',
                              albumTitle: item.showTitle,
                              albumImage: item.artworkUrl || '',
                              artwork: item.artworkUrl || '',
                              durationMs: item.durationMs || durSec * 1000,
                              durationSeconds: durSec,
                              explicit: false,
                              playCount: 1,
                              isPodcast: true,
                              podcastShowId: `podcast_${item.showTitle.toLowerCase().replace(/\s+/g, '_')}`,
                              showTitle: item.showTitle,
                            })
                          }
                        }}
                        className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label={itemPlaying ? 'Pause episode' : 'Resume episode'}
                      >
                        {itemPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
                      </button>
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-medium text-[#b09cff]">
                        {item.showTitle}
                      </p>
                      <h3 className="line-clamp-2 text-xs font-semibold text-white/90">
                        {item.episodeTitle}
                      </h3>
                      <p className="mt-1 text-[10px] text-[#a59fad]">
                        {remainingSec > 0 ? `${formatDuration(remainingSec)} left` : 'Completed'}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation()
                        await dismissPodcastProgress(item.episodeId)
                        setInProgressPodcasts((prev) => prev.filter((p) => p.episodeId !== item.episodeId))
                      }}
                      className="text-white/40 hover:text-white"
                      title="Dismiss from history"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="mt-3">
                    <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
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

      {/* Tab: Followed Podcasts */}
      {(tab === 'All' || tab === 'Podcasts') && filteredPodcasts.length > 0 && (
        <section className="page-section">
          {tab === 'All' && <SectionHeading title="Followed podcasts" to="/library?tab=podcasts" />}
          <div
            className={classNames(
              'library-collections',
              layout === 'list' && 'library-collections--list',
            )}
          >
            {filteredPodcasts.map((show) => (
              <div
                key={show.id}
                onClick={() => navigate(`/playlist/${show.browseId || show.id}`)}
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

      {tab === 'Podcasts' && filteredPodcasts.length === 0 && inProgressPodcasts.length === 0 && (
        <div className="empty-state">
          <Radio size={27} />
          <h3>No followed podcasts yet</h3>
          <p>Discover shows and follow them to keep your favorite episodes in one place.</p>
          <Link to="/podcasts" className="button button--primary mt-3">
            Discover Podcasts
          </Link>
        </div>
      )}

      {tab === 'Spotify' && (
        <section className="page-section">
          <SpotifyLibraryTab />
        </section>
      )}

      <CreatePlaylistDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <SpotifyImportModal isOpen={spotifyModalOpen} onClose={() => setSpotifyModalOpen(false)} />
    </div>
  )
}
