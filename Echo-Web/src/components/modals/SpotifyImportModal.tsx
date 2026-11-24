import { useState, useRef, useEffect } from 'react'
import { Check, Download, Music2, Play, Sparkles, X, AlertCircle, WifiOff, RotateCcw } from 'lucide-react'
import {
  importFromSpotify,
  isSpotifyUrl,
  type SpotifyImportProgress,
  type SpotifyImportResult,
} from '../../services/spotify/spotifyImporter.ts'
import { useEchoStore } from '../../stores/useEchoStore'
import { useAudioEngine } from '../../hooks/useAudioEngine'
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap'
import { db } from '../../services/db/echoDatabase'
import { recordSpotifyTasteSignals } from '../../services/spotify/spotifyRecommendationBridge.ts'

interface SpotifyImportModalProps {
  isOpen: boolean
  onClose: () => void
}

export function SpotifyImportModal({ isOpen, onClose }: SpotifyImportModalProps) {
  const [urlInput, setUrlInput] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [progress, setProgress] = useState<SpotifyImportProgress | null>(null)
  const [result, setResult] = useState<SpotifyImportResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isOffline, setIsOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine)

  const importAbortRef = useRef<AbortController | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useModalFocusTrap(dialogRef, onClose, isOpen)

  const createPlaylist = useEchoStore((state) => state.createPlaylist)
  const addTrackToPlaylist = useEchoStore((state) => state.addTrackToPlaylist)
  const setToast = useEchoStore((state) => state.setToast)
  const { playQueue } = useAudioEngine()

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

  // Auto-focus input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
    }
  }, [isOpen])

  const handleStartImport = async () => {
    if (isOffline) {
      setErrorMsg('You are currently offline. Connect to the internet to import Spotify links.')
      return
    }

    if (!urlInput.trim()) {
      setErrorMsg('Please paste a Spotify URL')
      return
    }

    if (!isSpotifyUrl(urlInput)) {
      setErrorMsg('Not a valid Spotify link (must be open.spotify.com/playlist, album, or track)')
      return
    }

    setIsImporting(true)
    setErrorMsg(null)
    setProgress(null)
    setResult(null)

    const abort = new AbortController()
    importAbortRef.current = abort

    try {
      const res = await importFromSpotify(
        urlInput,
        (prog) => {
          setProgress(prog)
        },
        abort.signal,
      )
      setResult(res)
    } catch (err) {
      if (abort.signal.aborted) {
        setToast('Import cancelled')
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Spotify import failed')
      }
    } finally {
      importAbortRef.current = null
      setIsImporting(false)
    }
  }

  const handleCancelImport = () => {
    importAbortRef.current?.abort()
    setIsImporting(false)
  }

  const handleSaveToEcho = async () => {
    if (!result || result.matchedTracks.length === 0) return

    const playlistId = createPlaylist(result.title, result.description)
    for (const track of result.matchedTracks) {
      addTrackToPlaylist(playlistId, track)
    }

    // Also persist in Dexie database
    await db.playlists.put({
      id: playlistId,
      title: result.title,
      description: result.description,
      coverUrl: result.coverUrl,
      trackIds: result.matchedTracks.map((t) => t.id),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    // Bridge taste signals from imported Spotify tracks
    try {
      await recordSpotifyTasteSignals(result.matchedTracks, { sourcePlaylist: result.title })
    } catch {
      // Non-fatal telemetry/bridge failure
    }

    setToast(`Saved "${result.title}" (${result.matchedTracks.length} tracks)`)
    handleClose()
  }

  const handlePlayNow = () => {
    if (!result || result.matchedTracks.length === 0) return
    try {
      recordSpotifyTasteSignals(result.matchedTracks, { sourcePlaylist: result.title })
    } catch {}
    playQueue(result.matchedTracks, 0)
    setToast(`Playing "${result.title}"`)
    handleClose()
  }

  const handleClose = () => {
    if (importAbortRef.current) {
      importAbortRef.current.abort()
      importAbortRef.current = null
    }
    setIsImporting(false)
    setProgress(null)
    setResult(null)
    setErrorMsg(null)
    onClose()
  }

  const handleResetForAnother = () => {
    setResult(null)
    setProgress(null)
    setErrorMsg(null)
    setUrlInput('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  if (!isOpen) return null

  const progressPercent =
    progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="spotify-import-modal-title"
    >
      <div
        ref={dialogRef}
        className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#16141e] p-6 text-[#f4f1f7] shadow-2xl"
      >
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-4 right-4 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-white/4 p-2 text-[#a59fad] transition-colors hover:bg-white/8 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#58ad83]"
          title="Close (Esc)"
          aria-label="Close Spotify import dialog"
        >
          <X size={18} />
        </button>

        <div className="mb-4 flex items-center gap-2.5">
          <div className="rounded-xl bg-[#58ad83]/15 p-2 text-[#58ad83]" aria-hidden="true">
            <Music2 size={20} />
          </div>
          <div>
            <h2 id="spotify-import-modal-title" className="text-lg leading-tight font-bold text-white">
              Import from Spotify
            </h2>
            <p className="text-xs text-[#a59fad]">
              Convert any public Spotify playlist, album, or track into Echo.
            </p>
          </div>
        </div>

        {isOffline && (
          <div
            className="mb-4 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-300"
            role="status"
          >
            <WifiOff size={16} className="shrink-0" />
            <span>Offline: converting Spotify links requires an active network connection</span>
          </div>
        )}

        {errorMsg && (
          <div
            className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300"
            role="alert"
          >
            <AlertCircle size={16} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {!result ? (
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="spotify-url-input" className="mb-1.5 block text-xs font-medium text-[#a59fad]">
                Spotify Share Link
              </label>
              <input
                id="spotify-url-input"
                ref={inputRef}
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isImporting && urlInput.trim()) {
                    e.preventDefault()
                    void handleStartImport()
                  }
                }}
                placeholder="https://open.spotify.com/playlist/..."
                disabled={isImporting}
                className="w-full rounded-xl border border-white/10 bg-white/4 px-3.5 py-2.5 text-sm text-white focus:border-[#58ad83] focus:outline-none focus:ring-2 focus:ring-[#58ad83]"
              />
            </div>

            {/* Progress indicator during resolution */}
            {isImporting && progress && (
              <div
                className="flex flex-col gap-2 rounded-xl border border-white/6 bg-white/3 p-4"
                role="status"
                aria-live="polite"
              >
                <div className="flex justify-between text-xs text-[#a59fad]">
                  <span className="max-w-[280px] truncate">{progress.currentTitle}</span>
                  <span className="font-mono">
                    {progress.current} / {progress.total} ({progressPercent}%)
                  </span>
                </div>
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-white/10"
                  role="progressbar"
                  aria-valuenow={progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Track matching progress"
                >
                  <div
                    className="h-full bg-[#58ad83] transition-all duration-150"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleStartImport}
                disabled={isImporting || !urlInput.trim() || isOffline}
                className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#58ad83] px-4 py-2.5 text-xs font-semibold text-black shadow-md transition-all hover:bg-[#489972] focus:outline-none focus:ring-2 focus:ring-[#58ad83] disabled:opacity-50"
              >
                {isImporting ? (
                  <>
                    <Sparkles size={15} className="animate-spin" />
                    <span>Matching tracks against YouTube catalog...</span>
                  </>
                ) : (
                  <>
                    <Download size={15} />
                    <span>Import Playlist</span>
                  </>
                )}
              </button>
              {isImporting && (
                <button
                  type="button"
                  onClick={handleCancelImport}
                  className="flex min-h-[44px] items-center justify-center rounded-xl bg-white/8 px-4 py-2.5 text-xs font-semibold text-white transition-all hover:bg-white/12 focus:outline-none focus:ring-2 focus:ring-[#58ad83]"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : result.matchedTracks.length === 0 ? (
          /* Empty match state */
          <div className="flex flex-col gap-4 text-center">
            <div className="rounded-xl border border-white/6 bg-white/3 p-6">
              <p className="text-sm font-semibold text-white">No songs could be matched</p>
              <p className="mt-1 text-xs text-[#a59fad]">
                We could not find matching tracks in the YouTube Music catalog for "{result.title}".
              </p>
            </div>
            <button
              type="button"
              onClick={handleResetForAnother}
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-white/8 px-4 py-2.5 text-xs font-semibold text-white transition-all hover:bg-white/12 focus:outline-none focus:ring-2 focus:ring-[#58ad83]"
            >
              <RotateCcw size={15} />
              <span>Try Another Spotify Link</span>
            </button>
          </div>
        ) : (
          /* Result Summary Stage */
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4 rounded-xl border border-white/8 bg-white/4 p-4">
              {result.coverUrl && (
                <img
                  src={result.coverUrl}
                  alt={result.title}
                  className="h-16 w-16 shrink-0 rounded-lg border border-white/10 bg-black/40 object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-bold text-white">{result.title}</h3>
                <p className="mt-0.5 text-xs text-[#a59fad]">
                  Successfully matched {result.matchedTracks.length} of {result.totalSpotifyTracks}{' '}
                  songs.
                </p>
              </div>
            </div>

            {/* Preview of first few matched tracks */}
            <div className="custom-scrollbar flex max-h-44 flex-col gap-1 overflow-y-auto pr-1">
              {result.matchedTracks.slice(0, 10).map((t, idx) => (
                <div
                  key={t.id + idx}
                  className="flex items-center justify-between rounded-lg border border-white/4 bg-white/2 px-3 py-1.5 text-xs"
                >
                  <span className="truncate font-medium text-white">
                    {idx + 1}. {t.title}
                  </span>
                  <span className="ml-2 truncate text-[11px] text-[#a59fad]">{t.artistName}</span>
                </div>
              ))}
              {result.matchedTracks.length > 10 && (
                <span className="py-1 text-center text-[11px] text-[#a59fad]">
                  + {result.matchedTracks.length - 10} more tracks
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleSaveToEcho}
                className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#7c5cff] px-4 py-2.5 text-xs font-semibold text-black shadow-md transition-all hover:bg-[#6c48ff] focus:outline-none focus:ring-2 focus:ring-[#7c5cff]"
              >
                <Check size={15} />
                <span>Save to Library</span>
              </button>
              <button
                type="button"
                onClick={handlePlayNow}
                className="flex min-h-[44px] items-center gap-2 rounded-xl bg-white/8 px-4 py-2.5 text-xs font-semibold text-white transition-all hover:bg-white/12 focus:outline-none focus:ring-2 focus:ring-[#7c5cff]"
              >
                <Play size={15} fill="currentColor" />
                <span>Play Now</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
