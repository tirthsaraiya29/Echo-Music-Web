import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { InnerTubeClient } from '../services/innertube/client.ts'
import type { Album, Artist, Track } from '../types/domain.ts'

export const artistIdInputSchema = z.string().trim().min(1).max(256)

export const artistDetailSchema = z.object({
  artist: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    bio: z.string().optional(),
    subscribers: z.string().optional(),
    monthlyListeners: z.number().optional(),
  }),
  topTracks: z.array(z.record(z.string(), z.unknown())),
  albums: z.array(z.record(z.string(), z.unknown())),
  singles: z.array(z.record(z.string(), z.unknown())),
  relatedArtists: z.array(z.record(z.string(), z.unknown())),
})

export const artistMetricsSchema = z.object({
  loadsCount: z.number().nonnegative(),
  failuresCount: z.number().nonnegative(),
  lastError: z.string().nullable(),
})

export type ArtistMetrics = z.infer<typeof artistMetricsSchema>

const artistMetrics: ArtistMetrics = {
  loadsCount: 0,
  failuresCount: 0,
  lastError: null,
}

export function getArtistMetrics(): ArtistMetrics {
  return { ...artistMetrics }
}

export function resetArtistMetrics(): void {
  artistMetrics.loadsCount = 0
  artistMetrics.failuresCount = 0
  artistMetrics.lastError = null
}

export interface ArtistDetailResult {
  artist: Artist
  topTracks: Track[]
  albums: Album[]
  singles: Album[]
  relatedArtists: Artist[]
}

/**
 * Hook to retrieve and cache artist metadata, top tracks, albums, and related artists.
 * Automatically validates input ID, propagates abort signals, and tracks operational telemetry.
 */
export function useArtist(artistId?: string) {
  const validation = artistIdInputSchema.safeParse(artistId)
  const normalizedId = validation.success ? validation.data : ''

  return useQuery<ArtistDetailResult, Error>({
    queryKey: ['artist', normalizedId],
    queryFn: async ({ signal }) => {
      artistMetrics.loadsCount++
      try {
        return await InnerTubeClient.fetchArtist(normalizedId, { signal })
      } catch (err) {
        artistMetrics.failuresCount++
        artistMetrics.lastError = err instanceof Error ? err.message : String(err)
        throw err
      }
    },
    enabled: normalizedId.length > 0,
    staleTime: 30 * 60 * 1000, // 30 minutes
  })
}
