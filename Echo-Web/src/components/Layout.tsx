import { Suspense, useEffect, useState } from 'react'
import {
  Album,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Compass,
  Heart,
  Home,
  Library,
  ListMusic,
  Loader2,
  Maximize2,
  Pause,
  Play,
  Plus,
  Repeat,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Radio,
  Mic,
  Moon,
  Speaker,
  Keyboard,
  Music2,
  Sparkles,
} from 'lucide-react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { getCachedTrack, useEchoStore } from '../stores/useEchoStore.ts'
import { useAudioEngine } from '../hooks/useAudioEngine.ts'
import { classNames } from '../utils/classNames.ts'
import { formatDuration } from '../utils/format.ts'
import { artwork } from '../utils/artwork.ts'
import { CreatePlaylistDialog } from './MusicUI.tsx'
import { DesktopPlayerView } from './player/DesktopPlayerView.tsx'
import { EchoMusicLogo } from './EchoMusicLogo.tsx'
import { EchoFindModal } from './modals/EchoFindModal.tsx'
import { ListenTogetherModal } from './modals/ListenTogetherModal.tsx'
import { SpotifyImportModal } from './modals/SpotifyImportModal.tsx'
import { KeyboardShortcutsModal } from './modals/KeyboardShortcutsModal.tsx'
import { SleepTimerPopover } from './player/SleepTimerPopover.tsx'
import { AudioOutputPicker } from './player/AudioOutputPicker.tsx'
import { listenTogether } from '../services/listenTogether/listenTogetherClient.ts'
import { useIsMobileDevice } from '../hooks/useIsMobileDevice.ts'
import { MobileApkLanding } from './MobileApkLanding.tsx'
import { recordLayoutMetric } from './layout/layoutTypes.ts'
import { themeManager } from '../services/theme/themeManager.ts'

const primaryLinks = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/flow', label: 'Music Flow', icon: Sparkles },
  { to: '/podcasts', label: 'Podcasts', icon: Radio },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/library', label: 'Your library', icon: Library },
]

interface SidebarProps {
  onOpenEchoFind: () => void
  onOpenListenTogether: () => void
  onOpenSpotifyImport: () => void
}

