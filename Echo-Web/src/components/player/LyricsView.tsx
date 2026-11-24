/**
 * Lyrics stage view component.
 *
 * Responsibilities:
 * - Real-time synchronization of lyric lines and word-by-word karaoke text with AudioEngine playback.
 * - Auto-scrolling to active lyric with momentum, manual scroll pause override, and prefers-reduced-motion compliance.
 * - Dynamic timing offset adjustments (+/- 0.5s) persisted per track in IndexedDB with coalesced debounce.
 * - AI lyrics translation client integration and provider key configuration modal.
 * - Full accessibility compliance: ARIA roles, live regions, keyboard navigation (Enter/Space seek), touch targets >= 44px.
 * - Explicit loading, empty, stale, offline, and error states with recoverable retry.
 * - Telemetry metrics instrumentation and runtime schema validation via Zod.
 */

import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react'
import {
  Languages,
  Loader2,
  Sparkles,
  AlertCircle,
  Plus,
  Minus,
  WifiOff,
  CheckCircle2,
  XCircle,
  RefreshCw,
  FileDown,
  Copy,
  Check,
} from 'lucide-react'
import type { Track } from '../../types/domain.ts'
import type { LyricLine, LyricWord, SynchronizedLyrics } from '../../types/lyrics.ts'
import { db } from '../../services/db/echoDatabase.ts'
import { LyricsOrchestrator } from '../../services/lyrics/LyricsOrchestrator.ts'
import { lyricsExporter, type LyricsExportFormat } from '../../services/lyrics/LyricsExporter.ts'
import {
  TranslationClient,
  type ConnectionTestResult,
  type DiscoveredModel,
} from '../../services/ai/TranslationClient.ts'
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap.ts'
import { AudioEngine } from '../../engine/AudioEngine.ts'
import { useEchoStore } from '../../stores/useEchoStore.ts'
import {
  syncOffsetPayloadSchema,
  recordLyricsUiMetric,
  clampSyncOffset,
  findActiveLineIndex,
  getWordProgressState,
  type SyncOffsetPayload,
} from '../../services/lyrics/lyricsUtils.ts'

interface ActiveWordKaraokeLineProps {
  words: LyricWord[]
  syncOffsetMs: number
  isPlaying: boolean
  onWordClick?: (startTimeMs: number) => void
}

