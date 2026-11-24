import { z } from 'zod'
import {
  db,
  type ListeningHistoryRecord,
  type RecommendationExclusionRecord,
} from '../db/echoDatabase.ts'
import type { Track } from '../../types/domain.ts'
import { getSpotifyArtistWeights } from '../spotify/spotifyRecommendationBridge.ts'

export const listeningEventInputSchema = z.object({
  track: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    artistName: z.string().min(1),
    artistId: z.string().optional(),
    albumTitle: z.string().optional(),
    artwork: z.string().optional(),
    thumbnailUrl: z.string().optional(),
    album: z.object({ title: z.string().optional() }).optional(),
  }),
  durationPlayedMs: z.number().nonnegative(),
  trackDurationMs: z.number().nonnegative(),
  completed: z.boolean(),
  skipped: z.boolean(),
})

export type ListeningEventInput = z.infer<typeof listeningEventInputSchema>

export const listeningHistoryRecordSchema = z.object({
  id: z.number().optional(),
  trackId: z.string().min(1),
  trackTitle: z.string().min(1),
  artistName: z.string().min(1),
  artistId: z.string().optional(),
  albumTitle: z.string().optional(),
  artwork: z.string().optional(),
  playedAt: z.number().positive(),
  durationPlayedMs: z.number().nonnegative(),
  trackDurationMs: z.number().nonnegative(),
  completed: z.boolean(),
  skipped: z.boolean(),
  timeOfDay: z.enum(['morning', 'afternoon', 'evening', 'night']),
})

export const listeningHistoryMetricsSchema = z.object({
  eventsRecorded: z.number().nonnegative(),
  eventsDropped: z.number().nonnegative(),
  historyClearedCount: z.number().nonnegative(),
  lastError: z.string().nullable(),
})

export type ListeningHistoryMetrics = z.infer<typeof listeningHistoryMetricsSchema>

const listeningHistoryMetrics: ListeningHistoryMetrics = {
  eventsRecorded: 0,
  eventsDropped: 0,
  historyClearedCount: 0,
  lastError: null,
}

export function getListeningHistoryMetrics(): ListeningHistoryMetrics {
  return { ...listeningHistoryMetrics }
}

export function resetListeningHistoryMetrics(): void {
  listeningHistoryMetrics.eventsRecorded = 0
  listeningHistoryMetrics.eventsDropped = 0
  listeningHistoryMetrics.historyClearedCount = 0
  listeningHistoryMetrics.lastError = null
}

export interface ScoredTrack {
  trackId: string
  trackTitle: string
  artistName: string
  artistId?: string | undefined
  albumTitle?: string | undefined
  artwork?: string | undefined
  durationSeconds: number
  score: number
  lastPlayedAt: number
  playCount: number
}

export function getCurrentTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'night'
}

/**
 * Record a listening event into the Local Taste Engine history
 */
export async function recordListeningEvent(
  params: {
    track: Track
    durationPlayedMs: number
    trackDurationMs: number
    completed: boolean
    skipped: boolean
  },
  options?: { signal?: AbortSignal },
): Promise<void> {
  if (options?.signal?.aborted) {
    listeningHistoryMetrics.eventsDropped++
    listeningHistoryMetrics.lastError = 'Listening event recording cancelled'
    return
  }

  const parsed = listeningEventInputSchema.safeParse(params)
  if (!parsed.success) {
    listeningHistoryMetrics.eventsDropped++
    listeningHistoryMetrics.lastError =
      parsed.error.issues[0]?.message || 'Invalid listening event payload'
    return
  }

  const valid = parsed.data
  const timeOfDay = getCurrentTimeOfDay()
  const record: ListeningHistoryRecord = {
    trackId: valid.track.id,
    trackTitle: valid.track.title,
    artistName: valid.track.artistName,
    artistId: valid.track.artistId,
    albumTitle: valid.track.albumTitle || valid.track.album?.title,
    artwork: valid.track.artwork || valid.track.thumbnailUrl,
    playedAt: Date.now(),
    durationPlayedMs: valid.durationPlayedMs,
    trackDurationMs: valid.trackDurationMs,
    completed: valid.completed,
    skipped: valid.skipped,
    timeOfDay,
  }

  listeningHistoryMetrics.eventsRecorded++

  if (typeof indexedDB !== 'undefined') {
    try {
      await db.history.add(record)
    } catch (err) {
      listeningHistoryMetrics.lastError = err instanceof Error ? err.message : String(err)
    }
  }
}

