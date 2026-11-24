import { Play, Shuffle, ArrowUp, ArrowDown, Minus } from 'lucide-react'
import type { ChartGroup, RankedChartItem } from '../../services/charts/chartService.ts'
import { playChartQueue } from '../../services/charts/chartService.ts'
import { useEchoStore } from '../../stores/useEchoStore.ts'
import { artwork } from '../../utils/artwork.ts'

interface RankedChartListProps {
  chart: ChartGroup
  onPlayItem?: (index: number) => void
}

export function RankedChartList({ chart, onPlayItem }: RankedChartListProps) {
  const currentTrack = useEchoStore((state) => state.currentTrack)
  const isPlaying = useEchoStore((state) => state.isPlaying)
  const togglePlayback = useEchoStore((state) => state.togglePlayback)

  const handlePlayAll = () => {
    playChartQueue(chart, 0, false)
  }

  const handleShuffle = () => {
    playChartQueue(chart, 0, true)
  }

  const handleTrackClick = (item: RankedChartItem, index: number) => {
    if (currentTrack && currentTrack.id === item.track.id) {
      togglePlayback()
      return
    }
    if (onPlayItem) {
      onPlayItem(index)
    } else {
      playChartQueue(chart, index, false)
    }
  }

  return (
    <div className="space-y-4" role="region" aria-label={chart.title}>
      {/* Chart Banner / Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/4 p-4 md:p-5 backdrop-blur-md">
        <div className="flex items-center gap-3.5">
          <span className="text-3xl" aria-hidden="true">
            {chart.flag}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[#b09cff]/20 px-2 py-0.5 text-[10px] font-bold tracking-wider text-[#b09cff] uppercase">
                {chart.category.replace('-', ' ')}
              </span>
              <span className="text-xs text-white/50">{chart.regionName}</span>
            </div>
            <h2 className="text-lg md:text-xl font-bold text-white mt-0.5">{chart.title}</h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handlePlayAll}
            className="flex items-center gap-2 rounded-xl bg-[#b09cff] px-4 py-2.5 text-xs font-bold text-black transition-all hover:bg-[#c2b2ff] active:scale-95 min-h-[44px]"
            aria-label={`Play ${chart.title}`}
          >
            <Play size={15} fill="currentColor" />
            <span>Play Chart ({chart.items.length})</span>
          </button>

          <button
            type="button"
            onClick={handleShuffle}
            className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-white/10 min-h-[44px]"
            aria-label="Shuffle chart"
            title="Shuffle chart"
          >
            <Shuffle size={14} />
            <span>Shuffle</span>
          </button>
        </div>
      </div>

      {/* Ranked Track Items */}
      <div className="space-y-1.5" role="list" aria-label={`Rankings for ${chart.title}`}>
        {chart.items.map((item, index) => {
          const isCurrent = currentTrack?.id === item.track.id
          const art =
            item.track.artwork ||
            item.track.thumbnailUrl ||
            artwork(item.track.title || 'track', 80)

          return (
            <div
              key={`${item.track.id}-${item.rank}`}
              role="listitem"
              onClick={() => handleTrackClick(item, index)}
              className={`group flex items-center justify-between gap-3 rounded-xl border p-2.5 transition-all cursor-pointer select-none min-h-[48px] ${
                isCurrent
                  ? 'border-[#b09cff]/40 bg-[#b09cff]/10 text-white'
                  : 'border-white/5 bg-white/2 hover:border-white/15 hover:bg-white/5 text-white/90'
              }`}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleTrackClick(item, index)
                }
              }}
              aria-label={`Rank ${item.rank}: ${item.track.title} by ${item.track.artistName}`}
            >
              {/* Rank Number & Movement Indicator */}
              <div className="flex items-center gap-3 w-16 shrink-0">
                <span
                  className={`text-base font-extrabold w-6 text-center ${
                    item.rank <= 3 ? 'text-[#b09cff]' : 'text-white/60'
                  }`}
                >
                  {item.rank}
                </span>

                <div className="flex items-center text-[10px] font-semibold w-7">
                  {item.rankChange === 'up' && (
                    <span className="flex items-center text-emerald-400" title={`Moved up ${item.delta} spots`}>
                      <ArrowUp size={11} className="stroke-[3]" />
                      <span>{item.delta}</span>
                    </span>
                  )}
                  {item.rankChange === 'down' && (
                    <span className="flex items-center text-rose-400" title={`Moved down ${item.delta} spots`}>
                      <ArrowDown size={11} className="stroke-[3]" />
                      <span>{item.delta}</span>
                    </span>
                  )}
                  {item.rankChange === 'same' && (
                    <span className="flex items-center text-white/30" title="Unchanged rank">
                      <Minus size={11} className="stroke-[3]" />
                    </span>
                  )}
                  {item.rankChange === 'new' && (
                    <span className="rounded bg-purple-500/20 px-1 py-0.5 text-[9px] font-bold text-purple-300" title="New entry">
                      NEW
                    </span>
                  )}
                </div>
              </div>

              {/* Artwork & Details */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-black/40">
                  <img
                    src={art}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  <div
                    className={`absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity ${
                      isCurrent && isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <Play size={16} fill="currentColor" className="text-white" />
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-xs font-semibold ${
                      isCurrent ? 'text-[#b09cff]' : 'text-white'
                    }`}
                  >
                    {item.track.title}
                  </p>
                  <p className="truncate text-[11px] text-[#a59fad]">
                    {item.track.artistName}
                    {item.track.albumTitle ? ` • ${item.track.albumTitle}` : ''}
                  </p>
                </div>
              </div>

              {/* Duration */}
              <div className="shrink-0 text-right text-[11px] text-white/40 group-hover:text-white/70">
                {formatDuration(item.track.durationSeconds || Math.round((item.track.durationMs || 180000) / 1000))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
