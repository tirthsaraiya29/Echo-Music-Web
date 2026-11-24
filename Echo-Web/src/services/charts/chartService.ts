import { z } from 'zod'
import { db } from '../db/echoDatabase.ts'
import type { Track } from '../../types/domain.ts'
import { InnerTubeClient } from '../innertube/client.ts'
import { useEchoStore } from '../../stores/useEchoStore.ts'

export interface ChartRegion {
  code: string
  name: string
  flag: string
}

export const SUPPORTED_CHART_REGIONS: ChartRegion[] = [
  { code: 'GLOBAL', name: 'Global', flag: '🌐' },
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
]

export type ChartCategory = 'top-songs' | 'top-videos' | 'trending' | 'top-artists'

export interface ChartCategoryInfo {
  id: ChartCategory
  label: string
  description: string
}

export const CHART_CATEGORIES: ChartCategoryInfo[] = [
  { id: 'top-songs', label: 'Top Songs', description: 'Most played tracks right now' },
  { id: 'top-videos', label: 'Top Videos', description: 'Most viewed music videos' },
  { id: 'trending', label: 'Trending', description: 'Fastest rising tracks this week' },
  { id: 'top-artists', label: 'Top Artists', description: 'Leading artists by total streams' },
]

export type RankChangeType = 'up' | 'down' | 'same' | 'new'

export const rankedChartItemSchema = z.object({
  rank: z.number().int().positive(),
  previousRank: z.number().int().positive().nullable().optional(),
  rankChange: z.enum(['up', 'down', 'same', 'new']),
  delta: z.number().int().default(0),
  track: z.custom<Track>(
    (val) => typeof val === 'object' && val !== null && 'id' in val && 'title' in val,
  ),
})

export type RankedChartItem = z.infer<typeof rankedChartItemSchema>

export const chartGroupSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: z.enum(['top-songs', 'top-videos', 'trending', 'top-artists']),
  region: z.string().min(2),
  regionName: z.string().min(1),
  flag: z.string(),
  updatedAt: z.number().positive(),
  items: z.array(rankedChartItemSchema),
})

export type ChartGroup = z.infer<typeof chartGroupSchema>

export const chartTelemetrySchema = z.object({
  chartsLoaded: z.number().nonnegative(),
  chartQueuesPlayed: z.number().nonnegative(),
  regionSwitches: z.number().nonnegative(),
  lastRegion: z.string(),
  lastError: z.string().nullable(),
})

export type ChartTelemetry = z.infer<typeof chartTelemetrySchema>

const telemetry: ChartTelemetry = {
  chartsLoaded: 0,
  chartQueuesPlayed: 0,
  regionSwitches: 0,
  lastRegion: 'GLOBAL',
  lastError: null,
}

export function getChartTelemetry(): ChartTelemetry {
  return { ...telemetry }
}

export function resetChartTelemetry(): void {
  telemetry.chartsLoaded = 0
  telemetry.chartQueuesPlayed = 0
  telemetry.regionSwitches = 0
  telemetry.lastRegion = 'GLOBAL'
  telemetry.lastError = null
}

export function getChartRegion(code: string): ChartRegion {
  const norm = code.toUpperCase().trim()
  return (
    SUPPORTED_CHART_REGIONS.find((r) => r.code === norm) || {
      code: norm,
      name: norm === 'ZZ' ? 'Global' : norm,
      flag: '🌐',
    }
  )
}

function calculateDeterministicRankChange(
  trackId: string,
  rank: number,
): { rankChange: RankChangeType; delta: number; previousRank: number | null } {
  let hash = 0
  for (let i = 0; i < trackId.length; i++) {
    hash = (hash << 5) - hash + trackId.charCodeAt(i)
    hash |= 0
  }
  const mod = Math.abs(hash) % 100

  if (mod < 10) {
    return { rankChange: 'new', delta: 0, previousRank: null }
  }
  if (mod < 45) {
    const delta = (Math.abs(hash) % 4) + 1
    return { rankChange: 'up', delta, previousRank: rank + delta }
  }
  if (mod < 75) {
    const delta = (Math.abs(hash) % 4) + 1
    const prev = Math.max(1, rank - delta)
    return { rankChange: 'down', delta, previousRank: prev }
  }
  return { rankChange: 'same', delta: 0, previousRank: rank }
}

/**
 * Fetch and synthesize regional charts with ranking changes
 */
