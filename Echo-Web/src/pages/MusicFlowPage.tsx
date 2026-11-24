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
  Loader2,
  Music,
} from 'lucide-react'
import { musicFlowService } from '../services/flow/musicFlowService.ts'
import type { MusicFlowState } from '../types/flow.ts'
import { useEchoStore } from '../stores/useEchoStore.ts'
import { useAudioEngine } from '../hooks/useAudioEngine.ts'
import { artwork } from '../utils/artwork.ts'
import { classNames } from '../utils/classNames.ts'
import { formatDuration } from '../utils/format.ts'

export function MusicFlowPage() {
  const navigate = useNavigate()
  const [flowState, setFlowState] = useState<MusicFlowState>(() => musicFlowService.getState())
  const [touchStartY, setTouchStartY] = useState<number | null>(null)

  const currentTrack = useEchoStore((state) => state.currentTrack)
  const isPlaying = useEchoStore((state) => state.isPlaying)
  const togglePlayback = useEchoStore((state) => state.togglePlayback)
  const toggleTrackLike = useEchoStore((state) => state.toggleTrackLike)
  const likedTrackIds = useEchoStore((state) => state.likedTrackIds)
  const setToast = useEchoStore((state) => state.setToast)
  const [isMuted, setIsMuted] = useState(false)

  const { currentTime, duration, seekTo } = useAudioEngine()

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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        musicFlowService.nextTrack()
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        musicFlowService.prevTrack()
      } else if (e.key === ' ') {
        e.preventDefault()
        togglePlayback()
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault()
        const active = flowState.feed[flowState.currentIndex] ?? currentTrack
        if (active) {
          toggleTrackLike(active.id)
          musicFlowService.recordLike()
          const liked = likedTrackIds.includes(active.id)
          setToast(liked ? 'Removed from liked' : 'Added to liked')
        }
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        handleToggleMute()
      } else if (e.key === 'Escape') {
        handleExit(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [togglePlayback, handleExit, flowState, currentTrack, likedTrackIds, setToast, isMuted])

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
      musicFlowService.nextTrack()
    } else if (diff < -50) {
      musicFlowService.prevTrack()
    }
    setTouchStartY(null)
  }

  const activeTrack = flowState.feed[flowState.currentIndex] ?? currentTrack
  const prevTrack = flowState.currentIndex > 0 ? flowState.feed[flowState.currentIndex - 1] : null
  const nextTrack =
    flowState.currentIndex < flowState.feed.length - 1
      ? flowState.feed[flowState.currentIndex + 1]
      : null
  const isLiked = activeTrack ? likedTrackIds.includes(activeTrack.id) : false
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div
      className="music-flow-takeover relative flex h-[calc(100vh-80px)] w-full select-none flex-col items-center justify-between overflow-hidden bg-[#07060a] p-6 text-white"
      role="region"
      aria-roledescription="carousel"
      aria-label="Music Flow discovery reel"
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
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#7c5cff] to-[#b09cff] text-white shadow-md">
            <Sparkles size={20} />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight">Music Flow</h1>
            <p className="text-[11px] font-medium text-[#a59fad]">
              Continuous discovery reel • Swipe, scroll, or use arrow keys
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleExit(false)}
            className="flex min-h-[44px] items-center rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#7c5cff]"
            title="Keep this queue and exit Flow"
          >
            Keep this mix
          </button>
          <button
            type="button"
            onClick={() => handleExit(true)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/80 transition-colors hover:bg-white/15 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#7c5cff]"
            title="Exit Flow and restore previous queue"
            aria-label="Exit Flow"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Main Reel Presentation */}
      {flowState.isLoading && flowState.feed.length === 0 ? (
        <div className="relative z-10 my-auto flex flex-col items-center gap-3 text-center">
          <Loader2 size={36} className="animate-spin text-[#7c5cff]" />
          <p className="text-sm font-medium text-[#a59fad]">Tuning into your discovery flow...</p>
        </div>
      ) : flowState.feed.length === 0 ? (
        <div className="relative z-10 my-auto flex flex-col items-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5 text-[#a59fad]">
            <Radio size={32} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">No tracks in Flow reel</h2>
            <p className="mt-1 text-xs text-[#a59fad]">
              Unable to populate discovery tracks at this time.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void musicFlowService.enterFlow()}
            className="flex min-h-[44px] items-center rounded-xl bg-[#7c5cff] px-4 py-2 text-xs font-semibold text-black transition-transform hover:scale-105 active:scale-95"
          >
            Retry Flow
          </button>
        </div>
      ) : (
        <div className="relative z-10 my-auto flex w-full max-w-md flex-col items-center gap-4">
          {/* Navigation Arrow Up (Previous Track Peek) */}
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => musicFlowService.prevTrack()}
              disabled={flowState.currentIndex <= 0}
              className={classNames(
                'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-white/10 text-white/80 transition-all hover:bg-white/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#7c5cff]',
                flowState.currentIndex <= 0 && 'pointer-events-none opacity-20',
              )}
              aria-label="Previous track in reel"
            >
              <ChevronUp size={24} />
            </button>
            {prevTrack && (
              <span className="max-w-[200px] truncate text-[10px] text-[#a59fad] opacity-60">
                {prevTrack.title}
              </span>
            )}
          </div>

          {/* Center Card & Vinyl Presentation */}
          <div className="group relative aspect-square w-72 max-w-[80vw] overflow-hidden rounded-3xl border border-white/15 bg-white/5 shadow-2xl transition-all duration-300 hover:border-[#7c5cff]/40 sm:w-80">
            {activeTrack ? (
              <img
                src={artwork(activeTrack.artwork || activeTrack.albumImage, 512)}
                alt={activeTrack.title}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                loading="eager"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[#a59fad]">
                <Music size={48} className="animate-pulse opacity-40" />
              </div>
            )}

            {/* Floating Play Button Overlay */}
            <button
              type="button"
              onClick={togglePlayback}
              className="absolute inset-0 flex items-center justify-center bg-black/30 text-white opacity-0 transition-opacity hover:opacity-100 focus:opacity-100 focus:outline-none"
              aria-label={isPlaying ? 'Pause playback' : 'Start playback'}
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#7c5cff] text-black shadow-xl transition-transform hover:scale-110 active:scale-95">
                {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-1" />}
              </div>
            </button>
          </div>

          {/* Timeline Progress Bar */}
          <div className="flex w-full max-w-xs flex-col gap-1">
            <div className="flex items-center">
              <input
                type="range"
                aria-label="Flow playback position"
                aria-valuemin={0}
                aria-valuemax={duration > 0 ? duration : 100}
                aria-valuenow={currentTime}
                aria-valuetext={formatDuration(currentTime * 1000)}
                min={0}
                max={duration > 0 ? duration : 100}
                step={0.5}
                value={currentTime}
                onChange={(e) => {
                  const parsed = parseFloat(e.target.value)
                  const maxBound = duration > 0 ? duration : 100
                  const clamped = Math.max(0, Math.min(maxBound, Number.isFinite(parsed) ? parsed : 0))
                  seekTo(clamped)
                }}
                style={{ '--range-progress': `${progressPercent}%` } as React.CSSProperties}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-[#7c5cff]"
              />
            </div>
            <div className="flex justify-between font-mono text-[10px] text-[#a59fad]">
              <span>{formatDuration(currentTime * 1000)}</span>
              <span>{formatDuration(duration * 1000)}</span>
            </div>
          </div>

          {/* Track Metadata */}
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

          {/* Action Controls */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => {
                if (activeTrack) {
                  toggleTrackLike(activeTrack.id)
                  musicFlowService.recordLike()
                  setToast(isLiked ? 'Removed from liked' : 'Added to liked')
                }
              }}
              className={classNames(
                'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl border transition-all focus:outline-none focus:ring-2 focus:ring-[#7c5cff]',
                isLiked
                  ? 'border-red-500/40 bg-red-500/20 text-red-400'
                  : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/15 hover:text-white',
              )}
              title={isLiked ? 'Unlike track' : 'Like track'}
              aria-label={isLiked ? 'Unlike track' : 'Like track'}
            >
              <Heart size={20} className={isLiked ? 'fill-current' : ''} />
            </button>

            <button
              type="button"
              onClick={togglePlayback}
              className="flex min-h-[56px] min-w-[56px] items-center justify-center rounded-2xl bg-gradient-to-tr from-[#7c5cff] to-[#b09cff] text-black shadow-xl transition-transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-white"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" className="ml-1" />}
            </button>

            <button
              type="button"
              onClick={handleToggleMute}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/80 transition-all hover:bg-white/15 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#7c5cff]"
              title={isMuted ? 'Unmute' : 'Mute'}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
          </div>

          {/* Navigation Arrow Down (Next Track Peek) */}
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => musicFlowService.nextTrack()}
              disabled={flowState.currentIndex >= flowState.feed.length - 1}
              className={classNames(
                'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-white/10 text-white/80 transition-all hover:bg-white/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#7c5cff]',
                flowState.currentIndex >= flowState.feed.length - 1 && 'pointer-events-none opacity-20',
              )}
              aria-label="Next track in reel"
            >
              <ChevronDown size={24} />
            </button>
            {nextTrack && (
              <span className="max-w-[200px] truncate text-[10px] text-[#a59fad] opacity-60">
                {nextTrack.title}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Bottom Counter & Indicator */}
      <div className="relative z-10 flex items-center gap-2 text-xs text-[#a59fad]">
        <span>
          Card {flowState.currentIndex + 1} of {Math.max(1, flowState.feed.length)}
        </span>
        <span className="text-white/20">•</span>
        <span className="font-mono text-[10px] text-white/40">
          Swipes: {flowState.telemetry.swipesCount}
        </span>
      </div>
    </div>
  )
}
