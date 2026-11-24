/**
 * Listening History Service for Echo Music Web
 *
 * Provides comprehensive controls for playback history:
 * - Device and source attribution (YouTube Music, local files, Spotify, cloud media, podcasts)
 * - Multi-criteria filtering (search query, source type, predefined & custom date ranges)
 * - Single item and date-range batch deletions
 * - Portable JSON and CSV data exports
 * - Synchronization with IndexedDB and in-memory store
 */

import { z } from 'zod'
import { db, type ListeningHistoryRecord } from '../db/echoDatabase.ts'
import { useEchoStore } from '../../stores/useEchoStore.ts'
import { getOrCreateDeviceId } from '../sync/multiDeviceLibrarySyncService.ts'

// ============================================================================
// Schemas
// ============================================================================

export const historySourceSchema = z.enum([
  'youtube',
  'local',
  'spotify',
  'cloud',
  'podcast',
])

export type HistorySource = z.infer<typeof historySourceSchema>

export const historyRecordSchema = z.object({
  id: z.number().int().positive().optional(),
  trackId: z.string().min(1),
  trackTitle: z.string().min(1),
  artistName: z.string().min(1),
  artistId: z.string().optional(),
  albumTitle: z.string().optional(),
  artwork: z.string().optional(),
  playedAt: z.number().nonnegative(),
  durationPlayedMs: z.number().nonnegative().default(0),
  trackDurationMs: z.number().nonnegative().default(0),
  completed: z.boolean().default(false),
  skipped: z.boolean().default(false),
  timeOfDay: z.enum(['morning', 'afternoon', 'evening', 'night']).default('afternoon'),
  deviceId: z.string().optional(),
  deviceName: z.string().optional(),
  source: historySourceSchema.default('youtube'),
})

export type HistoryRecord = z.infer<typeof historyRecordSchema>

export const historyFilterOptionsSchema = z.object({
  query: z.string().optional(),
  source: z.enum(['all', 'youtube', 'local', 'spotify', 'cloud', 'podcast']).default('all'),
  dateRange: z.enum(['all', 'today', 'last_7_days', 'last_30_days', 'custom']).default('all'),
  startDateMs: z.number().nonnegative().optional(),
  endDateMs: z.number().nonnegative().optional(),
  limit: z.number().int().positive().max(2000).default(100),
  offset: z.number().int().nonnegative().default(0),
})

export type HistoryFilterOptions = z.infer<typeof historyFilterOptionsSchema>

export const historyMetricsSchema = z.object({
  recordsAddedCount: z.number().nonnegative(),
  recordsQueriedCount: z.number().nonnegative(),
  recordsDeletedCount: z.number().nonnegative(),
  exportsCount: z.number().nonnegative(),
  historyClearedCount: z.number().nonnegative(),
})

export type HistoryMetrics = z.infer<typeof historyMetricsSchema>

// ============================================================================
// Telemetry & Metrics
// ============================================================================

let metrics: HistoryMetrics = {
  recordsAddedCount: 0,
  recordsQueriedCount: 0,
  recordsDeletedCount: 0,
  exportsCount: 0,
  historyClearedCount: 0,
}

export function recordHistoryMetric(key: keyof HistoryMetrics, delta = 1): void {
  if (key in metrics) {
    metrics[key] += delta
  }
}

export function getHistoryMetrics(): HistoryMetrics {
  return { ...metrics }
}

export function resetHistoryMetrics(): void {
  metrics = {
    recordsAddedCount: 0,
    recordsQueriedCount: 0,
    recordsDeletedCount: 0,
    exportsCount: 0,
    historyClearedCount: 0,
  }
}

// ============================================================================
// Helpers
// ============================================================================

export function getTimeOfDay(date = new Date()): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = date.getHours()
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'night'
}

export function getDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Desktop'
  const ua = navigator.userAgent
  if (/mobile/i.test(ua)) return 'Mobile Browser'
  if (/mac/i.test(ua)) return 'Mac'
  if (/win/i.test(ua)) return 'Windows PC'
  if (/linux/i.test(ua)) return 'Linux PC'
  return 'Web Client'
}

// ============================================================================
// Core History Operations
// ============================================================================

export async function recordListeningHistory(
  entry: Omit<HistoryRecord, 'id' | 'playedAt' | 'timeOfDay' | 'deviceId' | 'deviceName'> & {
    playedAt?: number
    deviceId?: string
    deviceName?: string
    timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night'
  },
): Promise<number | undefined> {
  const playedAt = entry.playedAt || Date.now()
  const record: ListeningHistoryRecord = {
    trackId: entry.trackId,
    trackTitle: entry.trackTitle,
    artistName: entry.artistName,
    artistId: entry.artistId,
    albumTitle: entry.albumTitle,
    artwork: entry.artwork,
    playedAt,
    durationPlayedMs: entry.durationPlayedMs || 0,
    trackDurationMs: entry.trackDurationMs || 0,
    completed: entry.completed || false,
    skipped: entry.skipped || false,
    timeOfDay: entry.timeOfDay || getTimeOfDay(new Date(playedAt)),
    deviceId: entry.deviceId || getOrCreateDeviceId(),
    deviceName: entry.deviceName || getDeviceName(),
    source: (entry.source as HistorySource) || 'youtube',
  }

  recordHistoryMetric('recordsAddedCount')

  if (typeof indexedDB !== 'undefined') {
    try {
      const id = await db.history.add(record)
      return typeof id === 'number' ? id : undefined
    } catch {
      // Fallback
    }
  }
  return undefined
}

