import { z } from 'zod'
import {
  db,
  type ListeningHistoryRecord,
} from '../db/echoDatabase.ts'
import type { Track } from '../../types/domain.ts'
import {
  calculateTasteScore,
  getCurrentTimeOfDay,
  scoredToTrack,
  type ScoredTrack,
} from './localTasteEngine.ts'

export const tasteMixSchema = z.object({
  id: z.string().min(1),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1),
  subtitle: z.string(),
  description: z.string(),
  tracks: z.array(
    z.custom<Track>(
      (val) => typeof val === 'object' && val !== null && 'id' in val && 'title' in val,
    ),
  ),
  generatedAt: z.number().positive(),
  expiresAt: z.number().positive(),
  stats: z.object({
    topArtists: z.array(z.string()),
    dominantTimeOfDay: z.enum(['morning', 'afternoon', 'evening', 'night']),
    totalDurationSeconds: z.number().nonnegative(),
    favoritesRatio: z.number().min(0).max(1),
    discoveryRatio: z.number().min(0).max(1),
  }),
  isFallback: z.boolean(),
})

export type TasteMix = {
  id: string
  dateKey: string
  title: string
  subtitle: string
  description: string
  tracks: Track[]
  generatedAt: number
  expiresAt: number
  stats: {
    topArtists: string[]
    dominantTimeOfDay: 'morning' | 'afternoon' | 'evening' | 'night'
    totalDurationSeconds: number
    favoritesRatio: number
    discoveryRatio: number
  }
  isFallback: boolean
}

export const tasteMixTelemetrySchema = z.object({
  mixesGenerated: z.number().nonnegative(),
  cacheHits: z.number().nonnegative(),
  refreshesTriggered: z.number().nonnegative(),
  lastGeneratedDateKey: z.string().nullable(),
  lastError: z.string().nullable(),
})

export type TasteMixTelemetry = z.infer<typeof tasteMixTelemetrySchema>

const tasteMixTelemetry: TasteMixTelemetry = {
  mixesGenerated: 0,
  cacheHits: 0,
  refreshesTriggered: 0,
  lastGeneratedDateKey: null,
  lastError: null,
}

export function getTasteMixTelemetry(): TasteMixTelemetry {
  return { ...tasteMixTelemetry }
}

export function resetTasteMixTelemetry(): void {
  tasteMixTelemetry.mixesGenerated = 0
  tasteMixTelemetry.cacheHits = 0
  tasteMixTelemetry.refreshesTriggered = 0
  tasteMixTelemetry.lastGeneratedDateKey = null
  tasteMixTelemetry.lastError = null
}

