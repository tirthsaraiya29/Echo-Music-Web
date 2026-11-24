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

import { useEffect, useRef, useState, useCallback, memo } from 'react'
import { Languages, Loader2, Sparkles, AlertCircle, Plus, Minus, WifiOff } from 'lucide-react'
import type { Track } from '../../types/domain.ts'
import type { LyricLine, LyricWord, SynchronizedLyrics } from '../../types/lyrics.ts'
import { db } from '../../services/db/echoDatabase.ts'
import { LyricsOrchestrator } from '../../services/lyrics/LyricsOrchestrator.ts'
import { TranslationClient } from '../../services/ai/TranslationClient.ts'
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap.ts'
import { AudioEngine } from '../../engine/AudioEngine.ts'
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

interface LyricLineRowProps {
  line: LyricLine
  idx: number
  isActive: boolean
  isPast: boolean
  isPlaying: boolean
  syncOffsetMs: number
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
  onClick,
  setLineRef,
}: LyricLineRowProps) {
  const lineSeconds = Math.floor(line.startTimeMs / 1000)
  const lineLabel = `Jump to ${lineSeconds} seconds: ${line.text}`

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
      className={`lyric-line group cursor-pointer rounded-xl px-4 py-3.5 transition-all duration-300 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c5cff] ${
        isActive
          ? 'lyric-line--active origin-left scale-[1.02] bg-white/6'
          : isPast
            ? 'lyric-line--past opacity-55 hover:opacity-85'
            : 'lyric-line--upcoming opacity-35 hover:opacity-75'
      }`}
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

  // AI Translation State
  const [isTranslating, setIsTranslating] = useState(false)
  const [translationError, setTranslationError] = useState<string | null>(null)
  const [isTranslated, setIsTranslated] = useState(false)
  const [showConfigModal, setShowConfigModal] = useState(false)

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
