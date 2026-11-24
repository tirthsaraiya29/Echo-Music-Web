/**
 * Vibe Summary Service for Echo Music Web
 *
 * Analyzes listening history patterns, time-of-day distribution, completion rates,
 * and artist/genre frequency to generate an intelligent personalized listening vibe.
 */

import { z } from 'zod'
import { db, type ListeningHistoryRecord } from '../db/echoDatabase.ts'
import { useEchoStore } from '../../stores/useEchoStore.ts'

// ============================================================================
// Schemas
// ============================================================================

export const vibeMoodSchema = z.enum([
  'chill',
  'energetic',
  'focused',
  'nostalgic',
  'melancholic',
  'eclectic',
  'balanced',
])

export type VibeMood = z.infer<typeof vibeMoodSchema>

export const vibeSummarySchema = z.object({
  archetype: z.string().min(1),
  headline: z.string().min(1),
  description: z.string().min(1),
  dominantMood: vibeMoodSchema,
  dominantTimeOfDay: z.enum(['morning', 'afternoon', 'evening', 'night']),
  totalTracksListened: z.number().int().nonnegative(),
  totalListeningMinutes: z.number().int().nonnegative(),
  completionRatePct: z.number().min(0).max(100),
  timeDistribution: z.object({
    morning: z.number().min(0).max(100),
    afternoon: z.number().min(0).max(100),
    evening: z.number().min(0).max(100),
    night: z.number().min(0).max(100),
  }),
  topGenres: z.array(
    z.object({
      name: z.string(),
      percentage: z.number().min(0).max(100),
    }),
  ),
  topArtists: z.array(
    z.object({
      name: z.string(),
      count: z.number().int().positive(),
      artwork: z.string().optional(),
    }),
  ),
  topTracks: z.array(
    z.object({
      trackId: z.string(),
      title: z.string(),
      artist: z.string(),
      count: z.number().int().positive(),
      artwork: z.string().optional(),
    }),
  ),
  generatedAt: z.number().nonnegative(),
})

export type VibeSummary = z.infer<typeof vibeSummarySchema>

export const vibeSummaryMetricsSchema = z.object({
  summariesGeneratedCount: z.number().nonnegative(),
  vibesSharedCount: z.number().nonnegative(),
})

export type VibeSummaryMetrics = z.infer<typeof vibeSummaryMetricsSchema>

// ============================================================================
// Telemetry & Metrics
// ============================================================================

let metrics: VibeSummaryMetrics = {
  summariesGeneratedCount: 0,
  vibesSharedCount: 0,
}

export function recordVibeMetric(key: keyof VibeSummaryMetrics, delta = 1): void {
  if (key in metrics) {
    metrics[key] += delta
  }
}

export function getVibeMetrics(): VibeSummaryMetrics {
  return { ...metrics }
}

export function resetVibeMetrics(): void {
  metrics = {
    summariesGeneratedCount: 0,
    vibesSharedCount: 0,
  }
}

// ============================================================================
// Genre Inference Heuristics
// ============================================================================

const GENRE_KEYWORDS: Record<string, string[]> = {
  Electronic: ['synth', 'beat', 'remix', 'electronic', 'dance', 'techno', 'house', 'edm', 'daft'],
  Rock: ['rock', 'guitar', 'metal', 'band', 'punk', 'floyd', 'beatles', 'zeppelin'],
  'Hip-Hop & R&B': ['rap', 'hip hop', 'trap', 'r&b', 'soul', 'flow', 'rhyme'],
  Pop: ['pop', 'radio', 'single', 'hits', 'charts'],
  Acoustic: ['acoustic', 'folk', 'unplugged', 'piano', 'chilled', 'serene', 'calm'],
  Ambient: ['ambient', 'meditation', 'drone', 'sleep', 'rain', 'lofi', 'lo-fi'],
  Classical: ['orchestra', 'symphony', 'concerto', 'sonata', 'classical'],
}

function inferGenreFromMetadata(title: string, artist: string, album?: string): string {
  const combined = `${title} ${artist} ${album || ''}`.toLowerCase()
  for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS)) {
    if (keywords.some((k) => combined.includes(k))) {
      return genre
    }
  }
  return 'Alternative'
}

// ============================================================================
// Vibe Analysis & Generation Algorithm
// ============================================================================