export async function fetchRegionalChart(
  regionCode: string = 'GLOBAL',
  category: ChartCategory = 'top-songs',
  options?: { signal?: AbortSignal; fallbackTracks?: Track[] },
): Promise<ChartGroup> {
  const region = getChartRegion(regionCode)
  const innertubeRegion = region.code === 'GLOBAL' ? 'US' : region.code

  if (telemetry.lastRegion !== region.code) {
    telemetry.regionSwitches++
    telemetry.lastRegion = region.code
  }

  let rawTracks: Track[] = []

  try {
    const shelves = await InnerTubeClient.fetchCharts(
      innertubeRegion,
      options?.signal ? { signal: options.signal } : undefined,
    )
    if (shelves && shelves.length > 0) {
      // Find matching shelf or use first shelf
      const shelf =
        shelves.find(
          (s) =>
            s.title.toLowerCase().includes(category.replace('-', ' ')) ||
            s.title.toLowerCase().includes('top') ||
            s.title.toLowerCase().includes('trending'),
        ) || shelves[0]

      if (shelf && shelf.items) {
        rawTracks = shelf.items.filter((i): i is Track => 'durationSeconds' in i || 'durationMs' in i)
      }
    }
  } catch (err) {
    telemetry.lastError = err instanceof Error ? err.message : String(err)
  }

  // Fallback to provided fallback tracks if remote query returns empty or fails
  if (rawTracks.length === 0 && options?.fallbackTracks && options.fallbackTracks.length > 0) {
    rawTracks = options.fallbackTracks
  }

  // Load previous snapshot if indexedDB available
  const snapshotKey = `chart_snapshot_${region.code}_${category}`
  let previousRanks: Record<string, number> = {}

  if (typeof indexedDB !== 'undefined' && db?.metadataCache) {
    try {
      const cached = await db.metadataCache.get(snapshotKey)
      if (cached && typeof cached.data === 'object' && cached.data !== null) {
        previousRanks = cached.data as Record<string, number>
      }
    } catch {
      // Non-fatal cache failure
    }
  }

  const currentRanks: Record<string, number> = {}
  const rankedItems: RankedChartItem[] = rawTracks.slice(0, 50).map((track, idx) => {
    const rank = idx + 1
    currentRanks[track.id] = rank

    let rankChange: RankChangeType
    let delta = 0
    let previousRank: number | null = null

    if (previousRanks[track.id] !== undefined) {
      previousRank = previousRanks[track.id]!
      if (rank < previousRank) {
        rankChange = 'up'
        delta = previousRank - rank
      } else if (rank > previousRank) {
        rankChange = 'down'
        delta = rank - previousRank
      } else {
        rankChange = 'same'
        delta = 0
      }
    } else {
      const calc = calculateDeterministicRankChange(track.id, rank)
      rankChange = calc.rankChange
      delta = calc.delta
      previousRank = calc.previousRank
    }

    return {
      rank,
      previousRank,
      rankChange,
      delta,
      track,
    }
  })

  // Save latest rank snapshot
  if (typeof indexedDB !== 'undefined' && db?.metadataCache && Object.keys(currentRanks).length > 0) {
    try {
      await db.metadataCache.put({
        key: snapshotKey,
        kind: 'shelf',
        data: currentRanks,
        updatedAt: Date.now(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      })
    } catch {
      // Non-fatal
    }
  }

  const categoryInfo = CHART_CATEGORIES.find((c) => c.id === category) || CHART_CATEGORIES[0]!
  const title = `${categoryInfo.label} • ${region.name}`

  const chartGroup: ChartGroup = {
    id: `chart-${region.code}-${category}`,
    title,
    category,
    region: region.code,
    regionName: region.name,
    flag: region.flag,
    updatedAt: Date.now(),
    items: rankedItems,
  }

  telemetry.chartsLoaded++
  return chartGroupSchema.parse(chartGroup)
}

/**
 * Play full chart queue with chart context
 */
export function playChartQueue(
  chart: ChartGroup,
  startIndex = 0,
  shuffle = false,
): { queuedCount: number; title: string } {
  if (!chart.items || chart.items.length === 0) {
    return { queuedCount: 0, title: chart.title }
  }

  let tracks = chart.items.map((i) => i.track)
  if (shuffle) {
    tracks = [...tracks]
      .map((val) => ({ val, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ val }) => val)
  }

  const store = useEchoStore.getState()
  store.playQueue(tracks, startIndex)
  store.setToast(`Playing ${chart.title} (${tracks.length} tracks)`)

  telemetry.chartQueuesPlayed++
  return { queuedCount: tracks.length, title: chart.title }
}
