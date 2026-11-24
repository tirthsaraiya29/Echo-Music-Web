/**
 * Episode Details & Show Notes Modal Component
 *
 * Implements podcast episode metadata display, rich show notes,
 * publication date, artwork, and interactive chapter seeking matching
 * upstream Echo Music architecture (EpisodeDetails.kt).
 */

import { useEffect, useState, useRef } from 'react'
import {
  Calendar,
  Clock,
  ListOrdered,
  Pause,
  Play,
  Share2,
  X,
} from 'lucide-react'
import type { Track } from '../../types/domain.ts'
import { AudioEngine } from '../../engine/AudioEngine.ts'
import { formatDuration } from '../../utils/format.ts'
import { artwork } from '../../utils/artwork.ts'
import {
  fetchEpisodeMetadata,
  parseEpisodeChapters,
  type PodcastEpisodeMetadata,
  recordPodcastMetadataMetric,
} from '../../services/podcast/podcastMetadataService.ts'
import { shareTrack } from '../../services/sharing/playlistPortability.ts'

interface EpisodeDetailsModalProps {
  episode: Track
  isOpen: boolean
  onClose: () => void
}

export function EpisodeDetailsModal({ episode, isOpen, onClose }: EpisodeDetailsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [metadata, setMetadata] = useState<PodcastEpisodeMetadata | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    if (!isOpen) return

    setLoading(true)
    const episodeId = episode.videoId || episode.id
    void fetchEpisodeMetadata(episodeId, episode.title, episode.showTitle || episode.artistName).then(
      (data) => {
        // If track already had description, parse chapters from it
        if (!data.chapters || data.chapters.length === 0) {
          const desc = episode.description || data.description
          data.chapters = parseEpisodeChapters(desc)
        }
        setMetadata(data)
        setLoading(false)
      },
    )
  }, [isOpen, episode])

  if (!isOpen) return null

  const engine = AudioEngine.getInstance()
  const currentTrack = engine.getCurrentTrack()
  const isCurrentEpisode = currentTrack?.id === episode.id || currentTrack?.videoId === episode.videoId
  const isPlaying = isCurrentEpisode && engine.isPlaying

  const handlePlayOrResume = () => {
    if (isCurrentEpisode) {
      if (isPlaying) {
        engine.pause()
      } else {
        void engine.play()
      }
    } else {
      void engine.play(episode)
    }
  }

  const handleChapterClick = (startMs: number) => {
    recordPodcastMetadataMetric('chapterJumpsCount')
    const targetSeconds = Math.round(startMs / 1000)
    if (isCurrentEpisode) {
      engine.seek(targetSeconds)
      if (!isPlaying) void engine.play()
    } else {
      void engine.play(episode).then(() => {
        engine.seek(targetSeconds)
      })
    }
    onClose()
  }

  const coverArt =
    episode.artwork ||
    episode.thumbnailUrl ||
    metadata?.artworkUrl ||
    artwork(episode.title || 'podcast', 240)

  const chapters = metadata?.chapters || []
  const descriptionText = episode.description || metadata?.description || ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={`Episode Details: ${episode.title}`}
    >
      <div
        ref={dialogRef}
        className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-[#16141e] text-[#f4f1f7] shadow-2xl overflow-hidden"
      >
        {/* Header / Hero Section */}
        <div className="flex items-start gap-4 p-6 border-b border-white/10 bg-white/2">
          <img
            src={coverArt}
            alt=""
            className="h-24 w-24 rounded-xl object-cover shadow-lg shrink-0"
            onError={(e) => {
              const fallback = artwork(episode.title || 'podcast', 240)
              if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback
            }}
          />
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-white line-clamp-2">{episode.title}</h2>
            <p className="text-sm font-medium text-[#7c5cff] truncate mt-0.5">
              {episode.showTitle || episode.artistName || metadata?.showTitle}
            </p>

            <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-[#a59fad]">
              <span className="flex items-center gap-1">
                <Calendar size={13} />
                <span>{metadata?.publishedText || 'Recently published'}</span>
              </span>
              <span className="flex items-center gap-1">
                <Clock size={13} />
                <span>{formatDuration(episode.durationSeconds || metadata?.durationSeconds || 0)}</span>
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-[#a59fad] transition-colors hover:bg-white/10 hover:text-white"
            title="Close"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Primary Action Row */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-white/5 bg-white/1">
          <button
            type="button"
            onClick={handlePlayOrResume}
            className="flex items-center gap-2 rounded-xl bg-[#7c5cff] px-4 py-2 text-sm font-bold text-black shadow-lg transition-transform hover:scale-105 active:scale-95"
          >
            {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
            <span>{isCurrentEpisode ? (isPlaying ? 'Pause Episode' : 'Resume Episode') : 'Play Episode'}</span>
          </button>

          <button
            type="button"
            onClick={() => void shareTrack(episode)}
            className="flex items-center gap-2 rounded-xl bg-white/8 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/15"
            title="Share Episode Link"
          >
            <Share2 size={14} />
            <span>Share</span>
          </button>
        </div>

        {/* Scrollable Content (Chapters & Show Notes) */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Interactive Chapters (matching upstream EpisodeDetails.kt) */}
          {chapters.length >= 2 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <ListOrdered size={16} className="text-[#7c5cff]" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                  Chapters & Timestamps ({chapters.length})
                </h3>
              </div>
              <div className="space-y-1.5 rounded-xl border border-white/8 bg-black/30 p-2">
                {chapters.map((ch) => (
                  <button
                    key={`${ch.startMs}-${ch.title}`}
                    type="button"
                    onClick={() => handleChapterClick(ch.startMs)}
                    className="flex items-center justify-between w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/10 group"
                  >
                    <span className="font-mono text-xs font-semibold text-[#7c5cff] min-w-14">
                      {ch.formattedTime || formatDuration(ch.startMs / 1000)}
                    </span>
                    <span className="flex-1 font-medium text-[#f4f1f7] group-hover:text-white truncate mx-2">
                      {ch.title}
                    </span>
                    <span className="text-xs text-[#a59fad] group-hover:text-white opacity-0 group-hover:opacity-100 transition-opacity">
                      Play from here
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Episode Description / Show Notes */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-[#a59fad] mb-2">
              Episode Description & Show Notes
            </h3>
            {loading ? (
              <p className="text-sm text-[#a59fad] animate-pulse">Loading show notes...</p>
            ) : descriptionText ? (
              <div className="text-sm leading-relaxed text-[#c3bdcc] whitespace-pre-line select-text">
                {descriptionText}
              </div>
            ) : (
              <p className="text-sm text-[#a59fad] italic">No description provided for this episode.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