function Sidebar({ onOpenEchoFind, onOpenListenTogether, onOpenSpotifyImport }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('echo_sidebar_collapsed')
      return saved ? Boolean(JSON.parse(saved)) : false
    } catch {
      return false
    }
  })
  const [createOpen, setCreateOpen] = useState(false)
  const playlists = useEchoStore((state) => state.playlists)
  const location = useLocation()

  const handleToggleCollapse = () => {
    setCollapsed((value) => {
      const next = !value
      recordLayoutMetric('sidebarToggles')
      try {
        localStorage.setItem('echo_sidebar_collapsed', JSON.stringify(next))
      } catch {
        // ignore storage error
      }
      return next
    })
  }

  return (
    <>
      <aside className={classNames('sidebar', collapsed && 'sidebar--collapsed')}>
        <div className="sidebar__brand-row">
          <Link className="brand" to="/" title="Echo Music Home">
            <span className="brand__symbol">
              <EchoMusicLogo size={18} />
            </span>
            {!collapsed && (
              <span className="brand__text">
                Echo <span className="brand__sub">Music</span>
              </span>
            )}
          </Link>
          <button
            className="icon-button sidebar__collapse min-h-[44px] min-w-[44px]"
            type="button"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            onClick={handleToggleCollapse}
          >
            {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          </button>
        </div>

        <nav className="sidebar__primary" aria-label="Main navigation">
          {primaryLinks.map(({ to, label, icon: Icon, ...rest }) => (
            <NavLink
              key={to}
              to={to}
              end={'end' in rest ? rest.end : false}
              className={({ isActive }) => classNames('nav-link', isActive && 'is-active')}
              title={collapsed ? label : undefined}
            >
              <Icon size={19} strokeWidth={1.9} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__divider" />

        {/* Live Features: Echo Find & Listen Together */}
        <div className="flex flex-col gap-1 px-3 py-1">
          <button
            type="button"
            onClick={onOpenEchoFind}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs font-semibold text-[#a59fad] transition-colors hover:bg-white/4 hover:text-white"
            title={collapsed ? 'Echo Find' : undefined}
          >
            <Mic size={18} className="text-[#b09cff]" />
            {!collapsed && <span>Echo Find</span>}
          </button>

          <button
            type="button"
            onClick={onOpenListenTogether}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs font-semibold text-[#a59fad] transition-colors hover:bg-white/4 hover:text-white"
            title={collapsed ? 'Listen Together' : undefined}
          >
            <Radio size={18} className="text-[#7c5cff]" />
            {!collapsed && <span>Listen Together</span>}
          </button>
        </div>

        <div className="sidebar__divider" />

        <nav className="sidebar__secondary" aria-label="Your collections">
          <NavLink
            to="/liked"
            className={({ isActive }) => classNames('nav-link', isActive && 'is-active')}
            title={collapsed ? 'Liked Songs' : undefined}
          >
            <Heart size={19} />
            <span>Liked Songs</span>
          </NavLink>
          <NavLink
            to="/recently-played"
            className={({ isActive }) => classNames('nav-link', isActive && 'is-active')}
            title={collapsed ? 'Recently Played' : undefined}
          >
            <ListMusic size={19} />
            <span>Recently played</span>
          </NavLink>
          <NavLink
            to="/library?tab=albums"
            className={classNames(
              'nav-link',
              location.pathname === '/library' && location.search.includes('albums') && 'is-active',
            )}
            title={collapsed ? 'Albums' : undefined}
          >
            <Album size={19} />
            <span>Albums</span>
          </NavLink>
        </nav>

        <div className="sidebar__divider" />

        <div className="sidebar__playlist-heading">
          {!collapsed && <span>Your playlists</span>}
          <div className="flex items-center gap-1">
            <button
              className="icon-button"
              type="button"
              title="Import from Spotify"
              aria-label="Import from Spotify"
              onClick={onOpenSpotifyImport}
            >
              <Music2 size={16} />
            </button>
            <button
              className="icon-button"
              type="button"
              title="Create playlist"
              aria-label="Create playlist"
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={18} />
            </button>
          </div>
        </div>

        <nav className="sidebar__playlists" aria-label="Your playlists">
          {playlists.length === 0 ? (
            !collapsed && (
              <div className="px-3 py-2 text-xs text-[#a59fad]/60 italic">
                No playlists created yet
              </div>
            )
          ) : (
            playlists.map((playlist) => (
              <NavLink
                key={playlist.id}
                to={`/playlists/${playlist.id}`}
                className={({ isActive }) => classNames('playlist-nav', isActive && 'is-active')}
                title={collapsed ? playlist.title : undefined}
              >
                <img
                  src={playlist.image || artwork(playlist.title || 'echo-playlist', 80)}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    const fallback = artwork(playlist.title || 'echo-playlist', 80)
                    if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback
                  }}
                />
                <span>{playlist.title}</span>
              </NavLink>
            ))
          )}
        </nav>

        <div className="sidebar__bottom">
          <NavLink
            to="/settings"
            className={({ isActive }) => classNames('nav-link', isActive && 'is-active')}
            title={collapsed ? 'Settings' : undefined}
          >
            <Settings size={19} />
            <span>Settings</span>
          </NavLink>
        </div>
      </aside>
      <CreatePlaylistDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  )
}

function MobileNav() {
  return (
    <nav className="mobile-nav" aria-label="Main navigation">
      {primaryLinks.map(({ to, label, icon: Icon, ...rest }) => (
        <NavLink
          key={to}
          to={to}
          end={'end' in rest ? rest.end : false}
          className={({ isActive }) => classNames('mobile-nav__link', isActive && 'is-active')}
        >
          <Icon size={18} aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

function PlayerBar() {
  const currentTrackId = useEchoStore((state) => state.currentTrackId)
  const storeTrack = useEchoStore((state) => state.currentTrack) || getCachedTrack(currentTrackId)
  const liked = useEchoStore((state) =>
    storeTrack ? state.likedTrackIds.includes(storeTrack.id) : false,
  )
  const toggleLike = useEchoStore((state) => state.toggleTrackLike)
  const preferences = useEchoStore((state) => state.preferences)
  const setPreference = useEchoStore((state) => state.setPreference)

  const {
    currentTrack: engineTrack,
    currentTime,
    duration: engineDuration,
    isPlaying,
    isBuffering,
    togglePlayback,
    next: playNext,
    previous: playPrevious,
    seek: engineSeek,
    getAudioTelemetry,
    sleepTimerRemaining,
    sleepTimerEndOfTrack,
  } = useAudioEngine()

  const currentTrack = engineTrack || storeTrack

  const [expanded, setExpanded] = useState(false)
  const [outputPickerOpen, setOutputPickerOpen] = useState(false)
  const [sleepTimerOpen, setSleepTimerOpen] = useState(false)

  if (!currentTrack) return null
  const volume = preferences.muted ? 0 : preferences.volume
  const progressMs = Math.floor(currentTime * 1000)
  const totalDurationMs =
    (engineDuration > 0 ? engineDuration * 1000 : currentTrack.durationMs) ||
    (currentTrack.durationSeconds ? currentTrack.durationSeconds * 1000 : 180000)
  const progress = Math.min(100, Math.max(0, (progressMs / totalDurationMs) * 100))
  const telemetry = getAudioTelemetry()
  const isSleepActive =
    Boolean(sleepTimerRemaining && sleepTimerRemaining > 0) || Boolean(sleepTimerEndOfTrack)

  const handleSeek = (ms: number) => {
    const clampedMs = Math.max(0, Math.min(totalDurationMs, Number.isFinite(ms) ? ms : 0))
    engineSeek(clampedMs / 1000)
  }

  return (
    <>
      <footer className="player-bar" aria-label="Player controls">
        <div className="player-track">
          <img
            className="player-track__art"
            src={
              currentTrack.artwork ||
              currentTrack.thumbnailUrl ||
              currentTrack.albumImage ||
              artwork(currentTrack.title || 'echo-track', 120)
            }
            alt=""
            referrerPolicy="no-referrer"
            onError={(e) => {
              const fallback =
                currentTrack.thumbnailUrl ||
                currentTrack.albumImage ||
                artwork(currentTrack.title || 'echo-track', 120)
              if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback
            }}
          />
          <div className="player-track__meta">
            <Link to={`/albums/${currentTrack.albumId}`} className="player-track__title">
              {currentTrack.title}
            </Link>
            <Link to={`/artists/${currentTrack.artistId}`} className="player-track__artist">
              {currentTrack.artistName}
            </Link>
          </div>
          <button
            className={classNames('icon-button', 'player-track__like', liked && 'is-liked')}
            type="button"
            aria-label={liked ? 'Unlike current track' : 'Like current track'}
            aria-pressed={liked}
            onClick={() => (currentTrack ? toggleLike(currentTrack) : toggleLike(currentTrackId))}
          >
            <Heart size={17} fill={liked ? 'currentColor' : 'none'} />
          </button>
        </div>

        <div className="player-controls">
          <div className="player-controls__buttons">
            <button
              className={classNames(
                'icon-button',
                'player-secondary',
                preferences.shuffle && 'is-active',
              )}
              type="button"
              aria-label="Toggle shuffle"
              aria-pressed={preferences.shuffle}
              onClick={() => setPreference('shuffle', !preferences.shuffle)}
            >
              <Shuffle size={16} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="Previous track"
              onClick={playPrevious}
            >
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button
              className="play-button"
              type="button"
              aria-label={isBuffering ? 'Buffering' : isPlaying ? 'Pause' : 'Play'}
              aria-busy={isBuffering}
              title={isBuffering ? 'Buffering' : isPlaying ? 'Pause' : 'Play'}
              onClick={togglePlayback}
            >
              {isBuffering ? (
                <Loader2 size={16} className="animate-spin" />
              ) : isPlaying ? (
                <Pause size={16} fill="currentColor" />
              ) : (
                <Play size={16} fill="currentColor" />
              )}
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="Next track"
              onClick={playNext}
            >
              <SkipForward size={18} fill="currentColor" />
            </button>
            <button
              className={classNames(
                'icon-button',
                'player-secondary',
                preferences.repeat !== 'off' && 'is-active',
              )}
              type="button"
              aria-label={`Repeat ${preferences.repeat}`}
              onClick={() =>
                setPreference(
                  'repeat',
                  preferences.repeat === 'off'
                    ? 'all'
                    : preferences.repeat === 'all'
                      ? 'one'
                      : 'off',
                )
              }
            >
              <Repeat size={16} />
            </button>
          </div>
          <div className="player-controls__timeline">
            <span>{formatDuration(progressMs)}</span>
            <input
              aria-label="Track position"
              aria-valuemin={0}
              aria-valuemax={totalDurationMs}
              aria-valuenow={progressMs}
              aria-valuetext={formatDuration(progressMs)}
              type="range"
              min={0}
              max={totalDurationMs}
              value={progressMs}
              style={{ '--range-progress': `${progress}%` } as React.CSSProperties}
              onChange={(event) => handleSeek(Number(event.target.value))}
            />
            <span>{formatDuration(totalDurationMs)}</span>
          </div>
        </div>

        <div className="player-extras">
          {/* Sleep Timer Indicator */}
          <button
            className={`icon-button ${isSleepActive ? 'text-[#7c5cff]' : ''}`}
            type="button"
            title="Sleep Timer"
            onClick={() => setSleepTimerOpen(true)}
          >
            <Moon size={16} />
          </button>

          {/* Audio Output Sink Selector */}
          <button
            className="icon-button device-button"
            type="button"
            aria-label="Audio Output Selector"
            title="Audio Output Device"
            onClick={() => setOutputPickerOpen(true)}
          >
            <Speaker size={17} />
          </button>

          <Link className="icon-button" to="/queue" title="Open queue" aria-label="Open queue">
            <ListMusic size={18} />
          </Link>

          <button
            className="icon-button volume-toggle"
            type="button"
            aria-label={preferences.muted ? 'Unmute' : 'Mute'}
            aria-pressed={preferences.muted}
            onClick={() => setPreference('muted', !preferences.muted)}
          >
            {volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>

          <input
            className="volume-slider"
            type="range"
            aria-label="Volume"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={volume}
            aria-valuetext={`${volume}%`}
            min={0}
            max={100}
            value={volume}
            style={{ '--range-progress': `${volume}%` } as React.CSSProperties}
            onChange={(event) => {
              setPreference('volume', Number(event.target.value))
              setPreference('muted', false)
            }}
          />

          <button
            className="icon-button"
            type="button"
            aria-label="Expand player"
            onClick={() => setExpanded(true)}
          >
            <Maximize2 size={17} />
          </button>
        </div>

        <span className="player-bar__disclaimer">{telemetry.codec}</span>
      </footer>

      <DesktopPlayerView isOpen={expanded} onClose={() => setExpanded(false)} />
      <AudioOutputPicker isOpen={outputPickerOpen} onClose={() => setOutputPickerOpen(false)} />
      <SleepTimerPopover isOpen={sleepTimerOpen} onClose={() => setSleepTimerOpen(false)} />
    </>
  )
}

function Toast() {
  const toast = useEchoStore((state) => state.toast)
  const clearToast = useEchoStore((state) => state.clearToast)
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(clearToast, 2800)
    return () => window.clearTimeout(timer)
  }, [toast, clearToast])
  return toast ? (
    <div className="toast" role="status">
      {toast}
    </div>
  ) : null
}

export default function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const preferences = useEchoStore((state) => state.preferences)
  const likedIds = useEchoStore((state) => state.likedTrackIds)
  const togglePlayback = useEchoStore((state) => state.togglePlayback)

  const [echoFindOpen, setEchoFindOpen] = useState(false)
  const [listenTogetherOpen, setListenTogetherOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return Boolean(new URLSearchParams(window.location.search).get('listen'))
    }
    return false
  })
  const [spotifyImportOpen, setSpotifyImportOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  // Check URL query parameters for ?listen=ROOM_CODE
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const roomCode = params.get('listen')
    if (roomCode) {
      // Strip the param immediately: leaving it in place would re-join the room (and
      // resurrect a dead room code) on every refresh and back-navigation.
      params.delete('listen')
      const rest = params.toString()
      window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''))
      void listenTogether.joinRoom(roomCode).catch(() => {
        useEchoStore.getState().setToast('Could not join that listening room.')
      })
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        navigate('/search')
        window.setTimeout(() => document.getElementById('global-search')?.focus(), 0)
      } else if (event.key === '/' && !typing) {
        event.preventDefault()
        navigate('/search')
        window.setTimeout(() => document.getElementById('global-search')?.focus(), 0)
      } else if (event.key === '?' && !typing) {
        event.preventDefault()
        setShortcutsOpen((v) => !v)
      } else if (event.code === 'Space' && !typing && !(target instanceof HTMLButtonElement)) {
        event.preventDefault()
        togglePlayback()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, togglePlayback])

  const recordMedia = useEchoStore((state) => state.recordMedia)
  useEffect(() => {
    const playlistMatch = location.pathname.match(/^\/playlists\/([^/]+)$/)
    if (playlistMatch?.[1]) {
      const playlist = useEchoStore
        .getState()
        .playlists.find((item) => item.id === decodeURIComponent(playlistMatch[1]!))
      if (playlist)
        recordMedia({
          id: playlist.id,
          kind: 'playlist',
          title: playlist.title,
          subtitle: `${playlist.trackIds.length} tracks`,
          image: playlist.image,
        })
    }
  }, [location.pathname, recordMedia])

  useEffect(() => {
    themeManager.applyAccent(preferences.accentColor)
  }, [preferences.accentColor])

  useEffect(() => {
    themeManager.applyTheme(preferences.themeMode)
    if (preferences.themeMode !== 'system') return
    const unsubscribe = themeManager.subscribeSystemTheme(() => {
      themeManager.applyTheme('system')
    })
    return () => unsubscribe()
  }, [preferences.themeMode])

  const isMobile = useIsMobileDevice()
  const [bypassMobile, setBypassMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return sessionStorage.getItem('echo_bypass_mobile_landing') === 'true'
  })

  const handleContinueToWeb = () => {
    sessionStorage.setItem('echo_bypass_mobile_landing', 'true')
    setBypassMobile(true)
  }

  if (isMobile && !bypassMobile) {
    return <MobileApkLanding onContinueToWeb={handleContinueToWeb} />
  }

  return (
    <>
      <div className="app-shell">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-[#8b79e8] focus:px-4 focus:py-2 focus:font-semibold focus:text-black focus:outline-none focus:ring-2 focus:ring-white"
        >
          Skip to main content
        </a>
        <Sidebar
          onOpenEchoFind={() => setEchoFindOpen(true)}
          onOpenListenTogether={() => setListenTogetherOpen(true)}
          onOpenSpotifyImport={() => setSpotifyImportOpen(true)}
        />
        <section className="app-main">
          <header className="topbar">
            <div className="topbar__left">
              <Link className="mobile-brand" to="/" aria-label="Echo Music Home">
                <span className="brand__symbol">
                  <EchoMusicLogo size={16} />
                </span>
                <span className="brand__text">
                  Echo <span className="brand__sub">Music</span>
                </span>
              </Link>
              <button
                className="icon-button topbar__history min-h-[44px] min-w-[44px]"
                type="button"
                aria-label="Go back"
                onClick={() => {
                  recordLayoutMetric('historyBackNavigations')
                  navigate(-1)
                }}
              >
                <ArrowLeft size={18} />
              </button>
              <button
                className="icon-button topbar__history min-h-[44px] min-w-[44px]"
                type="button"
                aria-label="Go forward"
                onClick={() => {
                  recordLayoutMetric('historyForwardNavigations')
                  navigate(1)
                }}
              >
                <ArrowRight size={18} />
              </button>
            </div>

            <div className="topbar__right flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEchoFindOpen(true)}
                className="flex items-center gap-1.5 rounded-lg bg-white/4 px-2.5 py-1.5 text-xs font-semibold text-[#a59fad] transition-colors hover:bg-white/8 hover:text-white"
                title="Echo Find music recognition"
              >
                <Mic size={14} className="text-[#b09cff]" />
                <span className="hidden sm:inline">Echo Find</span>
              </button>

              <button
                type="button"
                onClick={() => setListenTogetherOpen(true)}
                className="flex items-center gap-1.5 rounded-lg bg-white/4 px-2.5 py-1.5 text-xs font-semibold text-[#a59fad] transition-colors hover:bg-white/8 hover:text-white"
                title="Listen Together"
              >
                <Radio size={14} className="text-[#7c5cff]" />
                <span className="hidden sm:inline">Listen Together</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  recordLayoutMetric('shortcutsModalOpens')
                  setShortcutsOpen(true)
                }}
                className="hidden rounded-lg bg-white/4 p-1.5 text-[#a59fad] transition-colors hover:bg-white/8 hover:text-white md:block"
                title="Keyboard Shortcuts (?)"
              >
                <Keyboard size={16} />
              </button>

              <Link className="topbar-liked" to="/liked">
                <Heart size={15} fill="currentColor" /> <span>{likedIds.length}</span>
              </Link>
              <Link className="avatar-link" to="/settings" aria-label="Open settings">
                E
              </Link>
            </div>
          </header>

          <main id="main-content" tabIndex={-1} className="main-scroll" key={location.pathname}>
            <Suspense
              fallback={
                <div className="route-loading" role="status">
                  <span className="route-loading__mark" />
                  <span>Finding your place…</span>
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </main>
        </section>

        <PlayerBar />
        <MobileNav />
        <Toast />
      </div>

      {/* Global Modals */}
      <EchoFindModal isOpen={echoFindOpen} onClose={() => setEchoFindOpen(false)} />
      <ListenTogetherModal
        isOpen={listenTogetherOpen}
        onClose={() => setListenTogetherOpen(false)}
      />
      <SpotifyImportModal isOpen={spotifyImportOpen} onClose={() => setSpotifyImportOpen(false)} />
      <KeyboardShortcutsModal isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  )
}