export function getTodayDateKey(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function seededRandom(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

export interface BuildTasteMixParams {
  history: ListeningHistoryRecord[]
  likedTrackIds: Set<string>
  exclusions: Set<string>
  catalogFallback?: Track[]
  now?: number
  dateKey?: string
  currentTimeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night'
  targetCount?: number
  maxPerArtist?: number
  randomSalt?: string
}

/**
 * Pure algorithm to build a daily personalized Taste Mix
 */
export function buildTasteMix({
  history,
  likedTrackIds,
  exclusions,
  catalogFallback = [],
  now = Date.now(),
  dateKey = getTodayDateKey(new Date(now)),
  currentTimeOfDay = getCurrentTimeOfDay(),
  targetCount = 25,
  maxPerArtist = 2,
  randomSalt = '',
}: BuildTasteMixParams): TasteMix {
  const rng = seededRandom(`${dateKey}-${randomSalt}`)

  // 1. Calculate taste scores for user listening history
  const scoredTracks: ScoredTrack[] = calculateTasteScore(
    history,
    exclusions,
    likedTrackIds,
    now,
    currentTimeOfDay,
  )

  const isFallback = scoredTracks.filter((t) => t.score > 0).length < 3

  // 2. Tally artist affinities
  const artistCounts = new Map<string, number>()
  for (const st of scoredTracks) {
    if (st.artistName && st.score > 0) {
      artistCounts.set(st.artistName, (artistCounts.get(st.artistName) || 0) + st.playCount + 1)
    }
  }
  const topArtists = [...artistCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name)

  // 3. Select high-affinity tracks from user history and liked tracks with artist diversity
  const highAffinityTracks: Track[] = []
  const artistTrackCounts = new Map<string, number>()
  const selectedTrackIds = new Set<string>()

  const targetHighAffinity = Math.max(1, Math.round(targetCount * 0.65))

  for (const st of scoredTracks) {
    if (highAffinityTracks.length >= targetHighAffinity) break
    if (exclusions.has(st.trackId)) continue

    const artist = st.artistName || 'Unknown Artist'
    const curCount = artistTrackCounts.get(artist) || 0
    if (curCount >= maxPerArtist) continue

    const track = scoredToTrack(st)
    highAffinityTracks.push(track)
    selectedTrackIds.add(track.id)
    artistTrackCounts.set(artist, curCount + 1)
  }

  // 4. Fill remaining slots with discovery tracks from catalog fallback
  const discoveryTracks: Track[] = []
  const remainingNeeded = targetCount - highAffinityTracks.length

  // Filter catalog fallback to ensure no exclusions or already selected tracks
  const eligibleCatalog = catalogFallback.filter(
    (t) => !exclusions.has(t.id) && !selectedTrackIds.has(t.id),
  )

  // Sort eligible catalog prioritizing top artists or shuffle deterministically
  const sortedCatalog = [...eligibleCatalog].sort((a, b) => {
    const aTop = topArtists.includes(a.artistName) ? 1 : 0
    const bTop = topArtists.includes(b.artistName) ? 1 : 0
    if (aTop !== bTop) return bTop - aTop
    return rng() - 0.5
  })

  for (const t of sortedCatalog) {
    if (discoveryTracks.length >= remainingNeeded) break
    const artist = t.artistName || 'Unknown Artist'
    const curCount = artistTrackCounts.get(artist) || 0
    if (curCount >= maxPerArtist && highAffinityTracks.length + discoveryTracks.length >= 10) {
      continue
    }

    discoveryTracks.push(t)
    selectedTrackIds.add(t.id)
    artistTrackCounts.set(artist, curCount + 1)
  }

  // Combine and arrange tracks: favorites first, mixed with discoveries
  const finalTracks: Track[] = []
  let favIdx = 0
  let discIdx = 0

  while (favIdx < highAffinityTracks.length || discIdx < discoveryTracks.length) {
    // Interleave: roughly 2 favorites then 1 discovery
    if (favIdx < highAffinityTracks.length) {
      finalTracks.push(highAffinityTracks[favIdx++]!)
    }
    if (favIdx < highAffinityTracks.length && discIdx < discoveryTracks.length) {
      finalTracks.push(highAffinityTracks[favIdx++]!)
    }
    if (discIdx < discoveryTracks.length) {
      finalTracks.push(discoveryTracks[discIdx++]!)
    }
  }

  const totalDurationSeconds = finalTracks.reduce(
    (acc, t) => acc + (t.durationSeconds || Math.round((t.durationMs || 180000) / 1000)),
    0,
  )

  const favoritesRatio =
    finalTracks.length > 0 ? highAffinityTracks.length / finalTracks.length : 0
  const discoveryRatio =
    finalTracks.length > 0 ? discoveryTracks.length / finalTracks.length : 0

  const timeLabel =
    currentTimeOfDay === 'morning'
      ? 'Morning Wake'
      : currentTimeOfDay === 'afternoon'
        ? 'Midday Groove'
        : currentTimeOfDay === 'evening'
          ? 'Evening Vibe'
          : 'Late Night Echo'

  const subtitle =
    topArtists.length > 0
      ? `Refreshed today for your ${currentTimeOfDay} • Featuring ${topArtists.slice(0, 3).join(', ')}`
      : `Refreshed today for your ${currentTimeOfDay} • Curated daily from your listening taste`

  const description = isFallback
    ? `Starter Taste Mix for ${dateKey}. Listen to more songs to train your personalized Echo Brain.`
    : `Updated daily on ${dateKey}. Blend of your favorites (${Math.round(favoritesRatio * 100)}%) and fresh discoveries (${Math.round(discoveryRatio * 100)}%).`

  const tasteMix: TasteMix = {
    id: `taste-mix-${dateKey}`,
    dateKey,
    title: `Daily Taste Mix: ${timeLabel}`,
    subtitle,
    description,
    tracks: finalTracks,
    generatedAt: now,
    expiresAt: now + 24 * 60 * 60 * 1000,
    stats: {
      topArtists,
      dominantTimeOfDay: currentTimeOfDay,
      totalDurationSeconds,
      favoritesRatio: Math.min(1, Math.max(0, favoritesRatio)),
      discoveryRatio: Math.min(1, Math.max(0, discoveryRatio)),
    },
    isFallback,
  }

  return tasteMixSchema.parse(tasteMix)
}

let inMemoryTasteMix: TasteMix | null = null

/**
 * Clear in-memory and persistent Taste Mix cache
 */
export async function clearTasteMixCache(): Promise<void> {
  inMemoryTasteMix = null
  if (typeof indexedDB !== 'undefined' && db?.metadataCache) {
    try {
      const keys = await db.metadataCache.toCollection().primaryKeys()
      const mixKeys = keys.filter((k) => String(k).startsWith('taste_mix_'))
      await db.metadataCache.bulkDelete(mixKeys)
    } catch (err) {
      tasteMixTelemetry.lastError = err instanceof Error ? err.message : String(err)
    }
  }
}

/**
 * Get or generate the daily Taste Mix, with caching by dateKey
 */
export async function getDailyTasteMix(options?: {
  forceRefresh?: boolean
  signal?: AbortSignal
  catalogFallback?: Track[]
  date?: Date
  now?: number
  likedTrackIds?: string[]
}): Promise<TasteMix> {
  const now = options?.now || Date.now()
  const todayKey = getTodayDateKey(options?.date || new Date(now))
  const cacheKey = `taste_mix_${todayKey}`

  if (options?.signal?.aborted) {
    throw new Error('Taste Mix generation cancelled')
  }

  // 1. Check in-memory cache
  if (!options?.forceRefresh && inMemoryTasteMix && inMemoryTasteMix.dateKey === todayKey) {
    tasteMixTelemetry.cacheHits++
    return inMemoryTasteMix
  }

  // 2. Check IndexedDB metadataCache
  if (!options?.forceRefresh && typeof indexedDB !== 'undefined' && db?.metadataCache) {
    try {
      const cached = await db.metadataCache.get(cacheKey)
      if (cached && cached.data) {
        const parsed = tasteMixSchema.safeParse(cached.data)
        if (parsed.success && parsed.data.dateKey === todayKey) {
          inMemoryTasteMix = parsed.data
          tasteMixTelemetry.cacheHits++
          return parsed.data
        }
      }
    } catch {
      // Non-fatal cache read error; fall through to generate
    }
  }

  if (options?.signal?.aborted) {
    throw new Error('Taste Mix generation cancelled')
  }

  // 3. Fetch history, exclusions, and likes from DB or options
  let history: ListeningHistoryRecord[] = []
  let exclusionsSet = new Set<string>()

  if (typeof indexedDB !== 'undefined') {
    try {
      if (db?.history) {
        history = await db.history.toArray()
      }
      if (db?.recommendationExclusions) {
        const exclusions = await db.recommendationExclusions.toArray()
        exclusionsSet = new Set(exclusions.map((e) => e.trackId))
      }
    } catch (err) {
      tasteMixTelemetry.lastError = err instanceof Error ? err.message : String(err)
    }
  }

  const likedSet = new Set<string>(options?.likedTrackIds || [])

  const salt = options?.forceRefresh ? `${Date.now()}` : ''

  // 4. Build mix
  const mix = buildTasteMix({
    history,
    likedTrackIds: likedSet,
    exclusions: exclusionsSet,
    catalogFallback: options?.catalogFallback || [],
    now,
    dateKey: todayKey,
    randomSalt: salt,
  })

  // 5. Save to caches
  inMemoryTasteMix = mix
  tasteMixTelemetry.mixesGenerated++
  tasteMixTelemetry.lastGeneratedDateKey = todayKey
  if (options?.forceRefresh) {
    tasteMixTelemetry.refreshesTriggered++
  }

  if (typeof indexedDB !== 'undefined' && db?.metadataCache) {
    try {
      await db.metadataCache.put({
        key: cacheKey,
        kind: 'playlist',
        data: mix,
        updatedAt: now,
        expiresAt: now + 24 * 60 * 60 * 1000,
      })
    } catch (err) {
      tasteMixTelemetry.lastError = err instanceof Error ? err.message : String(err)
    }
  }

  return mix
}
