/**
 * Spotify URL resolution schemas, domain types, and metrics instrumentation.
 */

import { z } from 'zod'

export const spotifyUrlInputSchema = z
  .string()
  .trim()
  .min(1, 'Spotify URL cannot be empty')
  .max(1000, 'URL too long')
  .refine(
    (val) => {
      try {
        const u = new URL(val)
        const host = u.hostname.toLowerCase()
        if (host !== 'open.spotify.com' && host !== 'spotify.link') {
          return false
        }
        const parts = u.pathname.split('/').filter(Boolean)
        if (host === 'spotify.link') {
          return parts.length > 0
        }
        // open.spotify.com/(intl-[a-z]+/)?(playlist|album|track|artist|episode|show)/[id]
        const validTypes = new Set(['playlist', 'album', 'track', 'artist', 'episode', 'show'])
        const typeIndex = parts[0]?.startsWith('intl-') ? 1 : 0
        const entityType = parts[typeIndex]
        return Boolean(entityType && validTypes.has(entityType) && parts[typeIndex + 1])
      } catch {
        return false
      }
    },
    {
      message: 'Must be a valid Spotify link (e.g. open.spotify.com/playlist, album, or track)',
    },
  )

export const spotifyResolvedTrackSchema = z.object({
  title: z.string().min(1),
  artist: z.string().min(1),
  album: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  isrc: z.string().optional(),
})

export type SpotifyResolvedTrack = z.infer<typeof spotifyResolvedTrackSchema>

export const spotifyResolvedDataSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  coverUrl: z.string().optional(),
  totalTracks: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
  hasMore: z.boolean().optional(),
  tracks: z.array(spotifyResolvedTrackSchema),
})

export type SpotifyResolvedData = z.infer<typeof spotifyResolvedDataSchema>

export const spotifyResolveOptionsSchema = z.object({
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(100).default(100),
  timeoutMs: z.number().int().min(1000).max(60000).default(10000),
})

export type SpotifyResolveOptions = z.infer<typeof spotifyResolveOptionsSchema>

export const spotifyUrlMetricsSchema = z.object({
  resolutionsRequested: z.number().int().nonnegative(),
  resolutionsCached: z.number().int().nonnegative(),
  resolutionsSucceeded: z.number().int().nonnegative(),
  resolutionsFailed: z.number().int().nonnegative(),
  inFlightDeduplications: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
  cancellations: z.number().int().nonnegative(),
})

export type SpotifyUrlMetrics = z.infer<typeof spotifyUrlMetricsSchema>

let metrics: SpotifyUrlMetrics = {
  resolutionsRequested: 0,
  resolutionsCached: 0,
  resolutionsSucceeded: 0,
  resolutionsFailed: 0,
  inFlightDeduplications: 0,
  retries: 0,
  cancellations: 0,
}

export function getSpotifyUrlMetrics(): SpotifyUrlMetrics {
  return { ...metrics }
}

export function resetSpotifyUrlMetrics(): void {
  metrics = {
    resolutionsRequested: 0,
    resolutionsCached: 0,
    resolutionsSucceeded: 0,
    resolutionsFailed: 0,
    inFlightDeduplications: 0,
    retries: 0,
    cancellations: 0,
  }
}

export function recordSpotifyUrlMetric(metric: keyof SpotifyUrlMetrics): void {
  metrics[metric]++
}