/**
 * Clear listening history records and track telemetry
 */
export async function clearTasteListeningHistory(): Promise<void> {
  listeningHistoryMetrics.historyClearedCount++
  if (typeof indexedDB !== 'undefined') {
    try {
      await db.history.clear()
    } catch (err) {
      listeningHistoryMetrics.lastError = err instanceof Error ? err.message : String(err)
    }
  }
}

/**
 * Exclude a track from future recommendations
 */
export async function excludeTrackFromRecommendations(
  track: Track,
  reason = 'User excluded',
): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const record: RecommendationExclusionRecord = {
    trackId: track.id,
    trackTitle: track.title,
    artistName: track.artistName,
    excludedAt: Date.now(),
    reason,
  }
  await db.recommendationExclusions.put(record)
}

/**
 * Restore an excluded track back into recommendations
 */
export async function restoreExcludedTrack(trackId: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  await db.recommendationExclusions.delete(trackId)
}

/**
 * Get all excluded tracks
 */
export async function getExcludedTracks(): Promise<RecommendationExclusionRecord[]> {
  if (typeof indexedDB === 'undefined') return []
  return await db.recommendationExclusions.toArray()
}

/**
 * Pure taste score calculation for a given history snapshot and exclusions
 */
export function calculateTasteScore(
  history: ListeningHistoryRecord[],
  exclusions: Set<string>,
  likedTrackIds: Set<string>,
  now: number = Date.now(),
  currentTimeOfDay: 'morning' | 'afternoon' | 'evening' | 'night' = getCurrentTimeOfDay(),
  spotifyArtistWeights?: Map<string, number>,
): ScoredTrack[] {
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000

  const trackMap = new Map<
    string,
    {
      record: ListeningHistoryRecord
      score: number
      playCount: number
      lastPlayedAt: number
    }
  >()

  for (const item of history) {
    if (exclusions.has(item.trackId)) continue

    let entry = trackMap.get(item.trackId)
    if (!entry) {
      entry = {
        record: item,
        score: 0,
        playCount: 0,
        lastPlayedAt: item.playedAt,
      }
      trackMap.set(item.trackId, entry)
    }

    entry.playCount++
    if (item.playedAt > entry.lastPlayedAt) {
      entry.lastPlayedAt = item.playedAt
      entry.record = item
    }

    // Additive scoring mechanics based on Echo Music's Local Taste Engine:
    entry.score += 1.0

    if (item.completed) {
      entry.score += 2.0
    }

    // Explicit skip penalties: strong negative penalty for quick skips (<30s), moderate for later skips
    if (item.skipped) {
      entry.score -= item.durationPlayedMs < 30000 ? 1.5 : 0.75
    }

    if (now - item.playedAt < sevenDaysMs) {
      entry.score += 1.5
    }

    if (item.timeOfDay === currentTimeOfDay) {
      entry.score += 1.0
    }
  }

  // Liked track bonus & Spotify Recommendation Bridge bonus
  for (const [trackId, entry] of trackMap.entries()) {
    if (likedTrackIds.has(trackId)) {
      entry.score += 3.0
    }
    if (spotifyArtistWeights && entry.record.artistName) {
      const norm = entry.record.artistName.trim().toLowerCase().replace(/\s+/g, ' ')
      const boost = spotifyArtistWeights.get(norm)
      if (boost) {
        entry.score += boost
      }
    }
  }

  const results: ScoredTrack[] = []
  for (const [trackId, entry] of trackMap.entries()) {
    results.push({
      trackId,
      trackTitle: entry.record.trackTitle,
      artistName: entry.record.artistName,
      artistId: entry.record.artistId,
      albumTitle: entry.record.albumTitle,
      artwork: entry.record.artwork,
      durationSeconds: Math.round(entry.record.trackDurationMs / 1000) || 180,
      score: Math.max(0, entry.score),
      lastPlayedAt: entry.lastPlayedAt,
      playCount: entry.playCount,
    })
  }

  return results.sort((a, b) => b.score - a.score)
}

/**
 * Compute Taste Scores for all tracks in local history
 */
export async function computeTasteScores(likedTrackIds: Set<string>): Promise<ScoredTrack[]> {
  if (typeof indexedDB === 'undefined') return []
  const exclusions = await db.recommendationExclusions.toArray()
  const excludedSet = new Set(exclusions.map((e) => e.trackId))
  const history = await db.history.toArray()
  const spotifyWeights = getSpotifyArtistWeights()
  return calculateTasteScore(
    history,
    excludedSet,
    likedTrackIds,
    Date.now(),
    getCurrentTimeOfDay(),
    spotifyWeights,
  )
}

