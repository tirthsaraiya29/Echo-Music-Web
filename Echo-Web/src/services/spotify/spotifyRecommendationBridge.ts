import { z } from 'zod'
import { db } from '../db/echoDatabase.ts'
import type { ScoredTrack } from '../recommendations/localTasteEngine.ts'

export const spotifyTasteSignalSchema = z.object({
  artistName: z.string().min(1),
  trackTitle: z.string().optional(),
  frequency: z.number().int().positive().default(1),
  affinityWeight: z.number().min(0).max(5).default(1.0),
  lastSeenAt: z.number().positive(),
  sourcePlaylist: z.string().optional(),
})

export type SpotifyTasteSignal = z.infer<typeof spotifyTasteSignalSchema>

export const spotifyTasteProfileSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean().default(true),
  updatedAt: z.number().positive(),
  totalTracksIndexed: z.number().nonnegative(),
  artists: z.array(
    z.object({
      name: z.string().min(1),
      normalizedName: z.string().min(1),
      count: z.number().positive(),
      weight: z.number().positive(),
    }),
  ),
  seedQueries: z.array(z.string()).default([]),
})

export type SpotifyTasteProfile = z.infer<typeof spotifyTasteProfileSchema>

export const spotifyBridgeTelemetrySchema = z.object({
  signalsIngested: z.number().nonnegative(),
  boostedTracksCount: z.number().nonnegative(),
  seedQueriesGenerated: z.number().nonnegative(),
  lastSyncTimestamp: z.number().nullable(),
  lastError: z.string().nullable(),
})

export type SpotifyBridgeTelemetry = z.infer<typeof spotifyBridgeTelemetrySchema>

const telemetry: SpotifyBridgeTelemetry = {
  signalsIngested: 0,
  boostedTracksCount: 0,
  seedQueriesGenerated: 0,
  lastSyncTimestamp: null,
  lastError: null,
}

export function getSpotifyBridgeTelemetry(): SpotifyBridgeTelemetry {
  return { ...telemetry }
}

export function resetSpotifyBridgeTelemetry(): void {
  telemetry.signalsIngested = 0
  telemetry.boostedTracksCount = 0
  telemetry.seedQueriesGenerated = 0
  telemetry.lastSyncTimestamp = null
  telemetry.lastError = null
}

const SPOTIFY_PROFILE_CACHE_KEY = 'spotify_taste_profile'

let memoryProfile: SpotifyTasteProfile = {
  version: 1,
  enabled: true,
  updatedAt: Date.now(),
  totalTracksIndexed: 0,
  artists: [],
  seedQueries: [],
}

