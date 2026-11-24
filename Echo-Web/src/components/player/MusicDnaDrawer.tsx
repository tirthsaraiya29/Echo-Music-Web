import { useState, useEffect, useRef } from 'react'
import { BookOpen, Activity, Sparkles, ExternalLink, X, Info, AlertCircle, RefreshCw, WifiOff } from 'lucide-react'
import { fetchMusicDna, type MusicDnaData } from '../../services/musicDna/musicDnaService.ts'
import { isReducedMotionPreferred } from '../../services/musicDna/musicDnaTypes.ts'
import type { Track } from '../../types/domain'

interface MusicDnaDrawerProps {
  track: Track | null
  isOpen: boolean
  onClose: () => void
}

export function MusicDnaDrawer({ track, isOpen, onClose }: MusicDnaDrawerProps) {
  const [dnaData, setDnaData] = useState<MusicDnaData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isOffline, setIsOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine)
  const [activeTab, setActiveTab] = useState<'lore' | 'telemetry'>('lore')
  const [retryNonce, setRetryNonce] = useState(0)

  const abortControllerRef = useRef<AbortController | null>(null)
  const prefersReducedMotion = isReducedMotionPreferred()

  // Escape key listener for keyboard accessibility
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Online / offline network status tracking
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

  // Fetch data with cancellation on track change or drawer close
  useEffect(() => {
    if (!isOpen || !track) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
      return
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    const controller = new AbortController()
    abortControllerRef.current = controller

    setIsLoading(true)
    setError(null)

    fetchMusicDna(track, { signal: controller.signal, timeoutMs: 8000 })
      .then((data) => {
        if (!controller.signal.aborted) {
          setDnaData(data)
          setIsLoading(false)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setIsLoading(false)
          const msg = err instanceof Error ? err.message : 'Failed to analyze track DNA'
          setError(msg)
        }
      })

    return () => {
      controller.abort()
    }
  }, [track, isOpen, retryNonce])

  if (!isOpen || !track) return null

  return (
    <div
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-white/8 bg-[#121017] text-[#f4f1f7] shadow-2xl transition-transform duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="music-dna-title"
      tabIndex={-1}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/8 px-6 py-5">
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-[#7c5cff]/15 p-2 text-[#b09cff]" aria-hidden="true">
            <Sparkles size={18} />
          </div>
          <div>
            <h2 id="music-dna-title" className="text-base leading-tight font-bold text-white">Music DNA</h2>
            <p className="max-w-[240px] truncate text-xs text-[#a59fad]">
              {track.title} · {track.artistName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isOffline && (
            <span
              className="flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-400"
              title="You are currently offline"
              role="status"
            >
              <WifiOff size={12} />
              <span>Offline</span>
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-white/4 p-2 text-[#a59fad] transition-colors hover:bg-white/8 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#7c5cff]"
            title="Close (Esc)"
            aria-label="Close Music DNA drawer"
          >
            <X size={17} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/6 px-6 pt-2" role="tablist" aria-label="Music DNA views">
        <button
          type="button"
          role="tab"
          id="tab-lore"
          aria-selected={activeTab === 'lore'}
          aria-controls="panel-lore"
          onClick={() => setActiveTab('lore')}
          className={`flex min-h-[44px] items-center gap-2 border-b-2 px-3 py-3 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#7c5cff] ${
            activeTab === 'lore'
              ? 'border-[#7c5cff] text-[#b09cff]'
              : 'border-transparent text-[#a59fad] hover:text-white'
          }`}
        >
          <BookOpen size={14} aria-hidden="true" />
          <span>Story & Lore</span>
        </button>
        <button
          type="button"
          role="tab"
          id="tab-telemetry"
          aria-selected={activeTab === 'telemetry'}
          aria-controls="panel-telemetry"
          onClick={() => setActiveTab('telemetry')}
          className={`flex min-h-[44px] items-center gap-2 border-b-2 px-3 py-3 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#7c5cff] ${
            activeTab === 'telemetry'
              ? 'border-[#7c5cff] text-[#b09cff]'
              : 'border-transparent text-[#a59fad] hover:text-white'
          }`}
        >
          <Activity size={14} aria-hidden="true" />
          <span>Engine Telemetry</span>
        </button>
      </div>

      {/* Content Body */}
      <div className="custom-scrollbar flex-1 space-y-6 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-xs text-[#a59fad]" role="status" aria-live="polite">
            <Sparkles size={24} className={`${prefersReducedMotion ? '' : 'animate-spin'} text-[#7c5cff]`} />
            <span>Analyzing track DNA & annotations...</span>
          </div>
        ) : error ? (
          /* Recoverable Error State */
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center text-xs text-red-300" role="alert">
            <AlertCircle size={28} className="text-red-400" />
            <div>
              <p className="font-semibold text-white">Unable to retrieve Music DNA</p>
              <p className="mt-1 text-xs text-red-300/80">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => setRetryNonce((n) => n + 1)}
              className="mt-2 flex min-h-[44px] items-center gap-2 rounded-lg bg-white/8 px-4 py-2 font-medium text-white transition-colors hover:bg-white/12 focus:outline-none focus:ring-2 focus:ring-[#7c5cff]"
            >
              <RefreshCw size={14} />
              <span>Retry Analysis</span>
            </button>
          </div>
        ) : activeTab === 'lore' ? (
          /* Lore & Background Tab */
          <div id="panel-lore" role="tabpanel" aria-labelledby="tab-lore" className="space-y-6">
            {/* Genius Track Lore */}
            {dnaData?.genius?.description && (
              <div className="rounded-xl border border-white/6 bg-white/3 p-4">
                <span className="mb-2 block font-mono text-[11px] font-semibold tracking-wider text-[#7c5cff] uppercase">
                  Song Meaning & Story
                </span>
                <p className="text-xs leading-relaxed whitespace-pre-line text-[#e1dde8]">
                  {dnaData.genius.description}
                </p>
                {dnaData.genius.releaseDate && (
                  <span className="mt-3 block font-mono text-[11px] text-[#a59fad]">
                    Released: {dnaData.genius.releaseDate}
                  </span>
                )}
              </div>
            )}

            {/* Wikipedia Song Extract */}
            {dnaData?.wikipedia && (
              <div className="rounded-xl border border-white/6 bg-white/3 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[11px] font-semibold tracking-wider text-[#a59fad] uppercase">
                    Wikipedia Background
                  </span>
                  {dnaData.wikipedia.pageUrl && (
                    <a
                      href={dnaData.wikipedia.pageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] text-[#b09cff] hover:underline"
                    >
                      <span>Read wiki</span>
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-[#c6c0cf]">
                  {dnaData.wikipedia.extract}
                </p>
              </div>
            )}

            {/* Wikipedia Artist Bio */}
            {dnaData?.artistWikipedia && (
              <div className="rounded-xl border border-white/6 bg-white/3 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[11px] font-semibold tracking-wider text-[#a59fad] uppercase">
                    About {track.artistName}
                  </span>
                  {dnaData.artistWikipedia.pageUrl && (
                    <a
                      href={dnaData.artistWikipedia.pageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] text-[#b09cff] hover:underline"
                    >
                      <span>Artist page</span>
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-[#c6c0cf]">
                  {dnaData.artistWikipedia.extract}
                </p>
              </div>
            )}

            {!dnaData?.genius?.description && !dnaData?.wikipedia && (
              <div className="rounded-xl border border-white/4 bg-white/2 p-8 text-center text-xs text-[#a59fad]">
                <Info size={24} className="mx-auto mb-2 text-[#a59fad]/60" />
                <p>Limited background lore available for this specific recording.</p>
              </div>
            )}
          </div>
        ) : (
          /* Engine Telemetry Tab */
          <div id="panel-telemetry" role="tabpanel" aria-labelledby="tab-telemetry" className="space-y-4">
            <div className="space-y-2 rounded-xl border border-white/6 bg-white/3 p-4">
              <span className="block font-mono text-[11px] text-[#a59fad] uppercase">
                Audio Pipeline Telemetry
              </span>
              <div className="flex justify-between border-b border-white/4 py-1 text-xs">
                <span className="text-[#a59fad]">Audio Codec</span>
                <span className="font-mono text-white">
                  {track.id.startsWith('local_')
                    ? 'Local File (Decoded PCM)'
                    : 'Opus / WebM (Bitrate ~160k)'}
                </span>
              </div>
              <div className="flex justify-between border-b border-white/4 py-1 text-xs">
                <span className="text-[#a59fad]">Web Audio Internal Depth</span>
                <span className="font-mono text-white">32-bit Floating Point</span>
              </div>
              <div className="flex justify-between py-1 text-xs">
                <span className="text-[#a59fad]">Dynamic Compressor</span>
                <span className="font-mono text-[#58ad83]">Active Threshold: -14 dB</span>
              </div>
            </div>

            <div className="rounded-xl border border-white/4 bg-white/2 p-4 text-xs text-[#a59fad]">
              Per-track stats like tempo, musical key and loudness are not shown because Echo does
              not analyze audio content. Only measured pipeline facts above are reported.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
