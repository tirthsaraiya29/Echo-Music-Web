/**
 * Liked Albums Synchronization Service for Echo Music Web
 *
 * Implements first-class liked album persistence, cloud sync with YouTube Music,
 * and anti-wipe protections matching upstream Echo Music architecture:
 * - SyncUtils.kt (executeSyncLikedAlbums)
 * - AccountViewModel.kt
 */

import { z } from 'zod'
import { useEchoStore } from '../../stores/useEchoStore.ts'
import { getStoredYouTubeSession } from '../innertube/accountAuthService.ts'

// ============================================================================
// Schemas
// ============================================================================

export const likedAlbumEntitySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  artistName: z.string().min(1),
  artistId: z.string().optional(),
  year: z.number().optional(),
  coverUrl: z.string().optional(),
  trackCount: z.number().nonnegative().optional(),
  likedAt: z.number().nonnegative().default(() => Date.now()),
  source: z.enum(['local', 'cloud', 'spotify']).default('local'),
})

export type LikedAlbumEntity = z.infer<typeof likedAlbumEntitySchema>

export const likedAlbumsSyncActionSchema = z.enum([
  'no_change',
  'wipe_prevented',
  'additive_merge',
  'full_update',
  'error',
])

export type LikedAlbumsSyncAction = z.infer<typeof likedAlbumsSyncActionSchema>

export const likedAlbumsSyncResultSchema = z.object({
  action: likedAlbumsSyncActionSchema,
  localCount: z.number().nonnegative(),
  remoteCount: z.number().nonnegative(),
  addedCount: z.number().nonnegative(),
  message: z.string(),
  syncedAt: z.number().nonnegative(),
})

export type LikedAlbumsSyncResult = z.infer<typeof likedAlbumsSyncResultSchema>

export const likedAlbumsSyncMetricsSchema = z.object({
  syncAttemptsCount: z.number().nonnegative(),
  syncSuccessCount: z.number().nonnegative(),
  syncErrorsCount: z.number().nonnegative(),
  wipesPreventedCount: z.number().nonnegative(),
  albumsSyncedCount: z.number().nonnegative(),
  additiveSyncsCount: z.number().nonnegative(),
})

export type LikedAlbumsSyncMetrics = z.infer<typeof likedAlbumsSyncMetricsSchema>

// ============================================================================
// Telemetry State
// ============================================================================

let metrics: LikedAlbumsSyncMetrics = {
  syncAttemptsCount: 0,
  syncSuccessCount: 0,
  syncErrorsCount: 0,
  wipesPreventedCount: 0,
  albumsSyncedCount: 0,
  additiveSyncsCount: 0,
}

export function recordLikedAlbumsMetric(
  key: keyof LikedAlbumsSyncMetrics,
  delta = 1,
): void {
  if (key in metrics) {
    metrics[key] += delta
  }
}

export function getLikedAlbumsMetrics(): LikedAlbumsSyncMetrics {
  return { ...metrics }
}

export function resetLikedAlbumsMetrics(): void {
  metrics = {
    syncAttemptsCount: 0,
    syncSuccessCount: 0,
    syncErrorsCount: 0,
    wipesPreventedCount: 0,
    albumsSyncedCount: 0,
    additiveSyncsCount: 0,
  }
}

// ============================================================================
// Anti-Wipe & Reconcile Algorithm (Matching upstream SyncUtils.kt)
// ============================================================================

export interface ReconcileLikedAlbumsOptions {
  localAlbums: LikedAlbumEntity[]
  remoteAlbums: LikedAlbumEntity[]
  allowEmptyRemote?: boolean | undefined
}

export interface ReconcileAlbumsResult {
  action: LikedAlbumsSyncAction
  finalAlbums: LikedAlbumEntity[]
  addedCount: number
  message: string
}

