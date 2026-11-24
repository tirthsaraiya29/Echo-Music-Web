/**
 * Canvas video player component.
 *
 * Responsibilities:
 * - Renders dynamic looping Canvas background videos resolved from Tidal and Apple Music.
 * - Ambient ambient-blur artwork fallback layer during resolution, loading, or video error.
 * - Respects prefers-reduced-motion media query: skips video playback to prevent motion sickness.
 * - Bounded 8s video loading timeout with graceful fallback.
 * - Full lifecycle cleanup: pauses media, removes source, and aborts pending resolution on unmount.
 * - Telemetry metrics instrumentation for renders, video load outcomes, and reduced motion skips.
 */

import { useEffect, useRef, useState } from 'react'
import type { Track } from '../../types/domain.ts'
import { CanvasManager } from '../../services/canvas/CanvasManager.ts'
import { artwork } from '../../utils/artwork.ts'
import {
  recordCanvasVideoMetric,
  isReducedMotionPreferred,
} from '../../services/canvas/canvasVideoTypes.ts'

export interface CanvasVideoProps {
  track: Track | null
  className?: string
}

export function CanvasVideo({ track, className = '' }: CanvasVideoProps) {
  recordCanvasVideoMetric('renders')

  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [isVideoReady, setIsVideoReady] = useState(false)
  const [hasError, setHasError] = useState(false)
  const loadTimeoutRef = useRef<number | null>(null)

  const coverArt =
    track?.artwork ||
    track?.thumbnailUrl ||
    track?.albumImage ||
    artwork(track?.title || 'echo-track', 800)

  const prefersReducedMotion = isReducedMotionPreferred()

  useEffect(() => {
    const video = videoRef.current
    if (!track || prefersReducedMotion) {
      if (prefersReducedMotion) {
        recordCanvasVideoMetric('reducedMotionSkips')
      }
      return () => {
        if (video) {
          video.pause()
          video.removeAttribute('src')
          video.load()
        }
      }
    }

    const abortController = new AbortController()

    CanvasManager.getInstance()
      .resolveCanvasVideo(track, abortController.signal)
      .then((result) => {
        if (!abortController.signal.aborted) {
          setVideoUrl(result?.videoUrl ?? null)
          setIsVideoReady(false)
          setHasError(false)
        }
      })
      .catch(() => {
        if (!abortController.signal.aborted) {
          setVideoUrl(null)
          setIsVideoReady(false)
        }
      })

    return () => {
      abortController.abort()
      if (video) {
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
      if (loadTimeoutRef.current !== null) {
        window.clearTimeout(loadTimeoutRef.current)
      }
    }
  }, [track, prefersReducedMotion])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !videoUrl || prefersReducedMotion) return

    recordCanvasVideoMetric('videoLoadStarts')
    setIsVideoReady(false)
    setHasError(false)

    // Bounded 8s timeout to avoid permanent hanging video state
    if (loadTimeoutRef.current !== null) {
      window.clearTimeout(loadTimeoutRef.current)
    }
    loadTimeoutRef.current = window.setTimeout(() => {
      recordCanvasVideoMetric('videoLoadErrors')
      setHasError(true)
      setIsVideoReady(false)
    }, 8000)

    const handleCanPlay = () => {
      if (loadTimeoutRef.current !== null) {
        window.clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = null
      }
      recordCanvasVideoMetric('videoLoadSuccesses')
      setIsVideoReady(true)
      video.play().catch(() => {
        // Autoplay may be restricted by browser until user gesture
      })
    }

    const handleError = () => {
      if (loadTimeoutRef.current !== null) {
        window.clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = null
      }
      recordCanvasVideoMetric('videoLoadErrors')
      setHasError(true)
      setIsVideoReady(false)
    }

    video.addEventListener('canplaythrough', handleCanPlay)
    video.addEventListener('error', handleError)

    video.src = videoUrl
    video.load()

    return () => {
      if (loadTimeoutRef.current !== null) {
        window.clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = null
      }
      video.removeEventListener('canplaythrough', handleCanPlay)
      video.removeEventListener('error', handleError)
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [videoUrl, prefersReducedMotion])

  return (
    <div
      className={`canvas-video-container pointer-events-none relative inset-0 h-full w-full overflow-hidden select-none ${className}`}
      aria-hidden="true"
    >
      {/* Fallback Artwork Layer with Ambient Blur */}
      <div
        className="canvas-artwork-layer absolute inset-0 bg-cover bg-center transition-opacity duration-700 ease-out"
        style={{
          backgroundImage: `url(${coverArt})`,
          transform: prefersReducedMotion ? 'none' : 'scale(1.15)',
          filter: 'blur(56px) saturate(160%) brightness(0.65)',
        }}
      />

      {/* Looping Canvas Video Layer */}
      {videoUrl && !hasError && !prefersReducedMotion && (
        <video
          ref={videoRef}
          className={`canvas-video-element absolute inset-0 h-full w-full object-cover transition-opacity duration-400 ease-in-out ${
            isVideoReady ? 'opacity-90' : 'opacity-0'
          }`}
          style={{
            transform: 'scale(1.05)',
            filter: 'contrast(105%) brightness(0.85)',
          }}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
      )}

      {/* Surface Depth Tint & Frosting Overlay */}
      <div
        className="canvas-tint-layer absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 40%, rgba(11, 10, 15, 0.4) 0%, rgba(11, 10, 15, 0.85) 100%)',
        }}
      />
    </div>
  )
}
