import { useState, useEffect, useRef } from 'react'
import { Mic, RotateCcw, X, Volume2, Play, Music, AlertCircle, WifiOff } from 'lucide-react'
import { echoFind, type RecognitionResult } from '../../services/recognition/echoFindService.ts'
import { isReducedMotionPreferred } from '../../services/recognition/echoFindTypes.ts'
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap'
import { useEchoStore } from '../../stores/useEchoStore'
import type { Track } from '../../types/domain'

interface EchoFindModalProps {
  isOpen: boolean
  onClose: () => void
}

export function EchoFindModal({ isOpen, onClose }: EchoFindModalProps) {
  const [isListening, setIsListening] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [guidance, setGuidance] = useState<string | null>(null)
  const [isConfigured, setIsConfigured] = useState(true)
  const [matchedTrack, setMatchedTrack] = useState<Track | null>(null)
  const [confidence, setConfidence] = useState<number | null>(null)
  const [isOffline, setIsOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine)
  const [providerName, setProviderName] = useState('Shazam Gateway (Default)')

  const isMounted = useRef(true)
  const dialogRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const prefersReducedMotion = isReducedMotionPreferred()

  useModalFocusTrap(dialogRef, onClose, isOpen)

  // Load active recognition provider status
  useEffect(() => {
    if (isOpen) {
      void echoFind.getStatus().then((status) => {
        if (isMounted.current && status?.provider) {
          setProviderName(status.provider)
        }
      })
    }
  }, [isOpen])

  // Online / offline network monitoring
  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const handleStartListening = async () => {
    if (isOffline) {
      setErrorMsg('You are currently offline. Connect to the internet to identify songs.')
      return
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    setErrorMsg(null)
    setGuidance(null)
    setMatchedTrack(null)
    setConfidence(null)
    setIsListening(true)
    setAudioLevel(0)

    try {
      const res: RecognitionResult = await echoFind.startListening(
        (lvl) => {
          if (isMounted.current && !controller.signal.aborted) {
            setAudioLevel(lvl)
          }
        },
        { durationMs: 6000, signal: controller.signal },
      )

      if (isMounted.current && !controller.signal.aborted) {
        setIsListening(false)
        if (res.matched && res.track) {
          setMatchedTrack(res.track)
          setConfidence(res.confidence ?? 95)
          setErrorMsg(null)
          setGuidance(null)
        } else {
          setMatchedTrack(null)
          setConfidence(null)
          setIsConfigured(res.configured !== false)
          setErrorMsg(res.message || 'No matching music found.')
          setGuidance(res.guidance || null)
        }
      }
    } catch (err) {
      if (isMounted.current && !controller.signal.aborted) {
        setIsListening(false)
        setErrorMsg(err instanceof Error ? err.message : 'Microphone access failed')
      }
    }
  }

  const handlePlayMatched = () => {
    if (matchedTrack) {
      useEchoStore.getState().playQueue([matchedTrack], 0)
      handleClose()
    }
  }

  const handleClose = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    echoFind.stopListening()
    setIsListening(false)
    setErrorMsg(null)
    setGuidance(null)
    setMatchedTrack(null)
    setConfidence(null)
    setAudioLevel(0)
    onClose()
  }

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      echoFind.stopListening()
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return

    let active = true
    const timer = setTimeout(() => {
      if (active) {
        void handleStartListening()
      }
    }, 0)

    return () => {
      active = false
      clearTimeout(timer)
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      echoFind.stopListening()
    }
  }, [isOpen])

  if (!isOpen) return null

  // Calculate radar pulse ring scale based on live microphone level
  const pulseScale = prefersReducedMotion ? 1 : 1 + Math.min(0.6, audioLevel * 1.8)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="echo-find-modal-title"
    >
      <div
        ref={dialogRef}
        className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#16141e] p-6 text-[#f4f1f7] shadow-2xl"
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-4 right-4 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-white/4 p-2 text-[#a59fad] transition-colors hover:bg-white/8 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#7c5cff]"
          title="Close (Esc)"
          aria-label="Close Echo Find dialog"
        >
          <X size={18} />
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-[#7c5cff]/15 px-3 py-1 text-xs font-semibold tracking-wider text-[#b09cff] uppercase">
            <Volume2 size={13} aria-hidden="true" />
            <span>Echo Find</span>
            <span className="ml-1 rounded bg-black/30 px-1.5 py-0.5 font-mono text-[9px] text-[#e7e4ed] normal-case">
              {providerName}
            </span>
          </div>

          <h2 id="echo-find-modal-title" className="mb-1 text-xl font-bold text-white">
            {isListening
              ? 'Listening to audio...'
              : matchedTrack
                ? 'Track Identified'
                : 'Music Recognition'}
          </h2>
          <p className="mb-6 max-w-xs text-xs text-[#a59fad]">
            {isListening
              ? 'Keep your device close to the audio source while Echo records a sample.'
              : matchedTrack
                ? `Matched with ${confidence}% confidence.`
                : errorMsg || 'Identify any song playing in your room or background.'}
          </p>

          {/* Offline warning badge */}
          {isOffline && (
            <div
              className="mb-4 flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-300"
              role="status"
            >
              <WifiOff size={14} />
              <span>Offline: song recognition requires a network connection</span>
            </div>
          )}

          {/* Radar Animation Stage */}
          {isListening && (
            <div
              className="relative mb-6 flex h-40 w-40 items-center justify-center"
              role="status"
              aria-live="polite"
              aria-label="Microphone active, listening for music"
            >
              <div
                className="absolute inset-0 rounded-full border border-[#7c5cff]/20 bg-[#7c5cff]/10 transition-transform duration-75"
                style={{ transform: `scale(${pulseScale * 1.25})` }}
              />
              <div
                className="absolute inset-4 rounded-full border border-[#7c5cff]/40 bg-[#7c5cff]/20 transition-transform duration-75"
                style={{ transform: `scale(${pulseScale * 1.1})` }}
              />
              <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-[#7c5cff] text-black shadow-lg shadow-[#7c5cff]/30">
                <Mic size={32} className={prefersReducedMotion ? '' : 'animate-pulse'} />
              </div>
            </div>
          )}

          {/* Matched Track Stage */}
          {!isListening && matchedTrack && (
            <div className="mb-6 flex w-full items-center gap-4 rounded-xl border border-[#7c5cff]/30 bg-[#7c5cff]/10 p-4 text-left">
              {matchedTrack.artwork ? (
                <img
                  src={matchedTrack.artwork}
                  alt={matchedTrack.title}
                  className="h-16 w-16 rounded-lg object-cover shadow-md"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-[#7c5cff]/20 text-[#b09cff]" aria-hidden="true">
                  <Music size={28} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-sm text-white">{matchedTrack.title}</strong>
                <span className="block truncate text-xs text-[#a59fad]">
                  {matchedTrack.artistName}
                </span>
                {matchedTrack.albumTitle && (
                  <span className="block truncate text-[11px] text-[#a59fad]/70">
                    {matchedTrack.albumTitle}
                  </span>
                )}
                {confidence !== null && (
                  <span className="mt-1 inline-block rounded bg-[#7c5cff]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#b09cff]">
                    {confidence}% Match
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Unconfigured Guidance Notice */}
          {!isListening && !matchedTrack && !isConfigured && guidance && (
            <div className="mb-6 w-full rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-left text-xs text-amber-300" role="status">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle size={15} />
                <span>Recognition Service Unconfigured</span>
              </div>
              <p className="mt-1 text-amber-200/80">{guidance}</p>
            </div>
          )}

          {/* Error Notice */}
          {!isListening && !matchedTrack && isConfigured && errorMsg && (
            <div className="mb-6 w-full rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-left text-xs text-red-300" role="alert">
              <p>{errorMsg}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex w-full items-center justify-center gap-3">
            {isListening ? (
              <button
                type="button"
                onClick={() => {
                  if (abortControllerRef.current) {
                    abortControllerRef.current.abort()
                  }
                  echoFind.stopListening()
                  setIsListening(false)
                }}
                className="flex min-h-[44px] items-center justify-center rounded-xl bg-white/8 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-white/12 focus:outline-none focus:ring-2 focus:ring-[#7c5cff]"
              >
                Cancel
              </button>
            ) : matchedTrack ? (
              <>
                <button
                  type="button"
                  onClick={handlePlayMatched}
                  className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#7c5cff] px-5 py-2.5 text-xs font-semibold text-black shadow-md transition-all hover:bg-[#6c48ff] focus:outline-none focus:ring-2 focus:ring-[#7c5cff]"
                >
                  <Play size={15} />
                  <span>Play Track</span>
                </button>
                <button
                  type="button"
                  onClick={handleStartListening}
                  className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-white/8 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-white/12 focus:outline-none focus:ring-2 focus:ring-[#7c5cff]"
                  title="Listen again"
                >
                  <RotateCcw size={15} />
                  <span>Try Again</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleStartListening}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#7c5cff] px-6 py-2.5 text-xs font-semibold text-black shadow-md transition-all hover:bg-[#6c48ff] focus:outline-none focus:ring-2 focus:ring-[#7c5cff]"
              >
                <RotateCcw size={15} />
                <span>Listen Again</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