export async function queryListeningHistory(
  options: Partial<HistoryFilterOptions> = {},
): Promise<{ items: HistoryRecord[]; total: number }> {
  recordHistoryMetric('recordsQueriedCount')
  const opts = historyFilterOptionsSchema.parse(options)

  let allRecords: ListeningHistoryRecord[] = []
  if (typeof indexedDB !== 'undefined') {
    try {
      allRecords = await db.history.toArray()
    } catch {
      allRecords = []
    }
  }

  // Calculate Date Boundaries
  const now = Date.now()
  let minTime = 0
  let maxTime = Infinity

  if (opts.dateRange === 'today') {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    minTime = startOfToday.getTime()
  } else if (opts.dateRange === 'last_7_days') {
    minTime = now - 7 * 24 * 60 * 60 * 1000
  } else if (opts.dateRange === 'last_30_days') {
    minTime = now - 30 * 24 * 60 * 60 * 1000
  } else if (opts.dateRange === 'custom') {
    if (opts.startDateMs !== undefined) minTime = opts.startDateMs
    if (opts.endDateMs !== undefined) maxTime = opts.endDateMs
  }

  const queryLower = (opts.query || '').trim().toLowerCase()

  const filtered = allRecords.filter((rec) => {
    // 1. Date Range
    if (rec.playedAt < minTime || rec.playedAt > maxTime) return false

    // 2. Source
    if (opts.source !== 'all' && (rec.source || 'youtube') !== opts.source) {
      return false
    }

    // 3. Text query
    if (queryLower) {
      const matchTitle = rec.trackTitle.toLowerCase().includes(queryLower)
      const matchArtist = rec.artistName.toLowerCase().includes(queryLower)
      const matchAlbum = (rec.albumTitle || '').toLowerCase().includes(queryLower)
      if (!matchTitle && !matchArtist && !matchAlbum) return false
    }

    return true
  })

  // Sort reverse chronological (newest first)
  filtered.sort((a, b) => b.playedAt - a.playedAt)

  const paginated = filtered.slice(opts.offset, opts.offset + opts.limit).map((rec) => ({
    id: rec.id,
    trackId: rec.trackId,
    trackTitle: rec.trackTitle,
    artistName: rec.artistName,
    artistId: rec.artistId,
    albumTitle: rec.albumTitle,
    artwork: rec.artwork,
    playedAt: rec.playedAt,
    durationPlayedMs: rec.durationPlayedMs,
    trackDurationMs: rec.trackDurationMs,
    completed: rec.completed,
    skipped: rec.skipped,
    timeOfDay: rec.timeOfDay,
    deviceId: rec.deviceId,
    deviceName: rec.deviceName,
    source: (rec.source as HistorySource) || 'youtube',
  }))

  return {
    items: paginated,
    total: filtered.length,
  }
}

export async function deleteHistoryRecord(id: number): Promise<boolean> {
  if (typeof indexedDB !== 'undefined') {
    try {
      await db.history.delete(id)
      recordHistoryMetric('recordsDeletedCount')
      return true
    } catch {
      return false
    }
  }
  return false
}

export async function deleteHistoryByDateRange(
  startDateMs: number,
  endDateMs: number,
): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0

  try {
    const toDelete = await db.history
      .filter((r) => r.playedAt >= startDateMs && r.playedAt <= endDateMs)
      .toArray()

    const ids = toDelete.map((r) => r.id).filter((id): id is number => typeof id === 'number')
    await db.history.bulkDelete(ids)
    recordHistoryMetric('recordsDeletedCount', ids.length)
    return ids.length
  } catch {
    return 0
  }
}

export async function clearAllListeningHistory(): Promise<void> {
  if (typeof indexedDB !== 'undefined') {
    try {
      await db.history.clear()
    } catch {
      // Ignore
    }
  }
  // Clear in-memory recent items
  useEchoStore.setState({
    recentlyPlayedIds: [],
    recentItems: [],
  })
  recordHistoryMetric('historyClearedCount')
}

// ============================================================================
// Export Operations (JSON & CSV)
// ============================================================================

export async function exportHistoryJson(): Promise<string> {
  recordHistoryMetric('exportsCount')
  let records: ListeningHistoryRecord[] = []
  if (typeof indexedDB !== 'undefined') {
    try {
      records = await db.history.toArray()
    } catch {
      records = []
    }
  }
  return JSON.stringify(records, null, 2)
}

export async function exportHistoryCsv(): Promise<string> {
  recordHistoryMetric('exportsCount')
  let records: ListeningHistoryRecord[] = []
  if (typeof indexedDB !== 'undefined') {
    try {
      records = await db.history.toArray()
    } catch {
      records = []
    }
  }

  const escapeCsv = (val: unknown): string => {
    const str = String(val ?? '')
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const header = [
    'ID',
    'Track ID',
    'Title',
    'Artist',
    'Album',
    'Played At (ISO)',
    'Played At (Timestamp)',
    'Played Duration (s)',
    'Track Duration (s)',
    'Completed',
    'Skipped',
    'Source',
    'Device',
  ].join(',')

  const rows = records.map((r) =>
    [
      r.id ?? '',
      escapeCsv(r.trackId),
      escapeCsv(r.trackTitle),
      escapeCsv(r.artistName),
      escapeCsv(r.albumTitle || ''),
      new Date(r.playedAt).toISOString(),
      r.playedAt,
      Math.round(r.durationPlayedMs / 1000),
      Math.round(r.trackDurationMs / 1000),
      r.completed ? 'Yes' : 'No',
      r.skipped ? 'Yes' : 'No',
      escapeCsv(r.source || 'youtube'),
      escapeCsv(r.deviceName || r.deviceId || 'Unknown'),
    ].join(','),
  )

  return [header, ...rows].join('\n')
}

export function downloadFile(content: string, fileName: string, mimeType: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