export function generateVibeFromHistoryRecords(records: ListeningHistoryRecord[]): VibeSummary {
  recordVibeMetric('summariesGeneratedCount')

  if (records.length === 0) {
    // Default fallback when listening history is completely fresh
    return vibeSummarySchema.parse({
      archetype: 'Curious Pioneer',
      headline: 'Fresh Canvas',
      description: 'Your sonic journey is just beginning. Play a few favorites to reveal your true vibe.',
      dominantMood: 'chill',
      dominantTimeOfDay: 'afternoon',
      totalTracksListened: 0,
      totalListeningMinutes: 0,
      completionRatePct: 100,
      timeDistribution: { morning: 25, afternoon: 25, evening: 25, night: 25 },
      topGenres: [{ name: 'Eclectic', percentage: 100 }],
      topArtists: [],
      topTracks: [],
      generatedAt: Date.now(),
    })
  }

  const totalTracks = records.length
  const totalDurationMs = records.reduce((acc, r) => acc + (r.durationPlayedMs || 0), 0)
  const totalListeningMinutes = Math.max(1, Math.round(totalDurationMs / (60 * 1000)))

  // 1. Completion Rate
  const completedCount = records.filter((r) => r.completed && !r.skipped).length
  const completionRatePct = Math.min(100, Math.round((completedCount / totalTracks) * 100))

  // 2. Time-of-day distribution
  const timeCounts = { morning: 0, afternoon: 0, evening: 0, night: 0 }
  for (const r of records) {
    const tod = r.timeOfDay || 'afternoon'
    timeCounts[tod] = (timeCounts[tod] || 0) + 1
  }

  const timeDistribution = {
    morning: Math.round((timeCounts.morning / totalTracks) * 100),
    afternoon: Math.round((timeCounts.afternoon / totalTracks) * 100),
    evening: Math.round((timeCounts.evening / totalTracks) * 100),
    night: Math.round((timeCounts.night / totalTracks) * 100),
  }

  // Dominant time of day
  const dominantTimeOfDay = (
    Object.keys(timeCounts) as Array<keyof typeof timeCounts>
  ).reduce((a, b) => (timeCounts[a] >= timeCounts[b] ? a : b))

  // 3. Artist Frequencies
  const artistCounts: Record<string, { count: number; artwork?: string | undefined }> = {}
  for (const r of records) {
    const artist = r.artistName || 'Unknown Artist'
    if (!artistCounts[artist]) {
      artistCounts[artist] = { count: 0, artwork: r.artwork }
    }
    artistCounts[artist]!.count += 1
  }

  const topArtists = Object.entries(artistCounts)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 5)
    .map(([name, data]) => ({
      name,
      count: data.count,
      ...(data.artwork ? { artwork: data.artwork } : {}),
    }))

  // 4. Track Frequencies
  const trackCounts: Record<
    string,
    { title: string; artist: string; count: number; artwork?: string | undefined }
  > = {}
  for (const r of records) {
    if (!trackCounts[r.trackId]) {
      trackCounts[r.trackId] = {
        title: r.trackTitle,
        artist: r.artistName,
        count: 0,
        artwork: r.artwork,
      }
    }
    trackCounts[r.trackId]!.count += 1
  }

  const topTracks = Object.entries(trackCounts)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 5)
    .map(([trackId, data]) => ({
      trackId,
      title: data.title,
      artist: data.artist,
      count: data.count,
      ...(data.artwork ? { artwork: data.artwork } : {}),
    }))

  // 5. Genre Frequencies
  const genreCounts: Record<string, number> = {}
  for (const r of records) {
    const g = inferGenreFromMetadata(r.trackTitle, r.artistName, r.albumTitle)
    genreCounts[g] = (genreCounts[g] || 0) + 1
  }

  const topGenres = Object.entries(genreCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([name, count]) => ({
      name,
      percentage: Math.min(100, Math.round((count / totalTracks) * 100)),
    }))

  // 6. Archetype & Mood Synthesis
  let archetype = 'Eclectic Harmonist'
  let headline = 'Versatile & Dynamic'
  let description = 'A versatile palate effortlessly traversing moods, genres, and moments.'
  let dominantMood: VibeMood = 'balanced'

  if (dominantTimeOfDay === 'night' && completionRatePct >= 70) {
    archetype = 'Midnight Deep Diver'
    headline = 'Nocturnal Resonance'
    description = 'Immersed in late-night soundscapes, playing deep album tracks without skipping a beat.'
    dominantMood = 'chill'
  } else if (dominantTimeOfDay === 'morning') {
    archetype = 'Dawn Flow Pioneer'
    headline = 'Calm & Intentional'
    description = 'Welcoming the day with focused, mindful listening and calm melodies.'
    dominantMood = 'focused'
  } else if (topArtists.length > 0 && topArtists[0]!.count / totalTracks >= 0.35) {
    archetype = 'Devoted Discophile'
    headline = `Immersed in ${topArtists[0]!.name}`
    description = `Deep emotional loyalty to your favorite artists, keeping their catalog on high replay.`
    dominantMood = 'nostalgic'
  } else if (topGenres.some((g) => g.name === 'Electronic' || g.name === 'Pop')) {
    archetype = 'High-Tempo Spark'
    headline = 'Pure Energy & Pulse'
    description = 'Thriving on driving basslines, high BPMs, and uplifting hooks.'
    dominantMood = 'energetic'
  } else if (completionRatePct < 50) {
    archetype = 'Sound Nomad'
    headline = 'Curator on the Move'
    description = 'Restlessly seeking the exact right vibration, exploring diverse songs and moods.'
    dominantMood = 'eclectic'
  }

  return vibeSummarySchema.parse({
    archetype,
    headline,
    description,
    dominantMood,
    dominantTimeOfDay,
    totalTracksListened: totalTracks,
    totalListeningMinutes,
    completionRatePct,
    timeDistribution,
    topGenres,
    topArtists,
    topTracks,
    generatedAt: Date.now(),
  })
}

export async function fetchCurrentVibeSummary(): Promise<VibeSummary> {
  let records: ListeningHistoryRecord[] = []
  if (typeof indexedDB !== 'undefined') {
    try {
      records = await db.history.toArray()
    } catch {
      records = []
    }
  }

  // If no DB records exist yet, synthesize from store recent items
  if (records.length === 0) {
    const store = useEchoStore.getState()
    const recent = store.recentItems || []
    if (recent.length > 0) {
      records = recent.map((item, idx) => ({
        trackId: item.id,
        trackTitle: item.title,
        artistName: item.subtitle,
        playedAt: item.at || Date.now() - idx * 60000,
        durationPlayedMs: 180000,
        trackDurationMs: 180000,
        completed: true,
        skipped: false,
        timeOfDay: 'afternoon',
        artwork: item.image,
      }))
    }
  }

  return generateVibeFromHistoryRecords(records)
}
