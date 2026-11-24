import { z } from 'zod'
import type { Track } from '../../types/domain.ts'
import type { PodcastProgressRecord } from '../db/echoDatabase.ts'

export const episodeSortOrderSchema = z.enum([
  'newest',
  'oldest',
  'shortest',
  'longest',
  'title',
])

export type EpisodeSortOrder = z.infer<typeof episodeSortOrderSchema>

export const episodeFilterSchema = z.enum(['all', 'unplayed', 'in-progress'])

export type EpisodeFilter = z.infer<typeof episodeFilterSchema>

export const podcastOrderingOptionsSchema = z.object({
  sortOrder: episodeSortOrderSchema.default('newest'),
  filter: episodeFilterSchema.default('all'),
  searchQuery: z.string().optional(),
})

export type PodcastOrderingOptions = z.infer<typeof podcastOrderingOptionsSchema>

export const podcastOrderingMetricsSchema = z.object({
  sortOperations: z.number().nonnegative(),
  filterOperations: z.number().nonnegative(),
})

export type PodcastOrderingMetrics = z.infer<typeof podcastOrderingMetricsSchema>

const orderingMetrics: PodcastOrderingMetrics = {
  sortOperations: 0,
  filterOperations: 0,
}

export function getPodcastOrderingMetrics(): PodcastOrderingMetrics {
  return { ...orderingMetrics }
}

export function resetPodcastOrderingMetrics(): void {
  orderingMetrics.sortOperations = 0
  orderingMetrics.filterOperations = 0
}

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS
const MONTH_MS = 30 * DAY_MS
const YEAR_MS = 365 * DAY_MS

const MONTH_NAMES: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
}

/**
 * Parses episode date strings matching upstream Echo Music EpisodeDates.kt.
 * Supports relative hints ("2 days ago", "yesterday") and absolute dates ("Dec 19, 2025").
 */
export function parseEpisodeDate(text?: string | null, now = Date.now()): number {
  if (!text) return 0
  const clean = text.trim().toLowerCase()
  if (!clean) return 0

  if (clean === 'today' || clean === 'oggi') return now
  if (clean === 'yesterday' || clean === 'ieri') return now - DAY_MS

  // 1. Relative matching ("X days ago", "3 hours ago", "2 weeks ago")
  const relativeMatch = clean.match(/^(\d+)\s*([a-z]+)/)
  if (relativeMatch && (clean.includes('ago') || clean.includes('fa'))) {
    const amount = Number.parseInt(relativeMatch[1] || '0', 10)
    const unit = relativeMatch[2] || ''

    if (unit.startsWith('sec') || unit.startsWith('s')) return now - amount * SECOND_MS
    if (unit.startsWith('min') || unit.startsWith('m')) return now - amount * MINUTE_MS
    if (unit.startsWith('hour') || unit.startsWith('h') || unit.startsWith('or')) return now - amount * HOUR_MS
    if (unit.startsWith('day') || unit.startsWith('d') || unit.startsWith('giorn')) return now - amount * DAY_MS
    if (unit.startsWith('week') || unit.startsWith('w') || unit.startsWith('settiman')) return now - amount * WEEK_MS
    if (unit.startsWith('month') || unit.startsWith('mo') || unit.startsWith('mes')) return now - amount * MONTH_MS
    if (unit.startsWith('year') || unit.startsWith('y') || unit.startsWith('ann')) return now - amount * YEAR_MS
  }

  // 2. Standard ISO date ("2025-12-19")
  const isoTime = Date.parse(clean)
  if (!Number.isNaN(isoTime)) {
    return isoTime
  }

  // 3. Month Day Year format ("Dec 19, 2025" or "19 Dec 2025")
  const mdyMatch = clean.match(/([a-z]+)\.?\s+(\d{1,2}),?\s*(\d{4})?/)
  if (mdyMatch) {
    const monthKey = mdyMatch[1] || ''
    const day = Number.parseInt(mdyMatch[2] || '1', 10)
    const year = mdyMatch[3] ? Number.parseInt(mdyMatch[3], 10) : new Date(now).getFullYear()
    const monthIndex = MONTH_NAMES[monthKey] ?? MONTH_NAMES[monthKey.slice(0, 3)]
    if (monthIndex !== undefined) {
      return new Date(year, monthIndex, day).getTime()
    }
  }

  const dmyMatch = clean.match(/(\d{1,2})\s+([a-z]+)\.?,?\s*(\d{4})?/)
  if (dmyMatch) {
    const day = Number.parseInt(dmyMatch[1] || '1', 10)
    const monthKey = dmyMatch[2] || ''
    const year = dmyMatch[3] ? Number.parseInt(dmyMatch[3], 10) : new Date(now).getFullYear()
    const monthIndex = MONTH_NAMES[monthKey] ?? MONTH_NAMES[monthKey.slice(0, 3)]
    if (monthIndex !== undefined) {
      return new Date(year, monthIndex, day).getTime()
    }
  }

  return 0
}

