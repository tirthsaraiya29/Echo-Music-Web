import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { InnerTubeClient } from '../services/innertube/client.ts'
import type { Album, Track } from '../types/domain.ts'

export const albumIdInputSchema = z.string().trim().min(1).max(256)

export const albumDetailSchema = z.object({
  album: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    artistName: z.string().optional(),
    year: z.number().optional(),
  }),
  tracks: z.array(z.record(z.string(), z.unknown())),
})

export const albumMetricsSchema = z.object({
  loadsCount: z.number().nonnegative(),
  failuresCount: z.number().nonnegative(),
  lastError: z.string().nullable(),
})

export type AlbumMetrics = z.infer<typeof albumMetricsSchema>

const albumMetrics: AlbumMetrics = {
  loadsCount: 0,
  failuresCount: 0,
  lastError: null,
}

export function getAlbumMetrics(): AlbumMetrics {
  return { ...albumMetrics }
}

export function resetAlbumMetrics(): void {
  albumMetrics.loadsCount = 0
  albumMetrics.failuresCount = 0
  albumMetrics.lastError = null
}

export interface AlbumDetailResult {
  album: Album
  tracks: Track[]
}

export function useAlbum(albumId?: string) {
  const validation = albumIdInputSchema.safeParse(albumId)
  const normalizedId = validation.success ? validation.data : ''

  return useQuery<AlbumDetailResult, Error>({
    queryKey: ['album', normalizedId],
    queryFn: async ({ signal }) => {
      albumMetrics.loadsCount++
      try {
        return await InnerTubeClient.fetchAlbum(normalizedId, { signal })
      } catch (err) {
        albumMetrics.failuresCount++
        albumMetrics.lastError = err instanceof Error ? err.message : String(err)
        throw err
      }
    },
    enabled: normalizedId.length > 0,
    staleTime: 30 * 60 * 1000, // 30 minutes
  })
}