export function reconcileLikedAlbums(options: ReconcileLikedAlbumsOptions): ReconcileAlbumsResult {
  const { localAlbums, remoteAlbums, allowEmptyRemote = false } = options

  // 1. Anti-wipe check: Remote is empty but local has albums
  if (remoteAlbums.length === 0) {
    if (localAlbums.length > 0 && !allowEmptyRemote) {
      recordLikedAlbumsMetric('wipesPreventedCount')
      return {
        action: 'wipe_prevented',
        finalAlbums: [...localAlbums],
        addedCount: 0,
        message: 'Remote returned empty — wipe prevented to protect local liked albums',
      }
    }
    if (allowEmptyRemote) {
      return {
        action: 'full_update',
        finalAlbums: [],
        addedCount: 0,
        message: 'Empty remote accepted (allowEmptyRemote=true)',
      }
    }
  }

  const localMap = new Map(localAlbums.map((a) => [a.id, a]))
  const remoteMap = new Map(remoteAlbums.map((a) => [a.id, a]))

  const isIdentical =
    localAlbums.length === remoteAlbums.length &&
    localAlbums.every((a, i) => a.id === remoteAlbums[i]?.id)

  if (isIdentical) {
    return {
      action: 'no_change',
      finalAlbums: [...localAlbums],
      addedCount: 0,
      message: 'Liked albums are already in sync with cloud',
    }
  }

  // 2. Additive-only merge check: Local has albums missing from cloud
  const localOnly = localAlbums.filter((a) => !remoteMap.has(a.id))
  if (localOnly.length > 0) {
    recordLikedAlbumsMetric('additiveSyncsCount')
    const missingFromLocal = remoteAlbums.filter((a) => !localMap.has(a.id))
    const merged = [...localAlbums, ...missingFromLocal]

    recordLikedAlbumsMetric('albumsSyncedCount', missingFromLocal.length)

    return {
      action: 'additive_merge',
      finalAlbums: merged,
      addedCount: missingFromLocal.length,
      message: `Preserved ${localOnly.length} local album(s) and merged ${missingFromLocal.length} cloud album(s)`,
    }
  }

  // 3. Full update from cloud
  const added = remoteAlbums.filter((a) => !localMap.has(a.id)).length
  recordLikedAlbumsMetric('albumsSyncedCount', added)

  return {
    action: 'full_update',
    finalAlbums: [...remoteAlbums],
    addedCount: added,
    message: `Updated liked albums from cloud (${remoteAlbums.length} albums)`,
  }
}

// ============================================================================
// Cloud Sync Execution
// ============================================================================

export async function syncLikedAlbumsWithCloud(
  cookieOverride?: string,
): Promise<LikedAlbumsSyncResult> {
  recordLikedAlbumsMetric('syncAttemptsCount')
  const store = useEchoStore.getState()
  const localAlbums = store.likedAlbums || []
  const session = getStoredYouTubeSession()
  const cookie = cookieOverride || session?.cookie

  try {
    const remoteAlbums: LikedAlbumEntity[] = []
    const headers: HeadersInit = { 'Content-Type': 'application/json' }
    if (cookie) {
      headers['x-innertube-cookie'] = cookie
    }

    const res = await fetch('/api/innertube/browse', {
      method: 'POST',
      headers,
      body: JSON.stringify({ browseId: 'FEmusic_liked_albums' }),
    })

    if (res.ok) {
      const data = await res.json()
      const sections =
        data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
          ?.sectionListRenderer?.contents || []

      for (const sec of sections) {
        const gridItems = sec?.gridRenderer?.items || sec?.musicShelfRenderer?.contents || []
        for (const item of gridItems) {
          const renderer = item?.musicTwoRowItemRenderer
          if (renderer) {
            const id =
              renderer.navigationEndpoint?.browseEndpoint?.browseId ||
              renderer.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
            const title = renderer.title?.runs?.[0]?.text || renderer.title?.simpleText
            const artistName =
              renderer.subtitle?.runs?.[0]?.text || renderer.subtitle?.simpleText || 'Artist'
            const coverUrl =
              renderer.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url

            if (id && title) {
              remoteAlbums.push({
                id,
                title,
                artistName,
                coverUrl,
                likedAt: Date.now(),
                source: 'cloud',
              })
            }
          }
        }
      }
    }

    const reconcile = reconcileLikedAlbums({
      localAlbums,
      remoteAlbums,
    })

    if (reconcile.action !== 'no_change') {
      store.setLikedAlbums(reconcile.finalAlbums)
    }

    recordLikedAlbumsMetric('syncSuccessCount')

    return likedAlbumsSyncResultSchema.parse({
      action: reconcile.action,
      localCount: localAlbums.length,
      remoteCount: remoteAlbums.length,
      addedCount: reconcile.addedCount,
      message: reconcile.message,
      syncedAt: Date.now(),
    })
  } catch (err) {
    recordLikedAlbumsMetric('syncErrorsCount')
    const message = err instanceof Error ? err.message : String(err)
    return likedAlbumsSyncResultSchema.parse({
      action: 'error',
      localCount: localAlbums.length,
      remoteCount: 0,
      addedCount: 0,
      message,
      syncedAt: Date.now(),
    })
  }
}