function normalizeArtist(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Retrieve Spotify taste profile from memory or Dexie metadataCache
 */
export async function getSpotifyTasteProfile(): Promise<SpotifyTasteProfile> {
  if (typeof indexedDB !== 'undefined' && db?.metadataCache) {
    try {
      const cached = await db.metadataCache.get(SPOTIFY_PROFILE_CACHE_KEY)
      if (cached && cached.data) {
        const parsed = spotifyTasteProfileSchema.safeParse(cached.data)
        if (parsed.success) {
          memoryProfile = parsed.data
          return memoryProfile
        }
      }
    } catch (err) {
      telemetry.lastError = err instanceof Error ? err.message : String(err)
    }
  }
  return memoryProfile
}

/**
 * Persist Spotify taste profile to memory and Dexie metadataCache
 */
async function persistProfile(profile: SpotifyTasteProfile): Promise<void> {
  memoryProfile = profile
  if (typeof indexedDB !== 'undefined' && db?.metadataCache) {
    try {
      await db.metadataCache.put({
        key: SPOTIFY_PROFILE_CACHE_KEY,
        kind: 'suggestions',
        data: profile,
        updatedAt: profile.updatedAt,
        expiresAt: profile.updatedAt + 365 * 24 * 60 * 60 * 1000,
      })
    } catch (err) {
      telemetry.lastError = err instanceof Error ? err.message : String(err)
    }
  }
}

/**
 * Record Spotify taste signals from imported playlists or library tracks
 */
export async function recordSpotifyTasteSignals(
  tracks: Array<{ title: string; artistName: string }>,
  _options?: { sourcePlaylist?: string },
): Promise<SpotifyTasteProfile> {
  if (!tracks || tracks.length === 0) {
    return await getSpotifyTasteProfile()
  }

  const current = await getSpotifyTasteProfile()
  const artistMap = new Map<string, { name: string; count: number }>()

  // Preserve existing artist counts
  for (const a of current.artists) {
    artistMap.set(a.normalizedName, { name: a.name, count: a.count })
  }

  // Tally new track artists
  for (const t of tracks) {
    if (!t.artistName) continue
    const norm = normalizeArtist(t.artistName)
    if (!norm) continue

    const existing = artistMap.get(norm)
    if (existing) {
      existing.count++
    } else {
      artistMap.set(norm, { name: t.artistName.trim(), count: 1 })
    }
  }

  // Compute normalized weights: 1.0 base + log2 boost capped at 3.0
  const updatedArtists = [...artistMap.entries()]
    .map(([normalizedName, data]) => ({
      name: data.name,
      normalizedName,
      count: data.count,
      weight: Math.min(3.0, 1.0 + Math.log2(data.count) * 0.5),
    }))
    .sort((a, b) => b.count - a.count)

  // Generate seed queries for InnerTube exploration
  const topSeeds = updatedArtists.slice(0, 10).map((a) => `${a.name} mix`)

  const updatedProfile: SpotifyTasteProfile = {
    version: 1,
    enabled: current.enabled,
    updatedAt: Date.now(),
    totalTracksIndexed: current.totalTracksIndexed + tracks.length,
    artists: updatedArtists,
    seedQueries: topSeeds,
  }

  telemetry.signalsIngested += tracks.length
  telemetry.seedQueriesGenerated = topSeeds.length
  telemetry.lastSyncTimestamp = updatedProfile.updatedAt

  await persistProfile(updatedProfile)
  return updatedProfile
}

/**
 * Toggle the recommendation bridge on or off
 */
export async function setSpotifyBridgeEnabled(enabled: boolean): Promise<SpotifyTasteProfile> {
  const current = await getSpotifyTasteProfile()
  const updated: SpotifyTasteProfile = {
    ...current,
    enabled,
    updatedAt: Date.now(),
  }
  await persistProfile(updated)
  return updated
}

/**
 * Clear all indexed Spotify taste signals
 */
export async function clearSpotifyTasteProfile(): Promise<void> {
  const empty: SpotifyTasteProfile = {
    version: 1,
    enabled: true,
    updatedAt: Date.now(),
    totalTracksIndexed: 0,
    artists: [],
    seedQueries: [],
  }
  await persistProfile(empty)
}

/**
 * Synchronous lookup of Spotify artist weights if the bridge is currently enabled
 */
export function getSpotifyArtistWeights(): Map<string, number> {
  const weights = new Map<string, number>()
  if (!memoryProfile.enabled) return weights

  for (const a of memoryProfile.artists) {
    weights.set(a.normalizedName, a.weight)
  }
  return weights
}

/**
 * Apply Spotify affinity bonus to scored tracks
 */
export function applySpotifyAffinityBonus(scoredTracks: ScoredTrack[]): ScoredTrack[] {
  if (!memoryProfile.enabled || memoryProfile.artists.length === 0) {
    return scoredTracks
  }

  const weights = getSpotifyArtistWeights()
  let boostedCount = 0

  const boosted = scoredTracks.map((st) => {
    if (!st.artistName) return st
    const norm = normalizeArtist(st.artistName)
    const weight = weights.get(norm)
    if (weight) {
      boostedCount++
      return {
        ...st,
        score: st.score + weight,
      }
    }
    return st
  })

  telemetry.boostedTracksCount += boostedCount
  return boosted.sort((a, b) => b.score - a.score)
}

/**
 * Get Spotify seed queries for InnerTube exploration
 */
export function getSpotifySeedQueries(limit = 5): string[] {
  if (!memoryProfile.enabled) return []
  return memoryProfile.seedQueries.slice(0, limit)
}
