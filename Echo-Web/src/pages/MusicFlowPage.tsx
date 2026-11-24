import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles,
  ChevronUp,
  ChevronDown,
  Play,
  Pause,
  Heart,
  X,
  Volume2,
  VolumeX,
  Radio,
} from 'lucide-react'
import { musicFlowService, type MusicFlowState } from '../services/flow/musicFlowService.ts'
import { useEchoStore } from '../stores/useEchoStore.ts'
import { artwork } from '../utils/artwork.ts'
import { classNames } from '../utils/classNames.ts'

export function MusicFlowPage() {
  const navigate = useNavigate()
  const [flowState, setFlowState] = useState<MusicFlowState>(() => musicFlowService.getState())
  const [touchStartY, setTouchStartY] = useState<number | null>(null)

  const currentTrack = useEchoStore((state) => state.currentTrack)
  const isPlaying = useEchoStore((state) => state.isPlaying)
  const togglePlayback = useEchoStore((state) => state.togglePlayback)
  const toggleTrackLike = useEchoStore((state) => state.toggleTrackLike)
  const likedTrackIds = useEchoStore((state) => state.likedTrackIds)
  const [isMuted, setIsMuted] = useState(false)
  const setToast = useEchoStore((state) => state.setToast)

  const handleToggleMute = () => {
    const next = !isMuted
    setIsMuted(next)
    useEchoStore.getState().setPreference('muted', next)
  }

  const handleExit = useCallback(
    (restorePreviousQueue = true) => {
      void musicFlowService.exitFlow(restorePreviousQueue)
      navigate(-1)
    },
    [navigate],
  )

  // Subscribe to MusicFlowService
  useEffect(() => {
    const unsub = musicFlowService.subscribe(setFlowState)
    if (!musicFlowService.getState().isActive) {
      void musicFlowService.enterFlow()
    }
    return () => {
      unsub()
    }
  }, [])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        musicFlowService.nextTrack()
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        musicFlowService.prevTrack()
      } else if (e.key === ' ' && e.target === document.body) {
        e.preventDefault()
        togglePlayback()
      } else if (e.key === 'Escape') {
        handleExit(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [togglePlayback, handleExit])

  // Wheel swipe debouncing
  const wheelLockRef = useRef(false)
  const handleWheel = (e: React.WheelEvent) => {
    if (wheelLockRef.current) return
    if (Math.abs(e.deltaY) > 30) {
      wheelLockRef.current = true
      if (e.deltaY > 0) {
        musicFlowService.nextTrack()
      } else {
        musicFlowService.prevTrack()
      }
      setTimeout(() => {
        wheelLockRef.current = false
      }, 350)
    }
  }

  // Touch swipe handling
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches[0]) {
      setTouchStartY(e.touches[0].clientY)
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY === null) return
    const touchEndY = e.changedTouches[0]?.clientY ?? touchStartY
    const diff = touchStartY - touchEndY
    if (diff > 50) {
      // Swiped up -> next track
      musicFlowService.nextTrack()
    } else if (diff < -50) {
      // Swiped down -> prev track
      musicFlowService.prevTrack()
    }
    setTouchStartY(null)
  }

  const activeTrack = flowState.feed[flowState.currentIndex] ?? currentTrack
  const isLiked = activeTrack ? likedTrackIds.includes(activeTrack.id) : false

  return (
    <div
      className="music-flow-takeover relative flex h-[calc(100vh-80px)] w-full select-none flex-col items-center justify-between overflow-hidden bg-[#07060a] p-6 text-white"
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Blurred Backdrop of Current Track */}
      {activeTrack && (
        <div
          className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-25 blur-3xl transition-all duration-700"
          style={{
            backgroundImage: `url(${artwork(activeTrack.artwork || activeTrack.albumImage, 320)})`,
          }}
        />
      )}

      {/* Top Bar: Title & Exit Controls */}
      <div className="relative z-10 flex w-full max-w-4xl items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-[#7c5cff] to-[#b09cff] text-white shadow-md">
            <Sparkles size={18} />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight">Music Flow</h1>
            <p className="text-[11px] font-medium text-[#a59fad]">
              Continuous discovery feed • Swipe or use arrow keys
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleExit(false)}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            title="Keep this queue and exit Flow"
          >
            Keep this mix
          </button>
          <button
            type="button"
            onClick={() => handleExit(true)}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
            title="Exit Flow and restore previous queue"
            aria-label="Exit Flow"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Main Reel Card Container */}
      <div className="relative z-10 my-auto flex w-full max-w-md flex-col items-center gap-6">
        {/* Navigation Arrow Up */}
        <button
          type="button"
          onClick={() => musicFlowService.prevTrack()}
          disabled={flowState.currentIndex <= 0}
          className={classNames(
            'flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 transition-all hover:bg-white/20 hover:text-white',
            flowState.currentIndex <= 0 && 'pointer-events-none opacity-20',
          )}
          aria-label="Previous track"
        >
          <ChevronUp size={20} />
        </button>

        {/* Center Artwork & Vinyl Presentation */}
        <div className="relative aspect-square w-72 max-w-[80vw] overflow-hidden rounded-3xl border border-white/15 bg-white/5 shadow-2xl transition-transform sm:w-80">
          {activeTrack ? (
            <img
              src={artwork(activeTrack.artwork || activeTrack.albumImage, 512)}
              alt={activeTrack.title}
              className="h-full w-full object-cover"
              loading="eager"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[#a59fad]">
              <Radio size={48} className="animate-pulse opacity-40" />
            </div>
          )}

          {/* Floating Play Button */}
          <button
            type="button"
            onClick={togglePlayback}
            className="absolute inset-0 flex items-center justify-center bg-black/30 text-white opacity-0 transition-opacity hover:opacity-100"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#7c5cff] shadow-xl">
              {isPlaying ? <Pause size={28} /> : <Play size={28} className="ml-1" />}
            </div>
          </button>
        </div>

        {/* Track Metadata & Quick Controls */}
        <div className="w-full text-center">
          <h2 className="line-clamp-1 text-xl font-bold tracking-tight text-white">
            {activeTrack?.title || 'Discovering Music...'}
          </h2>
          <p className="mt-1 line-clamp-1 text-sm font-medium text-[#b09cff]">
            {activeTrack?.artistName || 'Echo Flow'}
          </p>
          {activeTrack?.albumTitle && (
            <p className="line-clamp-1 text-xs text-[#a59fad] opacity-80">
              {activeTrack.albumTitle}
            </p>
          )}
        </div>

        {/* Floating Action Controls */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => {
              if (activeTrack) {
                toggleTrackLike(activeTrack.id)
                setToast(isLiked ? 'Removed from liked' : 'Added to liked')
              }
            }}
            className={classNames(
              'flex h-11 w-11 items-center justify-center rounded-2xl border transition-all',
              isLiked
                ? 'border-red-500/40 bg-red-500/20 text-red-400'
                : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/15 hover:text-white',
            )}
            title={isLiked ? 'Unlike' : 'Like'}
            aria-label={isLiked ? 'Unlike' : 'Like'}
          >
            <Heart size={20} className={isLiked ? 'fill-current' : ''} />
          </button>

          <button
            type="button"
            onClick={togglePlayback}
            className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#7c5cff] to-[#b09cff] text-white shadow-xl transition-transform hover:scale-105 active:scale-95"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={26} /> : <Play size={26} className="ml-1" />}
          </button>

          <button
            type="button"
            onClick={handleToggleMute}
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/80 transition-all hover:bg-white/15 hover:text-white"
            title={isMuted ? 'Unmute' : 'Mute'}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
        </div>

        {/* Navigation Arrow Down */}
        <button
          type="button"
          onClick={() => musicFlowService.nextTrack()}
          disabled={flowState.currentIndex >= flowState.feed.length - 1}
          className={classNames(
            'flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 transition-all hover:bg-white/20 hover:text-white',
            flowState.currentIndex >= flowState.feed.length - 1 && 'pointer-events-none opacity-20',
          )}
          aria-label="Next track"
        >
          <ChevronDown size={20} />
        </button>
      </div>

      {/* Bottom Counter & Indicator */}
      <div className="relative z-10 flex items-center gap-2 text-xs text-[#a59fad]">
        <span>
          Card {flowState.currentIndex + 1} of {Math.max(1, flowState.feed.length)}
        </span>
      </div>
    </div>
  )
}
