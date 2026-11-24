import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Mic,
  RotateCcw,
  X,
  Volume2,
  Play,
  Music,
  AlertCircle,
  WifiOff,
  History,
  Trash2,
  Search,
  ArrowLeft,
  Check,
} from 'lucide-react'
import { echoFind, type RecognitionResult } from '../../services/recognition/echoFindService.ts'
import {
  recognitionHistoryService,
  type RecognitionHistoryItem,
} from '../../services/recognition/RecognitionHistoryService.ts'
import { isReducedMotionPreferred } from '../../services/recognition/echoFindTypes.ts'
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap'
import { useEchoStore } from '../../stores/useEchoStore'
import type { Track } from '../../types/domain'

interface EchoFindModalProps {
  isOpen: boolean
  onClose: () => void
}

function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000)
  if (diffSec < 60) return 'Just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay === 1) return 'Yesterday'
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(timestamp).toLocaleDateString()
}

export function EchoFindModal({ isOpen, onClose }: EchoFindModalProps) {
  const [view, setView] = useState<'recognizer' | 'history'>('recognizer')
  const [isListening, setIsListening] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [guidance, setGuidance] = useState<string | null>(null)
  const [isConfigured, setIsConfigured] = useState(true)
  const [matchedTrack, setMatchedTrack] = useState<Track | null>(null)
  const [confidence, setConfidence] = useState<number | null>(null)
  const [isOffline, setIsOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine)
  const [providerName, setProviderName] = useState('Shazam Gateway (Default)')

  // History state
  const [historyItems, setHistoryItems] = useState<RecognitionHistoryItem[]>([])
  const [historySearchQuery, setHistorySearchQuery] = useState('')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [latestSavedId, setLatestSavedId] = useState<string | null>(null)

  const isMounted = useRef(true)
  const dialogRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const prefersReducedMotion = isReducedMotionPreferred()

  useModalFocusTrap(dialogRef, onClose, isOpen)

  const loadHistory = useCallback(async () => {
    const items = await recognitionHistoryService.getHistory()
    if (isMounted.current) {
      setHistoryItems(items)
    }
  }, [])

  // Load active recognition provider status & history
  useEffect(() => {
    if (isOpen) {
      void loadHistory()
      void echoFind.getStatus().then((status) => {
        if (isMounted.current && status?.provider) {
          setProviderName(status.provider)
        }
      })
    }
  }, [isOpen, loadHistory])

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

          void recognitionHistoryService
            .addMatch(res.track, res.confidence ?? 95, providerName)
            .then((saved) => {
              if (isMounted.current) {
                setLatestSavedId(saved.id)
                void loadHistory()
              }
            })
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
      if (latestSavedId) {
        void recognitionHistoryService.markAsPlayed(latestSavedId)
      }
      useEchoStore.getState().playQueue([matchedTrack], 0)
      handleClose()
    }
  }

  const handlePlayHistoryItem = (item: RecognitionHistoryItem) => {
    void recognitionHistoryService.markAsPlayed(item.id)
    const trackToPlay: Track = {
      id: item.trackId,
      videoId: item.trackId,
      title: item.title,
      artistName: item.artist,
      artistId: '',
      albumTitle: item.album || '',
      albumId: '',
      albumImage: item.artwork || '',
      artwork: item.artwork || '',
      durationSeconds: item.durationSeconds || 0,
      durationMs: (item.durationSeconds || 0) * 1000,
      explicit: false,
      playCount: 0,
    }
    useEchoStore.getState().playQueue([trackToPlay], 0)
    handleClose()
  }

  const handleDeleteHistoryItem = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await recognitionHistoryService.deleteItem(id)
    void loadHistory()
  }

  const handleClearAllHistory = async () => {
    await recognitionHistoryService.clearHistory()
    setShowClearConfirm(false)
    void loadHistory()
  }

  const handleClose = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    echoFind.stopListening()
    setIsListening(false)
    setErrorMsg(null)
    setMatchedTrack(null)
    setConfidence(null)
    setView('recognizer')
    onClose()
  }

  // Trigger microphone capture immediately when modal opens in recognizer view
  useEffect(() => {
    isMounted.current = true
    if (isOpen && !matchedTrack && !isListening && view === 'recognizer') {
      void handleStartListening()
    }

    return () => {
      isMounted.current = false
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      echoFind.stopListening()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  if (!isOpen) return null

  const pulseScale = 1 + Math.min(audioLevel * 1.5, 0.6)

  const filteredHistory = historySearchQuery.trim()
    ? historyItems.filter(
        (h) =>
          h.title.toLowerCase().includes(historySearchQuery.toLowerCase()) ||
          h.artist.toLowerCase().includes(historySearchQuery.toLowerCase()),
      )
    : historyItems

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="echo-find-modal-title"
    >
      <div
        ref={dialogRef}
        className="relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#16141e] p-6 text-[#f4f1f7] shadow-2xl"
      >
        {/* Navigation / Switcher Bar */}
        <div className="mb-4 flex items-center justify-between">
          {view === 'recognizer' ? (
            <button
              type="button"
              onClick={() => {
                setView('history')
                void loadHistory()
              }}
              className="flex min-h-[36px] items-center gap-1.5 rounded-lg bg-white/4 px-3 py-1.5 text-xs font-medium text-[#a59fad] transition-colors hover:bg-white/8 hover:text-white focus:outline-none focus:ring-1 focus:ring-[#7c5cff]"
              title="View recognition history"
              aria-label="View recognition history"
            >
              <History size={14} />
              <span>History</span>
              {historyItems.length > 0 && (
                <span className="rounded-full bg-[#7c5cff] px-1.5 py-0.2 font-mono text-[10px] font-bold text-[#0b0a0f]">
                  {historyItems.length}
                </span>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setView('recognizer')}
              className="flex min-h-[36px] items-center gap-1.5 rounded-lg bg-white/4 px-3 py-1.5 text-xs font-medium text-[#a59fad] transition-colors hover:bg-white/8 hover:text-white focus:outline-none focus:ring-1 focus:ring-[#7c5cff]"
              title="Back to song recognizer"
              aria-label="Back to song recognizer"
            >
              <ArrowLeft size={14} />
              <span>Recognizer</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleClose}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-white/4 p-2 text-[#a59fad] transition-colors hover:bg-white/8 hover:text-white focus:outline-none focus:ring-1 focus:ring-[#7c5cff]"
            title="Close (Esc)"
            aria-label="Close Echo Find dialog"
          >
            <X size={16} />
          </button>
        </div>

        {/* View Mode: History */}
        {view === 'history' ? (
          <div className="flex flex-1 flex-col overflow-hidden text-left">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-white">Recognition History</h3>
                <p className="text-[11px] text-[#a59fad]">
                  {historyItems.length} song{historyItems.length === 1 ? '' : 's'} identified
                </p>
              </div>

              {historyItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowClearConfirm(true)}
                  className="flex items-center gap-1 rounded-lg bg-red-500/10 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/20"
                  title="Clear all recognition history"
                >
                  <Trash2 size={12} />
                  <span>Clear All</span>
                </button>
              )}
            </div>

            {/* Clear Confirmation Prompt */}
            {showClearConfirm && (
              <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/15 p-2.5 text-xs text-red-200">
                <p className="mb-2">Clear all saved recognition history?</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleClearAllHistory}
                    className="rounded bg-red-500 px-3 py-1 text-xs font-semibold text-white hover:bg-red-600"
                  >
                    Confirm Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowClearConfirm(false)}
                    className="rounded bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/15"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Search filter */}
            {historyItems.length > 3 && (
              <div className="relative mb-3">
                <Search
                  size={13}
                  className="absolute top-1/2 left-2.5 -translate-y-1/2 text-[#a59fad]"
                />
                <input
                  type="text"
                  placeholder="Filter identified songs..."
                  value={historySearchQuery}
                  onChange={(e) => setHistorySearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/40 py-1.5 pr-3 pl-8 text-xs text-white focus:outline-none focus:ring-1 focus:ring-[#7c5cff]"
                />
              </div>
            )}

            {/* History List */}
            <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto pr-1">
              {filteredHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center text-[#a59fad]">
                  <Music size={28} className="mb-2 opacity-40" />
                  <p className="text-xs">
                    {historyItems.length === 0
                      ? 'No songs identified yet. When Echo Find recognises music, it will be saved here.'
                      : 'No matches found for your filter.'}
                  </p>
                </div>
              ) : (
                filteredHistory.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => handlePlayHistoryItem(item)}
                    className="group flex cursor-pointer items-center justify-between rounded-xl border border-white/6 bg-white/[0.02] p-2.5 transition hover:border-[#7c5cff]/30 hover:bg-white/[0.05]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {item.artwork ? (
                        <img
                          src={item.artwork}
                          alt={item.title}
                          className="h-10 w-10 flex-shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#7c5cff]/20 text-[#b09cff]">
                          <Music size={16} />
                        </div>
                      )}

                      <div className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-white group-hover:text-[#b09cff]">
                          {item.title}
                        </span>
                        <span className="block truncate text-[11px] text-[#a59fad]">
                          {item.artist}
                        </span>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[#8e8799]">
                          <span className="font-mono text-[#7c5cff]">{item.confidence}%</span>
                          <span>&bull;</span>
                          <span>{formatRelativeTime(item.recognizedAt)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 pl-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handlePlayHistoryItem(item)
                        }}
                        className="rounded-lg bg-[#7c5cff] p-1.5 text-black hover:bg-[#6c48ff]"
                        title="Play song"
                      >
                        <Play size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteHistoryItem(item.id, e)}
                        className="rounded-lg p-1.5 text-[#a59fad] opacity-0 transition group-hover:opacity-100 hover:bg-white/10 hover:text-white"
                        title="Remove from history"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          /* View Mode: Recognizer Stage */
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
                  <div
                    className="flex h-16 w-16 items-center justify-center rounded-lg bg-[#7c5cff]/20 text-[#b09cff]"
                    aria-hidden="true"
                  >
                    <Music size={28} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-white">
                      {matchedTrack.title}
                    </span>
                    {confidence !== null && (
                      <span className="rounded bg-[#7c5cff]/20 px-1.5 py-0.5 font-mono text-[10px] text-[#b09cff]">
                        {confidence}%
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-[#a59fad]">{matchedTrack.artistName}</p>
                  {matchedTrack.albumTitle && (
                    <p className="truncate text-[11px] text-[#8e8799]">{matchedTrack.albumTitle}</p>
                  )}
                  <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-emerald-400">
                    <Check size={10} /> Saved to Recognition History
                  </span>
                </div>
              </div>
            )}

            {/* Unconfigured Notice */}
            {!isListening && !matchedTrack && !isConfigured && guidance && (
              <div
                className="mb-6 w-full rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-left text-xs text-amber-300"
                role="status"
              >
                <div className="flex items-center gap-2 font-semibold">
                  <AlertCircle size={15} />
                  <span>Recognition Service Unconfigured</span>
                </div>
                <p className="mt-1 text-amber-200/80">{guidance}</p>
              </div>
            )}

            {/* Error Notice */}
            {!isListening && !matchedTrack && isConfigured && errorMsg && (
              <div
                className="mb-6 w-full rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-left text-xs text-red-300"
                role="alert"
              >
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
        )}
      </div>
    </div>
  )
}