/**
 * Extracts a comparable timestamp for a podcast episode.
 */
export function getEpisodeTimestamp(episode: Track): number {
  if (episode.publishedAt) {
    const parsed = parseEpisodeDate(episode.publishedAt)
    if (parsed > 0) return parsed
  }
  if (episode.description) {
    const parsed = parseEpisodeDate(episode.description)
    if (parsed > 0) return parsed
  }
  return 0
}

/**
 * Sorts podcast episodes according to specified order.
 */
export function sortPodcastEpisodes(
  episodes: Track[],
  order: EpisodeSortOrder,
): Track[] {
  orderingMetrics.sortOperations++
  const copy = [...episodes]

  switch (order) {
    case 'newest': {
      return copy.sort((a, b) => {
        const timeA = getEpisodeTimestamp(a)
        const timeB = getEpisodeTimestamp(b)
        if (timeA !== timeB) return timeB - timeA
        return 0
      })
    }
    case 'oldest': {
      return copy.sort((a, b) => {
        const timeA = getEpisodeTimestamp(a)
        const timeB = getEpisodeTimestamp(b)
        if (timeA !== timeB) return timeA - timeB
        return 0
      })
    }
    case 'shortest': {
      return copy.sort((a, b) => {
        const durA = a.durationSeconds ?? (a.durationMs ? a.durationMs / 1000 : 0)
        const durB = b.durationSeconds ?? (b.durationMs ? b.durationMs / 1000 : 0)
        return durA - durB
      })
    }
    case 'longest': {
      return copy.sort((a, b) => {
        const durA = a.durationSeconds ?? (a.durationMs ? a.durationMs / 1000 : 0)
        const durB = b.durationSeconds ?? (b.durationMs ? b.durationMs / 1000 : 0)
        return durB - durA
      })
    }
    case 'title': {
      return copy.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }))
    }
    default:
      return copy
  }
}

/**
 * Filters podcast episodes by played/unplayed/in-progress status.
 */
export function filterPodcastEpisodes(
  episodes: Track[],
  filter: EpisodeFilter,
  progressMap?: Record<string, PodcastProgressRecord>,
): Track[] {
  orderingMetrics.filterOperations++
  if (filter === 'all' || !progressMap) return episodes

  return episodes.filter((ep) => {
    const id = ep.videoId || ep.id
    const record = progressMap[id]

    if (filter === 'unplayed') {
      return !record || (!record.completed && (record.positionMs || 0) < 5000)
    }
    if (filter === 'in-progress') {
      return Boolean(record && !record.completed && (record.positionMs || 0) >= 5000)
    }
    return true
  })
}

/**
 * Pipeline that filters and orders podcast episodes.
 */
export function orderAndFilterEpisodes(
  episodes: Track[],
  options: Partial<PodcastOrderingOptions>,
  progressMap?: Record<string, PodcastProgressRecord>,
): Track[] {
  let list = episodes

  // Optional search query filter
  if (options.searchQuery?.trim()) {
    const q = options.searchQuery.trim().toLowerCase()
    list = list.filter((e) => e.title.toLowerCase().includes(q) || e.artistName.toLowerCase().includes(q))
  }

  // Filter
  if (options.filter && options.filter !== 'all') {
    list = filterPodcastEpisodes(list, options.filter, progressMap)
  }

  // Sort
  if (options.sortOrder) {
    list = sortPodcastEpisodes(list, options.sortOrder)
  }

  return list
}
