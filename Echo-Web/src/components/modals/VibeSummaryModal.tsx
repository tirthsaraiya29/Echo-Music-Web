/**
 * Vibe Summary Modal Component for Echo Music Web
 *
 * Displays personalized listening archetype, dominant mood,
 * time-of-day distribution, top genres, and top artists.
 */

import { useState, useEffect } from 'react'
import {
  Sparkles,
  X,
  Share2,
  Clock,
  Music,
  Headphones,
  CheckCircle,
  Flame,
  Sun,
  Moon,
  Sunset,
  Sunrise,
} from 'lucide-react'
import {
  fetchCurrentVibeSummary,
  recordVibeMetric,
  type VibeSummary,
} from '../../services/history/vibeSummaryService.ts'
import { useEchoStore } from '../../stores/useEchoStore.ts'

export interface VibeSummaryModalProps {
  isOpen: boolean
  onClose: () => void
}

export function VibeSummaryModal({ isOpen, onClose }: VibeSummaryModalProps) {
  const [summary, setSummary] = useState<VibeSummary | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const setToast = useEchoStore((state) => state.setToast)

  useEffect(() => {
    if (!isOpen) return
    setIsLoading(true)
    fetchCurrentVibeSummary()
      .then((data) => setSummary(data))
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [isOpen])

  if (!isOpen) return null

  const handleShareVibe = () => {
    if (!summary) return
    recordVibeMetric('vibesSharedCount')
    const shareText = `🎵 My Echo Music Vibe: ${summary.archetype} (${summary.headline}) — ${summary.totalListeningMinutes} mins listened! Top genres: ${summary.topGenres.map((g) => g.name).join(', ')}.`

    if (navigator.clipboard) {
      void navigator.clipboard.writeText(shareText)
      setToast('Vibe summary copied to clipboard!')
    } else {
      setToast(`Your Vibe: ${summary.archetype}`)
    }
  }

  const getTimeIcon = (tod: string) => {
    switch (tod) {
      case 'morning':
        return <Sunrise size={16} className="text-amber-300" />
      case 'afternoon':
        return <Sun size={16} className="text-amber-400" />
      case 'evening':
        return <Sunset size={16} className="text-rose-400" />
      case 'night':
        return <Moon size={16} className="text-indigo-300" />
      default:
        return <Clock size={16} className="text-[#b09cff]" />
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[#161224] p-6 shadow-2xl">
        {/* Background gradient flare */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#7c5cff]/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-rose-500/15 blur-3xl" />

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full bg-white/5 p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Close vibe summary"
        >
          <X size={18} />
        </button>

        {isLoading || !summary ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-white/50">
            <Sparkles size={32} className="animate-spin text-[#b09cff]" />
            <p className="mt-3 text-sm">Synthesizing your sonic vibe...</p>
          </div>
        ) : (
          <div className="relative z-10 space-y-6">
            {/* Header Badge & Archetype */}
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-[#7c5cff]/30 bg-[#7c5cff]/10 px-3 py-1 text-xs font-medium text-[#b09cff]">
                <Sparkles size={13} />
                <span>Echo Vibe Summary</span>
              </div>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {summary.archetype}
              </h2>
              <p className="mt-1 text-sm font-semibold text-[#b09cff]">{summary.headline}</p>
              <p className="mt-2 text-xs leading-relaxed text-white/70">{summary.description}</p>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-white/6 bg-white/3 p-3">
                <span className="flex items-center gap-1 text-[11px] text-[#a59fad]">
                  <Clock size={13} /> Total Time
                </span>
                <strong className="mt-1 block font-mono text-base text-white">
                  {summary.totalListeningMinutes} <span className="text-xs font-normal">min</span>
                </strong>
              </div>

              <div className="rounded-xl border border-white/6 bg-white/3 p-3">
                <span className="flex items-center gap-1 text-[11px] text-[#a59fad]">
                  <Music size={13} /> Tracks
                </span>
                <strong className="mt-1 block font-mono text-base text-white">
                  {summary.totalTracksListened}
                </strong>
              </div>

              <div className="rounded-xl border border-white/6 bg-white/3 p-3">
                <span className="flex items-center gap-1 text-[11px] text-[#a59fad]">
                  <CheckCircle size={13} /> Focus Rate
                </span>
                <strong className="mt-1 block font-mono text-base text-white">
                  {summary.completionRatePct}%
                </strong>
              </div>

              <div className="rounded-xl border border-white/6 bg-white/3 p-3">
                <span className="flex items-center gap-1 text-[11px] text-[#a59fad]">
                  {getTimeIcon(summary.dominantTimeOfDay)} Peak Hour
                </span>
                <strong className="mt-1 block font-mono text-xs capitalize text-white">
                  {summary.dominantTimeOfDay}
                </strong>
              </div>
            </div>

            {/* Top Genres Breakdown */}
            {summary.topGenres.length > 0 && (
              <div className="rounded-xl border border-white/6 bg-white/3 p-3.5">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-white">
                  <Flame size={14} className="text-amber-400" /> Genre Footprint
                </h4>
                <div className="mt-3 space-y-2">
                  {summary.topGenres.map((g) => (
                    <div key={g.name} className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-white/80">{g.name}</span>
                        <span className="font-mono text-white/50">{g.percentage}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#7c5cff] to-[#b09cff]"
                          style={{ width: `${g.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top Artists & Tracks */}
            {summary.topArtists.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
                <span className="text-[#a59fad] text-[11px] flex-shrink-0 flex items-center gap-1">
                  <Headphones size={13} /> Top:
                </span>
                {summary.topArtists.map((a) => (
                  <span
                    key={a.name}
                    className="flex-shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-white/90"
                  >
                    {a.name}
                  </span>
                ))}
              </div>
            )}

            {/* Share / Action Button */}
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={handleShareVibe}
                className="flex items-center gap-2 rounded-xl bg-[#7c5cff] px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
              >
                <Share2 size={15} />
                <span>Share Vibe Summary</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl bg-white/5 px-4 py-2.5 text-xs font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