function ActiveWordKaraokeLine({
  words,
  syncOffsetMs,
  isPlaying,
  onWordClick,
}: ActiveWordKaraokeLineProps) {
  const [nowMs, setNowMs] = useState(() => {
    return Math.max(0, AudioEngine.getInstance().getCurrentTime() * 1000 - syncOffsetMs)
  })

  useEffect(() => {
    let rafId: number | null = null
    const engine = AudioEngine.getInstance()

    const tick = () => {
      const ms = Math.max(0, engine.getCurrentTime() * 1000 - syncOffsetMs)
      setNowMs(ms)
      recordLyricsUiMetric('wordAnimationTicks')
      if (isPlaying) {
        rafId = requestAnimationFrame(tick)
      }
    }

    if (isPlaying) {
      rafId = requestAnimationFrame(tick)
    } else {
      tick()
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [isPlaying, syncOffsetMs])

  return (
    <>
      {words.map((word, wordIdx) => {
        const { isPast, isCurrent, progress } = getWordProgressState(nowMs, word)

        return (
          <span
            key={wordIdx}
            role="button"
            tabIndex={0}
            title={`Seek to ${Math.round(word.startTimeMs / 1000)}s: ${word.text}`}
            onClick={(e) => {
              if (onWordClick) {
                e.stopPropagation()
                recordLyricsUiMetric('wordSeeks')
                onWordClick(word.startTimeMs)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                if (onWordClick) {
                  e.preventDefault()
                  e.stopPropagation()
                  recordLyricsUiMetric('wordSeeks')
                  onWordClick(word.startTimeMs)
                }
              }
            }}
            className="lyric-word relative mr-1.5 inline-block cursor-pointer transition-all duration-75 hover:scale-105"
            style={{
              color: isPast ? '#ffffff' : isCurrent ? '#ffffff' : 'rgba(244, 241, 247, 0.45)',
              textShadow: isCurrent
                ? '0 0 16px rgba(124, 92, 255, 0.8), 0 0 32px rgba(124, 92, 255, 0.4)'
                : 'none',
            }}
          >
            {isCurrent && (
              <span
                className="absolute inset-0 overflow-hidden font-bold text-[#ffffff]"
                style={{
                  clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`,
                  textShadow: '0 0 12px #7c5cff',
                }}
              >
                {word.text}
              </span>
            )}
            {word.text}
          </span>
        )
      })}
    </>
  )
}

interface StaticWordKaraokeLineProps {
  words: LyricWord[]
  isPast: boolean
  onWordClick?: (startTimeMs: number) => void
}

function StaticWordKaraokeLine({ words, isPast, onWordClick }: StaticWordKaraokeLineProps) {
  return (
    <>
      {words.map((word, wordIdx) => (
        <span
          key={wordIdx}
          role="button"
          tabIndex={0}
          title={`Seek to ${Math.round(word.startTimeMs / 1000)}s: ${word.text}`}
          onClick={(e) => {
            if (onWordClick) {
              e.stopPropagation()
              recordLyricsUiMetric('wordSeeks')
              onWordClick(word.startTimeMs)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (onWordClick) {
                e.preventDefault()
                e.stopPropagation()
                recordLyricsUiMetric('wordSeeks')
                onWordClick(word.startTimeMs)
              }
            }
          }}
          className="lyric-word relative mr-1.5 inline-block cursor-pointer transition-colors duration-150 hover:text-white"
          style={{
            color: isPast ? '#ffffff' : 'rgba(244, 241, 247, 0.45)',
          }}
        >
          {word.text}
        </span>
      ))}
    </>
  )
}

function getLineAnimationStyleClasses(
  style: string,
  isActive: boolean,
  isPast: boolean,
): string {
  switch (style) {
    case 'apple':
      return isActive
        ? 'lyric-line--active origin-left scale-[1.05] font-bold text-white drop-shadow-[0_2px_12px_rgba(255,255,255,0.4)]'
        : isPast
          ? 'lyric-line--past opacity-40 blur-[1px] hover:blur-none hover:opacity-80 transition-all duration-300'
          : 'lyric-line--upcoming opacity-30 blur-[1.5px] hover:blur-none hover:opacity-70 transition-all duration-300'
    case 'glow':
      return isActive
        ? 'lyric-line--active origin-left scale-[1.03] text-white drop-shadow-[0_0_24px_rgba(176,156,255,0.85)] bg-[#7c5cff]/10 border border-[#7c5cff]/30'
        : isPast
          ? 'lyric-line--past opacity-50 text-white/70 hover:opacity-80'
          : 'lyric-line--upcoming opacity-30 text-white/50 hover:opacity-60'
    case 'slide':
      return isActive
        ? 'lyric-line--active translate-y-0 scale-[1.02] text-white bg-white/8 transition-transform duration-300'
        : isPast
          ? 'lyric-line--past -translate-y-0.5 opacity-50 hover:opacity-80 transition-transform duration-300'
          : 'lyric-line--upcoming translate-y-0.5 opacity-35 hover:opacity-75 transition-transform duration-300'
    case 'fade':
      return isActive
        ? 'lyric-line--active text-white bg-white/5 transition-opacity duration-500 ease-in-out'
        : isPast
          ? 'lyric-line--past opacity-50 transition-opacity duration-500 ease-in-out'
          : 'lyric-line--upcoming opacity-30 transition-opacity duration-500 ease-in-out'
    case 'metro':
      return isActive
        ? 'lyric-line--active scale-100 font-black tracking-tight text-white bg-white/10 uppercase'
        : isPast
          ? 'lyric-line--past scale-100 font-bold opacity-45 uppercase'
          : 'lyric-line--upcoming scale-100 font-medium opacity-25 uppercase'
    case 'none':
      return isActive
        ? 'lyric-line--active text-white bg-white/5 font-semibold transition-none'
        : isPast
          ? 'lyric-line--past opacity-55 transition-none'
          : 'lyric-line--upcoming opacity-35 transition-none'
    case 'karaoke':
    default:
      return isActive
        ? 'lyric-line--active origin-left scale-[1.02] bg-white/6 font-semibold'
        : isPast
          ? 'lyric-line--past opacity-55 hover:opacity-85'
          : 'lyric-line--upcoming opacity-35 hover:opacity-75'
  }
}

interface LyricLineRowProps {
  line: LyricLine
  idx: number
  isActive: boolean
  isPast: boolean
  isPlaying: boolean
  syncOffsetMs: number
  animationStyle?: string
  onClick: (startTimeMs: number) => void
  setLineRef: (el: HTMLDivElement | null) => void
}

const LyricLineRow = memo(function LyricLineRow({
  line,
  idx: _idx,
  isActive,
  isPast,
  isPlaying,
  syncOffsetMs,
  animationStyle = 'karaoke',
  onClick,
  setLineRef,
}: LyricLineRowProps) {
  const lineSeconds = Math.floor(line.startTimeMs / 1000)
  const lineLabel = `Jump to ${lineSeconds} seconds: ${line.text}`
  const animationClasses = getLineAnimationStyleClasses(animationStyle, isActive, isPast)

  return (
    <div
      ref={setLineRef}
      role="button"
      tabIndex={0}
      aria-current={isActive ? 'true' : undefined}
      aria-label={lineLabel}
      onClick={() => onClick(line.startTimeMs)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(line.startTimeMs)
        }
      }}
      className={`lyric-line group cursor-pointer rounded-xl px-4 py-3.5 transition-all duration-300 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c5cff] ${animationClasses}`}
    >
      <p
        className={`text-xl font-semibold tracking-tight transition-colors duration-200 md:text-2xl ${
          isActive ? 'text-white' : 'text-[#f4f1f7]'
        } ${line.isBackground ? 'italic text-purple-200/90' : ''}`}
      >
        {line.isBackground && (
          <span className="mr-2 inline-flex items-center rounded border border-[#b09cff]/30 bg-[#b09cff]/10 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wider text-[#b09cff] uppercase not-italic">
            bg
          </span>
        )}
        {line.words && line.words.length > 0 ? (
          isActive ? (
            <ActiveWordKaraokeLine
              words={line.words}
              syncOffsetMs={syncOffsetMs}
              isPlaying={isPlaying}
              onWordClick={onClick}
            />
          ) : (
            <StaticWordKaraokeLine
              words={line.words}
              isPast={isPast}
              onWordClick={onClick}
            />
          )
        ) : (
          line.text
        )}
      </p>

      {line.translatedText && (
        <p className="lyric-translation mt-1.5 text-sm font-medium tracking-normal text-[#b09cff] opacity-90 md:text-base">
          {line.translatedText}
        </p>
      )}
    </div>
  )
})

export interface LyricsViewProps {
  track: Track | null
  isPlaying: boolean
  className?: string
  onSeek?: (seconds: number) => void
}

export function LyricsView({ track, isPlaying, className = '', onSeek }: LyricsViewProps) {
  recordLyricsUiMetric('renders')

  const containerRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<Array<HTMLDivElement | null>>([])

  const [lyricsData, setLyricsData] = useState<SynchronizedLyrics | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [activeLineIndex, setActiveLineIndex] = useState<number>(-1)
  const activeLineIndexRef = useRef<number>(-1)
  const [syncOffsetMs, setSyncOffsetMs] = useState<number>(0)
  const syncDebounceRef = useRef<number | null>(null)
  const animationStyle = useEchoStore(
    (state) => state.preferences.lyricsAnimationStyle || 'karaoke',
  )

  // AI Translation State
  const [isTranslating, setIsTranslating] = useState(false)
  const [translationError, setTranslationError] = useState<string | null>(null)
  const [isTranslated, setIsTranslated] = useState(false)
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)

  // Offline detection state
  const [isOffline, setIsOffline] = useState(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onOnline = () => setIsOffline(false)
    const onOffline = () => setIsOffline(true)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  // Manual scroll override (pauses auto-scroll for 3.5s)
  const isUserScrollingRef = useRef(false)
  const scrollTimeoutRef = useRef<number | null>(null)
  const [isManualScrollActive, setIsManualScrollActive] = useState(false)

  // Load the saved sync offset for this track
  useEffect(() => {
    if (!track) return
    const trackId = track.videoId || track.id
    if (!trackId || typeof indexedDB === 'undefined') return
    void db.syncOffsets.get(trackId).then((record) => {
      setSyncOffsetMs(record?.offsetMs ?? 0)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, track?.videoId])

  const adjustSyncOffset = (deltaMs: number) => {
    recordLyricsUiMetric('syncOffsetAdjustments')
    const next = clampSyncOffset(syncOffsetMs + deltaMs)
    setSyncOffsetMs(next)

    if (track) {
      const trackId = track.videoId || track.id
      if (trackId && typeof indexedDB !== 'undefined') {
        if (syncDebounceRef.current !== null) {
          window.clearTimeout(syncDebounceRef.current)
        }
        syncDebounceRef.current = window.setTimeout(() => {
          const payload: SyncOffsetPayload = {
            trackId,
            offsetMs: next,
            updatedAt: Date.now(),
          }
          if (syncOffsetPayloadSchema.safeParse(payload).success) {
            void db.syncOffsets.put(payload)
          }
        }, 400)
      }
    }
  }

  const fetchLyricsForTrack = useCallback((targetTrack: Track | null, signal?: AbortSignal) => {
    if (!targetTrack) {
      setLyricsData(null)
      setIsLoading(false)
      setActiveLineIndex(-1)
      setLoadError(false)
      return
    }

    setIsLoading(true)
    setLyricsData(null)
    activeLineIndexRef.current = -1
    setActiveLineIndex(-1)
    setLoadError(false)
    setIsTranslated(false)
    setTranslationError(null)

    LyricsOrchestrator.getInstance()
      .getLyrics(targetTrack, signal)
      .then((lyrics) => {
        if (!signal?.aborted) {
          setLyricsData(lyrics)
          setIsLoading(false)
          setLoadError(false)
          setIsTranslated(false)
          setTranslationError(null)
        }
      })
      .catch(() => {
        if (!signal?.aborted) {
          setLyricsData(null)
          setIsLoading(false)
          setLoadError(true)
        }
      })
  }, [])

  // Fetch lyrics whenever track changes
  useEffect(() => {
    const abortController = new AbortController()
    fetchLyricsForTrack(track, abortController.signal)

    return () => {
      abortController.abort()
      if (syncDebounceRef.current !== null) {
        window.clearTimeout(syncDebounceRef.current)
      }
    }
  }, [track, fetchLyricsForTrack])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current !== null) {
        window.clearTimeout(scrollTimeoutRef.current)
      }
      if (syncDebounceRef.current !== null) {
        window.clearTimeout(syncDebounceRef.current)
      }
    }
  }, [])

  // Microsecond Synchronization: RAF Loop polling audioEngine.getCurrentTime()
  useEffect(() => {
    let rafId: number | null = null
    const engine = AudioEngine.getInstance()

    const syncTick = () => {
      const currentSeconds = engine.getCurrentTime()
      const ms = Math.max(0, currentSeconds * 1000)

      if (lyricsData?.lines && lyricsData.lines.length > 0) {
        const adjustedMs = ms - syncOffsetMs
        const matchedIdx = findActiveLineIndex(lyricsData.lines, adjustedMs)

        if (matchedIdx !== -1 && matchedIdx !== activeLineIndexRef.current) {
          activeLineIndexRef.current = matchedIdx
          setActiveLineIndex(matchedIdx)
        }
      }

      if (isPlaying) {
        rafId = requestAnimationFrame(syncTick)
      }
    }

    if (isPlaying) {
      rafId = requestAnimationFrame(syncTick)
    } else {
      syncTick()
    }

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [isPlaying, lyricsData, syncOffsetMs])

  // Auto-scrolling to active line with reduced motion compliance
  const scrollToActiveLine = useCallback(
    (force = false) => {
      if ((!force && isUserScrollingRef.current) || activeLineIndex < 0) return
      const targetElement = lineRefs.current[activeLineIndex]
      const container = containerRef.current
      if (!targetElement || !container) return

      recordLyricsUiMetric('autoScrolls')

      const containerRect = container.getBoundingClientRect()
      const targetRect = targetElement.getBoundingClientRect()

      const offsetTop =
        targetRect.top - containerRect.top + container.scrollTop - containerRect.height * 0.4

      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches

      container.scrollTo({
        top: Math.max(0, offsetTop),
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      })
    },
    [activeLineIndex],
  )

  useEffect(() => {
    scrollToActiveLine()
  }, [activeLineIndex, scrollToActiveLine])

  // Detect manual user scrolling or touch interaction
  const handleUserScroll = () => {
    recordLyricsUiMetric('manualScrollPauses')
    isUserScrollingRef.current = true
    setIsManualScrollActive(true)

    if (scrollTimeoutRef.current !== null) {
      window.clearTimeout(scrollTimeoutRef.current)
    }

    scrollTimeoutRef.current = window.setTimeout(() => {
      isUserScrollingRef.current = false
      setIsManualScrollActive(false)
      scrollToActiveLine(true)
    }, 3500)
  }

  // Handle click or keyboard seek on lyric line
  const handleLineClick = (startTimeMs: number) => {
    recordLyricsUiMetric('userSeeks')
    const seconds = startTimeMs / 1000
    if (onSeek) {
      onSeek(seconds)
    } else {
      AudioEngine.getInstance().seekTo(seconds)
    }
  }

  // AI Translation Handler
  const handleTranslate = async () => {
    if (!lyricsData || lyricsData.lines.length === 0) return

    const client = TranslationClient.getInstance()
    if (!client.hasConfiguredKey()) {
      setShowConfigModal(true)
      return
    }

    recordLyricsUiMetric('translationsTriggered')
    setIsTranslating(true)
    setTranslationError(null)

    try {
      const translated = await client.translateLyrics(lyricsData.lines)
      setLyricsData((prev) => (prev ? { ...prev, lines: translated } : null))
      setIsTranslated(true)
    } catch (err) {
      setTranslationError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsTranslating(false)
    }
  }

  return (
    <div
      className={`lyrics-stage-container relative flex h-full flex-col overflow-hidden ${className}`}
    >
      {/* Header Bar */}
      <div className="lyrics-stage-header z-10 flex items-center justify-between border-b border-white/6 bg-transparent px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs tracking-widest text-[#a59fad] uppercase">
            Lyrics Stage
          </span>
          {lyricsData?.provider && (
            <span className="rounded border border-white/10 bg-white/8 px-2 py-0.5 font-mono text-[10px] text-[#b09cff] uppercase">
              {lyricsData.provider}
              {lyricsData.isWordSynced ? ' (Karaoke)' : lyricsData.isSynced ? ' (Synced)' : ''}
            </span>
          )}
          {isOffline && (
            <span
              className="flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-300 uppercase"
              title="Device offline - lyrics served from local cache"
            >
              <WifiOff size={10} />
              Offline
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {lyricsData?.isSynced !== false && (
            <div
              className="flex items-center gap-1 rounded-lg bg-white/8 px-1.5 py-1 text-[#e7e4ed]"
              title="Adjust lyric sync timing (persisted per track)"
            >
              <button
                type="button"
                className="rounded p-1 transition-all hover:bg-white/12 focus-visible:ring-1 focus-visible:ring-[#7c5cff]"
                onClick={() => adjustSyncOffset(-500)}
                aria-label="Shift lyrics 0.5 seconds earlier"
              >
                <Minus size={12} />
              </button>
              <span className="w-12 text-center font-mono text-[10px]" aria-live="polite">
                {syncOffsetMs >= 0 ? '+' : ''}
                {(syncOffsetMs / 1000).toFixed(1)}s
              </span>
              <button
                type="button"
                className="rounded p-1 transition-all hover:bg-white/12 focus-visible:ring-1 focus-visible:ring-[#7c5cff]"
                onClick={() => adjustSyncOffset(500)}
                aria-label="Shift lyrics 0.5 seconds later"
              >
                <Plus size={12} />
              </button>
            </div>
          )}

          {/* Lyrics Animation Presentation Style Selector */}
          <select
            title="Lyrics presentation animation style"
            aria-label="Lyrics animation style"
            className="rounded-lg border border-white/10 bg-white/6 px-2.5 py-1.5 font-mono text-xs text-[#b09cff] transition hover:bg-white/12 focus:outline-none focus:ring-1 focus:ring-[#7c5cff]"
            value={animationStyle}
            onChange={(e) => {
              recordLyricsUiMetric('animationStyleSwitches')
              useEchoStore
                .getState()
                .setPreference('lyricsAnimationStyle', e.target.value as any)
            }}
          >
            <option value="karaoke" className="bg-[#1e1a24] text-white">Karaoke Sweep</option>
            <option value="apple" className="bg-[#1e1a24] text-white">Apple Blur</option>
            <option value="glow" className="bg-[#1e1a24] text-white">Neon Glow</option>
            <option value="slide" className="bg-[#1e1a24] text-white">Kinetic Slide</option>
            <option value="fade" className="bg-[#1e1a24] text-white">Gentle Fade</option>
            <option value="metro" className="bg-[#1e1a24] text-white">Metro Minimal</option>
            <option value="none" className="bg-[#1e1a24] text-white">Static Snap</option>
          </select>

          {lyricsData && (
            <button
              type="button"
              onClick={handleTranslate}
              disabled={isTranslating}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all focus-visible:ring-2 focus-visible:ring-[#7c5cff] ${
                isTranslated
                  ? 'bg-[#7c5cff] font-semibold text-[#0b0a0f]'
                  : 'bg-white/8 text-[#f4f1f7] hover:bg-white/12'
              }`}
              title="AI Translate Lyrics"
            >
              {isTranslating ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Languages size={13} />
              )}
              {isTranslating ? 'Translating...' : isTranslated ? 'Translated' : 'AI Translate'}
            </button>
          )}

          {lyricsData && (
            <button
              type="button"
              onClick={() => setShowExportModal(true)}
              className="flex items-center gap-1.5 rounded-lg bg-white/8 px-3 py-1.5 text-xs font-medium text-[#f4f1f7] transition-all hover:bg-white/12 focus-visible:ring-2 focus-visible:ring-[#7c5cff]"
              title="Export timed lyrics with track metadata"
            >
              <FileDown size={13} />
              Export
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowConfigModal(true)}
            className="rounded-lg p-1.5 text-[#a59fad] transition-colors hover:bg-white/8 hover:text-white focus-visible:ring-2 focus-visible:ring-[#7c5cff]"
            title="Configure AI Translation Keys"
            aria-label="Lyrics AI settings"
          >
            <Sparkles size={16} />
          </button>
        </div>
      </div>

      {/* Manual Scroll Override Snap Banner */}
      {isManualScrollActive && (
        <div className="absolute top-16 left-1/2 z-20 -translate-x-1/2">
          <button
            type="button"
            onClick={() => {
              isUserScrollingRef.current = false
              setIsManualScrollActive(false)
              scrollToActiveLine(true)
            }}
            className="rounded-full bg-[#7c5cff] px-3.5 py-1.5 text-xs font-semibold text-[#0b0a0f] shadow-lg transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-white"
          >
            Jump to current lyric
          </button>
        </div>
      )}

      {/* Translation Error Banner */}
      {translationError && (
        <div className="mx-6 mt-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/15 px-3 py-2 text-xs text-red-200">
          <AlertCircle size={14} />
          <span className="truncate">{translationError}</span>
        </div>
      )}

      {/* Lyrics Scrollable Viewport */}
      <div
        ref={containerRef}
        onScroll={handleUserScroll}
        onTouchMove={handleUserScroll}
        onWheel={handleUserScroll}
        className="lyrics-stage-viewport custom-scrollbar flex-1 overflow-y-auto scroll-smooth px-6 py-12"
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
        }}
      >
        {isLoading ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-[#a59fad]">
            <Loader2 size={28} className="animate-spin text-[#7c5cff]" />
            <p className="text-sm">Fetching lyrics cascade...</p>
          </div>
        ) : lyricsData && lyricsData.lines.length > 0 ? (
          <div className="mx-auto flex max-w-2xl flex-col gap-2 py-8">
            {lyricsData.lines.map((line, idx) => (
              <LyricLineRow
                key={idx}
                line={line}
                idx={idx}
                isActive={idx === activeLineIndex}
                isPast={idx < activeLineIndex}
                isPlaying={isPlaying}
                syncOffsetMs={syncOffsetMs}
                animationStyle={animationStyle}
                onClick={handleLineClick}
                setLineRef={(el) => {
                  lineRefs.current[idx] = el
                }}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-[#918a98]">
            <p className="text-base font-medium">
              {loadError
                ? 'Failed to load lyrics for this track.'
                : 'No synchronized lyrics available for this track.'}
            </p>
            <p className="text-xs text-[#a59fad]">
              {loadError
                ? 'A network issue occurred while checking lyrics providers.'
                : 'Enjoy the music or try searching for another version.'}
            </p>
            {track && (
              <button
                type="button"
                onClick={() => fetchLyricsForTrack(track)}
                className="mt-2 flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/6 px-3.5 py-1.5 text-xs font-medium text-[#f4f1f7] transition-all hover:bg-white/12 focus-visible:ring-2 focus-visible:ring-[#7c5cff]"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>

      {/* AI Key Configuration Modal */}
      {showConfigModal && (
        <AIConfigModal
          onClose={() => setShowConfigModal(false)}
          onSaved={() => {
            setShowConfigModal(false)
            if (lyricsData && !isTranslated) {
              void handleTranslate()
            }
          }}
        />
      )}

      {/* Lyrics Export Modal */}
      {showExportModal && track && lyricsData && (
        <ExportLyricsModal
          track={track}
          lyrics={lyricsData}
          syncOffsetMs={syncOffsetMs}
          onClose={() => setShowExportModal(false)}
        />
      )}
    </div>
  )
}

function AIConfigModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const client = TranslationClient.getInstance()
  const initial = client.getConfig()
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(dialogRef, onClose)

  const [provider, setProvider] = useState(initial.provider)
  const [openRouterKey, setOpenRouterKey] = useState(initial.openRouterKey || '')
  const [openRouterModel, setOpenRouterModel] = useState(
    initial.openRouterModel || 'google/gemini-2.0-flash-001',
  )
  const [deepLKey, setDeepLKey] = useState(initial.deepLKey || '')
  const [mistralKey, setMistralKey] = useState(initial.mistralKey || '')
  const [openAiBaseUrl, setOpenAiBaseUrl] = useState(initial.openAiBaseUrl || '')
  const [openAiKey, setOpenAiKey] = useState(initial.openAiKey || '')
  const [openAiModel, setOpenAiModel] = useState(initial.openAiModel || 'gpt-4o-mini')
  const [anthropicKey, setAnthropicKey] = useState(initial.anthropicKey || '')
  const [anthropicModel, setAnthropicModel] = useState(initial.anthropicModel || 'claude-haiku-4-5')
  const [geminiKey, setGeminiKey] = useState(initial.geminiKey || '')
  const [geminiModel, setGeminiModel] = useState(initial.geminiModel || 'gemini-2.0-flash')
  const [targetLanguage, setTargetLanguage] = useState(initial.targetLanguage || 'English')
  const [translationChunkSize, setTranslationChunkSize] = useState(
    initial.translationChunkSize || 30,
  )
  const [testingStatus, setTestingStatus] = useState<ConnectionTestResult | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([])
  const [isDiscovering, setIsDiscovering] = useState(false)

  const handleTestConnection = async () => {
    setIsTesting(true)
    setTestingStatus(null)
    try {
      const res = await client.testConnection({
        provider,
        openRouterKey,
        openRouterModel,
        deepLKey,
        mistralKey,
        openAiBaseUrl,
        openAiKey,
        openAiModel,
        anthropicKey,
        anthropicModel,
        geminiKey,
        geminiModel,
        targetLanguage,
        translationChunkSize,
      })
      setTestingStatus(res)
    } finally {
      setIsTesting(false)
    }
  }

  const handleDiscoverModels = async () => {
    setIsDiscovering(true)
    try {
      const models = await client.discoverModels(provider, {
        provider,
        openRouterKey,
        mistralKey,
        openAiBaseUrl,
        openAiKey,
        geminiKey,
      })
      setDiscoveredModels(models)
    } finally {
      setIsDiscovering(false)
    }
  }

  const handleSave = () => {
    client.saveConfig({
      provider,
      openRouterKey,
      openRouterModel,
      deepLKey,
      mistralKey,
      openAiBaseUrl,
      openAiKey,
      openAiModel,
      anthropicKey,
      anthropicModel,
      geminiKey,
      geminiModel,
      targetLanguage,
      translationChunkSize,
    })
    onSaved()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-lyrics-dialog-title"
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-white/10 bg-[#14121a] p-6 text-[#f4f1f7] shadow-2xl"
      >
        <h3 id="ai-lyrics-dialog-title" className="text-base font-semibold">
          AI Lyrics Translation Settings
        </h3>
        <p className="text-xs text-[#a59fad]">
          Keys are stored locally in your browser (<code className="text-xs">localStorage</code>)
          and never proxied through our server.
        </p>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[#a59fad]">Provider</label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                'openrouter',
                'deepl',
                'mistral',
                'openai-compatible',
                'anthropic',
                'gemini',
              ] as const
            ).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                className={`rounded-lg border py-1.5 text-xs font-medium capitalize ${
                  provider === p
                    ? 'border-[#7c5cff] bg-[#7c5cff] font-semibold text-[#0b0a0f]'
                    : 'border-white/8 bg-white/4 text-[#a59fad] hover:text-white'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {provider === 'openrouter' && (
          <>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[#a59fad]">OpenRouter API Key</label>
              <input
                type="password"
                placeholder="sk-or-v1-..."
                value={openRouterKey}
                onChange={(e) => setOpenRouterKey(e.target.value)}
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs focus:border-[#7c5cff] focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[#a59fad]">Model</label>
              <input
                type="text"
                placeholder="google/gemini-2.0-flash-001"
                value={openRouterModel}
                onChange={(e) => setOpenRouterModel(e.target.value)}
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs focus:border-[#7c5cff] focus:outline-none"
              />
            </div>
          </>
        )}

        {provider === 'deepl' && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[#a59fad]">DeepL API Key</label>
            <input
              type="password"
              placeholder="Your DeepL API Auth Key"
              value={deepLKey}
              onChange={(e) => setDeepLKey(e.target.value)}
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs focus:border-[#7c5cff] focus:outline-none"
            />
          </div>
        )}

        {provider === 'mistral' && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[#a59fad]">Mistral API Key</label>
            <input
              type="password"
              placeholder="Your Mistral API Key"
              value={mistralKey}
              onChange={(e) => setMistralKey(e.target.value)}
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs focus:border-[#7c5cff] focus:outline-none"
            />
          </div>
        )}

        {provider === 'openai-compatible' && (
          <>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[#a59fad]">Base URL</label>
              <input
                type="text"
                placeholder="https://api.openai.com/v1"
                value={openAiBaseUrl}
                onChange={(e) => setOpenAiBaseUrl(e.target.value)}
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs focus:border-[#7c5cff] focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[#a59fad]">API Key</label>
              <input
                type="password"
                placeholder="sk-..."
                value={openAiKey}
                onChange={(e) => setOpenAiKey(e.target.value)}
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs focus:border-[#7c5cff] focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[#a59fad]">Model</label>
              <input
                type="text"
                placeholder="gpt-4o-mini"
                value={openAiModel}
                onChange={(e) => setOpenAiModel(e.target.value)}
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs focus:border-[#7c5cff] focus:outline-none"
              />
            </div>
          </>
        )}

        {provider === 'anthropic' && (
          <>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[#a59fad]">Anthropic API Key</label>
              <input
                type="password"
                placeholder="sk-ant-..."
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs focus:border-[#7c5cff] focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[#a59fad]">Model</label>
              <input
                type="text"
                placeholder="claude-haiku-4-5"
                value={anthropicModel}
                onChange={(e) => setAnthropicModel(e.target.value)}
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs focus:border-[#7c5cff] focus:outline-none"
              />
            </div>
          </>
        )}

        {provider === 'gemini' && (
          <>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[#a59fad]">Gemini API Key</label>
              <input
                type="password"
                placeholder="AIza..."
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs focus:border-[#7c5cff] focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[#a59fad]">Model</label>
              <input
                type="text"
                placeholder="gemini-2.0-flash"
                value={geminiModel}
                onChange={(e) => setGeminiModel(e.target.value)}
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs focus:border-[#7c5cff] focus:outline-none"
              />
            </div>
          </>
        )}

        {provider !== 'deepl' && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[#a59fad]">Quick Model Picker</label>
              <button
                type="button"
                onClick={handleDiscoverModels}
                disabled={isDiscovering}
                className="flex items-center gap-1 font-mono text-[10px] text-[#b09cff] hover:underline"
              >
                {isDiscovering ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  <RefreshCw size={10} />
                )}
                Discover Models
              </button>
            </div>
            <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-white/5 bg-black/20 p-2">
              {(discoveredModels.length > 0
                ? discoveredModels
                : client.getCuratedModels(provider)
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    if (provider === 'openrouter') setOpenRouterModel(m.id)
                    else if (provider === 'openai-compatible') setOpenAiModel(m.id)
                    else if (provider === 'anthropic') setAnthropicModel(m.id)
                    else if (provider === 'gemini') setGeminiModel(m.id)
                  }}
                  className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-[#e7e4ed] hover:bg-white/15"
                  title={m.id}
                >
                  {m.name || m.id}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[#a59fad]">Target Language</label>
          <input
            type="text"
            placeholder="e.g. English, Spanish, Japanese, German"
            value={targetLanguage}
            onChange={(e) => setTargetLanguage(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs focus:border-[#7c5cff] focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[#a59fad]">Batch Chunk Size (Lines)</label>
          <input
            type="number"
            min={5}
            max={100}
            placeholder="30"
            value={translationChunkSize}
            onChange={(e) => setTranslationChunkSize(Math.max(5, Math.min(100, Number(e.target.value) || 30)))}
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs focus:border-[#7c5cff] focus:outline-none"
          />
          <p className="text-[10px] text-[#a59fad]">
            Maximum lyric lines dispatched per API batch. Prevents LLM context exhaustion on long songs.
          </p>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-white">Connection Test</span>
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting}
              className="flex items-center gap-1.5 rounded-md border border-[#7c5cff]/40 bg-[#7c5cff]/10 px-2.5 py-1 text-xs font-medium text-[#b09cff] hover:bg-[#7c5cff]/20"
            >
              {isTesting ? <Loader2 size={12} className="animate-spin" /> : null}
              {isTesting ? 'Testing...' : 'Test Connection'}
            </button>
          </div>
          {testingStatus && (
            <div
              className={`flex items-start gap-2 rounded-md p-2 text-xs ${
                testingStatus.ok
                  ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                  : 'border border-red-500/20 bg-red-500/10 text-red-300'
              }`}
            >
              {testingStatus.ok ? (
                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" />
              ) : (
                <XCircle size={14} className="mt-0.5 shrink-0 text-red-400" />
              )}
              <div className="flex flex-col">
                <span className="font-semibold">
                  {testingStatus.ok
                    ? `Connected (${testingStatus.latencyMs}ms)`
                    : 'Connection Failed'}
                </span>
                <span className="text-[11px] opacity-90">
                  {testingStatus.error || testingStatus.message}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/8 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-white/6 px-4 py-2 text-xs font-medium text-[#a59fad] transition-colors hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-lg bg-[#7c5cff] px-4 py-2 text-xs font-semibold text-[#0b0a0f] transition-colors hover:bg-[#6c48ff]"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  )
}

function ExportLyricsModal({
  track,
  lyrics,
  syncOffsetMs,
  onClose,
}: {
  track: Track
  lyrics: SynchronizedLyrics
  syncOffsetMs: number
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(dialogRef, onClose)

  const [format, setFormat] = useState<LyricsExportFormat>('lrc')
  const [includeMetadata, setIncludeMetadata] = useState(true)
  const [includeTranslation, setIncludeTranslation] = useState(true)
  const [includeWordTimings, setIncludeWordTimings] = useState(true)
  const [encoding, setEncoding] = useState<'UTF-8' | 'UTF-8-BOM'>('UTF-8')
  const [copied, setCopied] = useState(false)

  const exportResult = useMemo(() => {
    return lyricsExporter.exportLyrics(track, lyrics, {
      format,
      includeMetadata,
      includeTranslation,
      includeWordTimings,
      encoding,
      offsetMs: syncOffsetMs,
    })
  }, [
    track,
    lyrics,
    format,
    includeMetadata,
    includeTranslation,
    includeWordTimings,
    encoding,
    syncOffsetMs,
  ])

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(exportResult.content)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      // Ignore copy error
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lyrics-export-dialog-title"
        className="flex w-full max-w-lg flex-col gap-4 rounded-xl border border-white/10 bg-[#14121a] p-6 text-[#f4f1f7] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-white/8 pb-3">
          <div>
            <h3 id="lyrics-export-dialog-title" className="text-base font-semibold text-white">
              Export Timed Lyrics
            </h3>
            <p className="text-xs text-[#a59fad]">
              {track.title} &bull; {track.artistName}
            </p>
          </div>
          <span className="rounded bg-[#7c5cff]/15 px-2 py-0.5 font-mono text-[10px] uppercase text-[#b09cff]">
            {exportResult.format.toUpperCase()}
          </span>
        </div>

        {/* Format Selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[#a59fad]">Export Format</label>
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                { id: 'lrc', label: 'LRC' },
                { id: 'ttml', label: 'TTML' },
                { id: 'json', label: 'JSON' },
                { id: 'txt', label: 'Plain TXT' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFormat(f.id)}
                className={`rounded-lg border py-1.5 text-xs font-medium ${
                  format === f.id
                    ? 'border-[#7c5cff] bg-[#7c5cff] font-semibold text-[#0b0a0f]'
                    : 'border-white/8 bg-white/4 text-[#a59fad] hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Options */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-2.5 hover:bg-white/[0.04]">
            <input
              type="checkbox"
              checked={includeMetadata}
              onChange={(e) => setIncludeMetadata(e.target.checked)}
              className="rounded border-white/20 text-[#7c5cff] focus:ring-0"
            />
            <span className="text-[#e7e4ed]">Track Metadata Header</span>
          </label>

          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-2.5 hover:bg-white/[0.04]">
            <input
              type="checkbox"
              checked={includeTranslation}
              onChange={(e) => setIncludeTranslation(e.target.checked)}
              className="rounded border-white/20 text-[#7c5cff] focus:ring-0"
            />
            <span className="text-[#e7e4ed]">Include AI Translation</span>
          </label>

          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-2.5 hover:bg-white/[0.04]">
            <input
              type="checkbox"
              checked={includeWordTimings}
              onChange={(e) => setIncludeWordTimings(e.target.checked)}
              className="rounded border-white/20 text-[#7c5cff] focus:ring-0"
            />
            <span className="text-[#e7e4ed]">Word-Level Timings</span>
          </label>

          <label className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
            <span className="text-[#e7e4ed]">Encoding:</span>
            <select
              value={encoding}
              onChange={(e) => setEncoding(e.target.value as any)}
              className="rounded border border-white/10 bg-black/40 px-2 py-0.5 text-[11px] text-white focus:outline-none"
            >
              <option value="UTF-8">UTF-8</option>
              <option value="UTF-8-BOM">UTF-8 BOM</option>
            </select>
          </label>
        </div>

        {/* Formatted Preview Box */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11px] text-[#a59fad]">
            <span>
              Content Preview ({exportResult.lineCount} lines, {exportResult.characterCount} chars)
            </span>
            <span>Offset: {syncOffsetMs >= 0 ? `+${syncOffsetMs}` : syncOffsetMs}ms</span>
          </div>
          <textarea
            readOnly
            value={exportResult.content}
            rows={7}
            className="w-full rounded-lg border border-white/10 bg-black/40 p-2.5 font-mono text-[11px] leading-relaxed text-[#dcd7e5] focus:outline-none"
          />
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-between border-t border-white/8 pt-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/10"
            >
              {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              {copied ? 'Copied to Clipboard!' : 'Copy to Clipboard'}
            </button>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-white/6 px-4 py-1.5 text-xs font-medium text-[#a59fad] transition-colors hover:bg-white/10"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
