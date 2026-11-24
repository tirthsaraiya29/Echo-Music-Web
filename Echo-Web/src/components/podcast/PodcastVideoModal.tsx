/**
 * Fullscreen Video Podcast Player Modal
 *
 * Implements responsive landscape/portrait video podcast playback with
 * auto-hiding overlay controls, quality picker, fullscreen API integration,
 * and seamless audio/video position synchronization matching upstream
 * Echo Music architecture (PodcastVideoScreen.kt).
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  ArrowLeft,
  Check,
  Headphones,
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import type { Track } from '../../types/domain.ts'
import { AudioEngine } from '../../engine/AudioEngine.ts'
import { db } from '../../services/db/echoDatabase.ts'
import { formatDuration } from '../../utils/format.ts'
import {
  resolvePodcastVideoTracks,
  type VideoTrackOption,
  recordPodcastVideoMetric,
} from '../../services/podcast/podcastVideoService.ts'
import {
  calculateSkipBackward,
  calculateSkipForward,
} from '../../services/podcast/podcastSkipService.ts'

interface PodcastVideoModalProps {
  track: Track
  isOpen: boolean
  onClose: () => void
}

export function PodcastVideoModal({ track, isOpen, onClose }: PodcastVideoModalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hideControlsTimerRef = useRef<number | null>(null)

  const [tracks, setTracks] = useState<VideoTrackOption[]>([])
  const [selectedQuality, setSelectedQuality] = useState<string>('1080p HD')
  const [isPlaying, setIsPlaying] = useState<boolean>(true)
  const [isBuffering, setIsBuffering] = useState<boolean>(false)
  const [currentTime, setCurrentTime] = useState<number>(0)
  const [duration, setDuration] = useState<number>(track.durationSeconds || 0)
  const [controlsVisible, setControlsVisible] = useState<boolean>(true)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false)
  const [qualityMenuOpen, setQualityMenuOpen] = useState<boolean>(false)
  const [volume, setVolume] = useState<number>(1)
  const [isMuted, setIsMuted] = useState<boolean>(false)

  // Auto-hide controls timer
  const resetControlsTimer = useCallback(() => {
    setControlsVisible(true)
    if (hideControlsTimerRef.current !== null) {
      window.clearTimeout(hideControlsTimerRef.current)
    }
    if (isPlaying) {
      hideControlsTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false)
        setQualityMenuOpen(false)
      }, 3500)
    }
  }, [isPlaying])

  // Lifecycle & Initial Stream Resolution
  useEffect(() => {
    if (!isOpen) return

    const engine = AudioEngine.getInstance()
    const engineTime = engine.getCurrentTime()
    const engineDuration = engine.getDuration()

    // Seamless handoff: pause audio engine and transfer position
    engine.pause()
    recordPodcastVideoMetric('audioVideoSwitches')

    if (Number.isFinite(engineTime) && engineTime > 0) {
      setCurrentTime(engineTime)
    }
    if (Number.isFinite(engineDuration) && engineDuration > 0) {
      setDuration(engineDuration)
    }

    const videoId = track.videoId || track.id
    void resolvePodcastVideoTracks(videoId, track.title, track.artistName).then((resolved) => {
      setTracks(resolved)
      if (resolved.length > 0) {
        setSelectedQuality(resolved[0]!.label)
      }
    })

    resetControlsTimer()

    return () => {
      if (hideControlsTimerRef.current !== null) {
        window.clearTimeout(hideControlsTimerRef.current)
      }
    }
  }, [isOpen, track, resetControlsTimer])

  // Fullscreen Change Listener
  useEffect(() => {
    const handleFsChange = () => {
      const active = Boolean(document.fullscreenElement)
      setIsFullscreen(active)
      recordPodcastVideoMetric('fullscreenToggles')
    }
    document.addEventListener('fullscreenchange', handleFsChange)
    return () => document.removeEventListener('fullscreenchange', handleFsChange)
  }, [])

  // Seamless handoff back to audio engine on close
  const handleClose = useCallback(() => {
    const engine = AudioEngine.getInstance()
    const episodeId = track.videoId || track.id

    // Update database progress
    if (episodeId && typeof indexedDB !== 'undefined') {
      const posSec = Math.round(currentTime)
      const durSec = Math.round(duration)
      void db.podcastProgress
        .update(episodeId, {
          positionSeconds: posSec,
          positionMs: posSec * 1000,
          durationSeconds: durSec,
          durationMs: durSec * 1000,
          updatedAt: Date.now(),
        })
        .catch(() => {})
    }

    // Sync audio engine position and resume
    engine.seek(currentTime)
    if (isPlaying) {
      void engine.play()
    }
    recordPodcastVideoMetric('audioVideoSwitches')
    onClose()
  }, [track, currentTime, duration, isPlaying, onClose])

  // Fullscreen toggle helper
  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch {
      // Non-fatal if browser blocks fullscreen
    }
  }, [])

  // Keyboard controls
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      resetControlsTimer()

      if (e.code === 'Space') {
        e.preventDefault()
        setIsPlaying((v) => !v)
      } else if (e.code === 'ArrowLeft' || e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setCurrentTime((prev) => calculateSkipBackward(prev, 15))
      } else if (e.code === 'ArrowRight' || e.key.toLowerCase() === 'l') {
        e.preventDefault()
        setCurrentTime((prev) => calculateSkipForward(prev, duration, 30))
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault()
        void toggleFullscreen()
      } else if (e.key === 'Escape') {
        if (document.fullscreenElement) {
          void document.exitFullscreen()
        } else {
          handleClose()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, duration, resetControlsTimer, toggleFullscreen, handleClose])

  if (!isOpen) return null

  const activeTrack = tracks.find((t) => t.label === selectedQuality) || tracks[0]
  const videoId = track.videoId || track.id

  return (
    <div
      ref={containerRef}
      onMouseMove={resetControlsTimer}
      onClick={resetControlsTimer}
      className="fixed inset-0 z-50 flex flex-col justify-between bg-black text-white select-none overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label={`Video Player: ${track.title}`}
    >
      {/* Video Content Canvas / Embed */}
      <div className="relative flex-1 flex items-center justify-center w-full h-full">
        {activeTrack && activeTrack.videoUrl.endsWith('.mp4') ? (
          <video
            ref={videoRef}
            src={activeTrack.videoUrl}
            className="w-full h-full object-contain"
            autoPlay
            playsInline
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onWaiting={() => setIsBuffering(true)}
            onPlaying={() => setIsBuffering(false)}
          />
        ) : (
          <iframe
            title={`Video: ${track.title}`}
            src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&enablejsapi=1&fs=1&start=${Math.floor(currentTime)}`}
            className="w-full h-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
          />
        )}
      </div>

      {/* Top Header Overlay */}
      <div
        className={`absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-6 bg-gradient-to-b from-black/80 via-black/40 to-transparent transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-4 min-w-0">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full p-2.5 bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="Exit video player"
            aria-label="Back to music player"
          >
            <ArrowLeft size={22} />
          </button>
          <div className="truncate">
            <h2 className="text-lg font-bold truncate text-white">{track.title}</h2>
            <p className="text-sm text-[#a59fad] truncate">{track.showTitle || track.artistName}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 relative">
          {/* Quality Picker */}
          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setQualityMenuOpen((v) => !v)
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition-colors"
              title="Stream resolution"
              aria-label="Stream resolution"
            >
              <Settings size={15} />
              <span>{selectedQuality}</span>
            </button>

            {qualityMenuOpen && (
              <div
                className="absolute right-0 mt-2 w-36 rounded-xl border border-white/10 bg-[#16141e] p-1.5 shadow-2xl z-30"
                onClick={(e) => e.stopPropagation()}
              >
                {tracks.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => {
                      setSelectedQuality(t.label)
                      setQualityMenuOpen(false)
                      recordPodcastVideoMetric('qualityChanges')
                    }}
                    className={`flex items-center justify-between w-full px-3 py-2 text-xs font-medium rounded-lg text-left transition-colors ${
                      t.label === selectedQuality
                        ? 'bg-[#7c5cff] text-white font-bold'
                        : 'text-[#f4f1f7] hover:bg-white/10'
                    }`}
                  >
                    <span>{t.label}</span>
                    {t.label === selectedQuality && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Fullscreen Button */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="rounded-full p-2.5 bg-white/10 hover:bg-white/20 text-white transition-colors"
            title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
          </button>

          <button
            type="button"
            onClick={handleClose}
            className="rounded-full p-2.5 bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="Close video"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Center Transport Controls Overlay */}
      <div
        className={`absolute inset-0 z-10 flex items-center justify-center gap-10 transition-opacity duration-300 pointer-events-none ${
          controlsVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setCurrentTime((prev) => calculateSkipBackward(prev, 15))
          }}
          className="pointer-events-auto rounded-full p-4 bg-black/60 hover:bg-black/80 text-white transition-transform hover:scale-110 active:scale-95"
          title="Skip backward 15 seconds"
          aria-label="Skip backward 15 seconds"
        >
          <RotateCcw size={32} />
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setIsPlaying((v) => !v)
          }}
          className="pointer-events-auto flex h-20 w-20 items-center justify-center rounded-full bg-white text-black shadow-2xl transition-transform hover:scale-110 active:scale-95"
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isBuffering ? (
            <Loader2 size={36} className="animate-spin text-black" />
          ) : isPlaying ? (
            <Pause size={36} fill="currentColor" />
          ) : (
            <Play size={36} fill="currentColor" className="ml-1" />
          )}
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setCurrentTime((prev) => calculateSkipForward(prev, duration, 30))
          }}
          className="pointer-events-auto rounded-full p-4 bg-black/60 hover:bg-black/80 text-white transition-transform hover:scale-110 active:scale-95"
          title="Skip forward 30 seconds"
          aria-label="Skip forward 30 seconds"
        >
          <RotateCw size={32} />
        </button>
      </div>

      {/* Bottom Timeline & Controls Overlay */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-20 p-6 bg-gradient-to-t from-black/90 via-black/50 to-transparent transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Scrubber Slider */}
        <div className="flex items-center gap-3 w-full">
          <span className="text-xs font-medium text-white/80 min-w-10 text-right">
            {formatDuration(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration > 0 ? duration : 100}
            value={currentTime}
            onChange={(e) => setCurrentTime(Number.parseFloat(e.target.value))}
            className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-[#7c5cff]"
            aria-label="Seek time"
          />
          <span className="text-xs font-medium text-white/80 min-w-10">
            {formatDuration(duration)}
          </span>
        </div>

        {/* Bottom Actions */}
        <div className="flex items-center justify-between mt-3">
          <button
            type="button"
            onClick={handleClose}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition-colors"
            title="Switch back to audio-only playback"
          >
            <Headphones size={16} />
            <span>Switch to Audio Mode</span>
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsMuted((m) => !m)}
              className="p-1.5 text-white/80 hover:text-white transition-colors"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                const val = Number.parseFloat(e.target.value)
                setVolume(val)
                setIsMuted(false)
              }}
              className="w-20 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
              aria-label="Video volume"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