export function scoredToTrack(st: ScoredTrack): Track {
  const art = st.artwork || ''
  return {
    id: st.trackId,
    title: st.trackTitle,
    artistName: st.artistName,
    artistId: st.artistId || '',
    albumId: `album_${st.trackId}`,
    albumTitle: st.albumTitle || 'Unknown Album',
    albumImage: art,
    artwork: art,
    thumbnailUrl: art,
    durationMs: st.durationSeconds * 1000,
    durationSeconds: st.durationSeconds,
    explicit: false,
    playCount: st.playCount,
    videoId: st.trackId,
  }
}

/**
 * Generate "Quick Picks" from top scored tracks
 */
export async function getQuickPicks(likedTrackIds: string[], limit = 12): Promise<Track[]> {
  const scored = await computeTasteScores(new Set(likedTrackIds))
  return scored.slice(0, limit).map(scoredToTrack)
}

/**
 * Generate "Forgotten Favorites"
 */
export async function getForgottenFavorites(likedTrackIds: string[], limit = 10): Promise<Track[]> {
  const scored = await computeTasteScores(new Set(likedTrackIds))
  const now = Date.now()
  const twentyOneDaysMs = 21 * 24 * 60 * 60 * 1000

  const forgotten = scored.filter(
    (st) => st.playCount >= 2 && now - st.lastPlayedAt > twentyOneDaysMs,
  )

  return forgotten.slice(0, limit).map(scoredToTrack)
}

/**
 * Generate a personalized taste playlist
 */
export async function generateTastePlaylist(
  likedTrackIds: string[],
  catalogFallback: Track[] = [],
  targetCount = 25,
): Promise<{ title: string; description: string; tracks: Track[] }> {
  const scored = await computeTasteScores(new Set(likedTrackIds))
  const timeOfDay = getCurrentTimeOfDay()
  const timeLabel =
    timeOfDay === 'morning'
      ? 'Morning Light'
      : timeOfDay === 'afternoon'
        ? 'Midday Flow'
        : timeOfDay === 'evening'
          ? 'Evening Waves'
          : 'Late Night Echoes'

  const userTracks: Track[] = scored.map(scoredToTrack)

  const combined = [...userTracks]
  for (const t of catalogFallback) {
    if (!combined.some((item) => item.id === t.id)) {
      combined.push(t)
    }
  }

  const pool = combined.slice(0, targetCount * 2)
  const selected = pool
    .map((value) => ({ value, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ value }) => value)
    .slice(0, targetCount)

  return {
    title: `Local Taste: ${timeLabel}`,
    description: `Auto-generated by Echo's Local Taste Engine based on your listening patterns for ${timeOfDay}.`,
    tracks: selected,
  }
}

/**
 * Generate "Heavy Rotation" from tracks with high recent play counts
 */
export async function getHeavyRotation(likedTrackIds: string[], limit = 8): Promise<Track[]> {
  const scored = await computeTasteScores(new Set(likedTrackIds))
  const now = Date.now()
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000

  const active = scored.filter(
    (st) => st.playCount >= 2 && now - st.lastPlayedAt <= fourteenDaysMs,
  )
  return active.slice(0, limit).map(scoredToTrack)
}

/**
 * Get top artists based on user listening history
 */
export async function getTopArtists(
  limit = 6,
): Promise<Array<{ id: string; name: string; count: number; artwork?: string | undefined }>> {
  if (typeof indexedDB === 'undefined') return []
  const history = await db.history.toArray()
  const artistMap = new Map<
    string,
    { id: string; name: string; count: number; artwork?: string | undefined }
  >()

  for (const item of history) {
    if (!item.artistName || item.artistName === 'Unknown Artist') continue
    const key = item.artistId || item.artistName.toLowerCase()
    let entry = artistMap.get(key)
    if (!entry) {
      entry = {
        id: item.artistId || `artist-${item.artistName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name: item.artistName,
        count: 0,
        artwork: item.artwork,
      }
      artistMap.set(key, entry)
    }
    entry.count++
    if (!entry.artwork && item.artwork) {
      entry.artwork = item.artwork
    }
  }

  return [...artistMap.values()].sort((a, b) => b.count - a.count).slice(0, limit)
}

export * from './tasteMixService.ts'

