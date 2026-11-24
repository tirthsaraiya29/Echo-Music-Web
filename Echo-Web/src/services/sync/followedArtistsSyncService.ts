/**
 * Followed Artists Synchronization Service for Echo Music Web
 *
 * Implements first-class followed artist persistence, cloud sync with YouTube Music
 * (FEmusic_library_corpus_artists), anti-wipe protections, and new releases discovery
 * matching upstream Echo Music architecture:
 * - SyncUtils.kt (executeSyncArtists)
 * - AccountViewModel.kt
 */

import { z } from 'zod'
import { useEchoStore } from '../../stores/useEchoStore.ts'
import { getStoredYouTubeSession } from '../innertube/accountAuthService.ts'

// ============================================================================
// Schemas
// ============================================================================

export const followedArtistEntitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  thumbnailUrl: z.string().optional(),
  subscribers: z.string().optional(),
  followedAt: z.number().nonnegative().default(() => Date.now()),
  source: z.enum(['local', 'cloud', 'spotify']).default('local'),
})

export type FollowedArtistEntity = z.infer<typeof followedArtistEntitySchema>

export const artistNewReleaseSchema = z.object({
  id: z.string().min(1),
  artistId: z.string().min(1),
  artistName: z.string().min(1),
  title: z.string().min(1),
  coverUrl: z.string().optional(),
  releaseDate: z.string().optional(),
  year: z.number().optional(),
  type: z.enum(['album', 'single', 'ep']).default('album'),
})

export type ArtistNewRelease = z.infer<typeof artistNewReleaseSchema>

export const followedArtistsSyncActionSchema = z.enum([
  'no_change',
  'wipe_prevented',
  'additive_merge',
  'full_update',
  'error',
])

export type FollowedArtistsSyncAction = z.infer<typeof followedArtistsSyncActionSchema>

export const followedArtistsSyncResultSchema = z.object({
  action: followedArtistsSyncActionSchema,
  localCount: z.number().nonnegative(),
  remoteCount: z.number().nonnegative(),
  addedCount: z.number().nonnegative(),
  message: z.string(),
  syncedAt: z.number().nonnegative(),
})

export type FollowedArtistsSyncResult = z.infer<typeof followedArtistsSyncResultSchema>

export const followedArtistsSyncMetricsSchema = z.object({
  syncAttemptsCount: z.number().nonnegative(),
  syncSuccessCount: z.number().nonnegative(),
  syncErrorsCount: z.number().nonnegative(),
  wipesPreventedCount: z.number().nonnegative(),
  artistsSyncedCount: z.number().nonnegative(),
  additiveSyncsCount: z.number().nonnegative(),
  newReleasesFetchedCount: z.number().nonnegative(),
})

export type FollowedArtistsSyncMetrics = z.infer<typeof followedArtistsSyncMetricsSchema>

// ============================================================================
// Telemetry State
// ============================================================================

let metrics: FollowedArtistsSyncMetrics = {
  syncAttemptsCount: 0,
  syncSuccessCount: 0,
  syncErrorsCount: 0,
  wipesPreventedCount: 0,
  artistsSyncedCount: 0,
  additiveSyncsCount: 0,
  newReleasesFetchedCount: 0,
}

export function recordFollowedArtistsMetric(
  key: keyof FollowedArtistsSyncMetrics,
  delta = 1,
): void {
  if (key in metrics) {
    metrics[key] += delta
  }
}

export function getFollowedArtistsMetrics(): FollowedArtistsSyncMetrics {
  return { ...metrics }
}

export function resetFollowedArtistsMetrics(): void {
  metrics = {
    syncAttemptsCount: 0,
    syncSuccessCount: 0,
    syncErrorsCount: 0,
    wipesPreventedCount: 0,
    artistsSyncedCount: 0,
    additiveSyncsCount: 0,
    newReleasesFetchedCount: 0,
  }
}

// ============================================================================
// Anti-Wipe & Reconcile Algorithm (Matching upstream SyncUtils.kt)
// ============================================================================

export interface ReconcileFollowedArtistsOptions {
  localArtists: FollowedArtistEntity[]
  remoteArtists: FollowedArtistEntity[]
  allowEmptyRemote?: boolean | undefined
}

export interface ReconcileArtistsResult {
  action: FollowedArtistsSyncAction
  finalArtists: FollowedArtistEntity[]
  addedCount: number
  message: string
}

export function reconcileFollowedArtists(
  options: ReconcileFollowedArtistsOptions,
): ReconcileArtistsResult {
  const { localArtists, remoteArtists, allowEmptyRemote = false } = options

  // 1. Anti-wipe check: Remote is empty but local has followed artists
  if (remoteArtists.length === 0) {
    if (localArtists.length > 0 && !allowEmptyRemote) {
      recordFollowedArtistsMetric('wipesPreventedCount')
      return {
        action: 'wipe_prevented',
        finalArtists: [...localArtists],
        addedCount: 0,
        message: 'Remote returned empty — wipe prevented to protect local followed artists',
      }
    }
    if (allowEmptyRemote) {
      return {
        action: 'full_update',
        finalArtists: [],
        addedCount: 0,
        message: 'Empty remote accepted (allowEmptyRemote=true)',
      }
    }
  }

  const localMap = new Map(localArtists.map((a) => [a.id, a]))
  const remoteMap = new Map(remoteArtists.map((a) => [a.id, a]))

  const isIdentical =
    localArtists.length === remoteArtists.length &&
    localArtists.every((a, i) => a.id === remoteArtists[i]?.id)

  if (isIdentical) {
    return {
      action: 'no_change',
      finalArtists: [...localArtists],
      addedCount: 0,
      message: 'Followed artists are already in sync with cloud',
    }
  }

  // 2. Additive-only merge check: Local has artists missing from cloud
  const localOnly = localArtists.filter((a) => !remoteMap.has(a.id))
  if (localOnly.length > 0) {
    recordFollowedArtistsMetric('additiveSyncsCount')
    const missingFromLocal = remoteArtists.filter((a) => !localMap.has(a.id))
    const merged = [...localArtists, ...missingFromLocal]

    recordFollowedArtistsMetric('artistsSyncedCount', missingFromLocal.length)

    return {
      action: 'additive_merge',
      finalArtists: merged,
      addedCount: missingFromLocal.length,
      message: `Preserved ${localOnly.length} local artist(s) and merged ${missingFromLocal.length} cloud artist(s)`,
    }
  }

  // 3. Full update from cloud
  const added = remoteArtists.filter((a) => !localMap.has(a.id)).length
  recordFollowedArtistsMetric('artistsSyncedCount', added)

  return {
    action: 'full_update',
    finalArtists: [...remoteArtists],
    addedCount: added,
    message: `Updated followed artists from cloud (${remoteArtists.length} artists)`,
  }
}

// ============================================================================
// Cloud Sync Execution
// ============================================================================

export async function syncFollowedArtistsWithCloud(
  cookieOverride?: string,
): Promise<FollowedArtistsSyncResult> {
  recordFollowedArtistsMetric('syncAttemptsCount')
  const store = useEchoStore.getState()
  const localArtists = store.followedArtists || []
  const session = getStoredYouTubeSession()
  const cookie = cookieOverride || session?.cookie

  try {
    const remoteArtists: FollowedArtistEntity[] = []
    const headers: HeadersInit = { 'Content-Type': 'application/json' }
    if (cookie) {
      headers['x-innertube-cookie'] = cookie
    }

    const res = await fetch('/api/innertube/browse', {
      method: 'POST',
      headers,
      body: JSON.stringify({ browseId: 'FEmusic_library_corpus_artists' }),
    })

    if (res.ok) {
      const data = await res.json()
      const sections =
        data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
          ?.sectionListRenderer?.contents || []

      for (const sec of sections) {
        const gridItems =
          sec?.gridRenderer?.items ||
          sec?.musicShelfRenderer?.contents ||
          sec?.itemSectionRenderer?.contents ||
          []
        for (const item of gridItems) {
          const renderer = item?.musicTwoRowItemRenderer || item?.musicResponsiveListItemRenderer
          if (renderer) {
            const id =
              renderer.navigationEndpoint?.browseEndpoint?.browseId ||
              renderer.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
            const name =
              renderer.title?.runs?.[0]?.text ||
              renderer.title?.simpleText ||
              renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text
            const subscribers =
              renderer.subtitle?.runs?.[0]?.text ||
              renderer.subtitle?.simpleText ||
              renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text
            const thumbnailUrl =
              renderer.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url ||
              renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url

            if (id && name) {
              remoteArtists.push({
                id,
                name,
                subscribers: subscribers || undefined,
                thumbnailUrl: thumbnailUrl || undefined,
                followedAt: Date.now(),
                source: 'cloud',
              })
            }
          }
        }
      }
    }

    const reconcile = reconcileFollowedArtists({
      localArtists,
      remoteArtists,
    })

    if (reconcile.action !== 'no_change') {
      store.setFollowedArtists(reconcile.finalArtists)
    }

    recordFollowedArtistsMetric('syncSuccessCount')

    return followedArtistsSyncResultSchema.parse({
      action: reconcile.action,
      localCount: localArtists.length,
      remoteCount: remoteArtists.length,
      addedCount: reconcile.addedCount,
      message: reconcile.message,
      syncedAt: Date.now(),
    })
  } catch (err) {
    recordFollowedArtistsMetric('syncErrorsCount')
    const message = err instanceof Error ? err.message : String(err)
    return followedArtistsSyncResultSchema.parse({
      action: 'error',
      localCount: localArtists.length,
      remoteCount: 0,
      addedCount: 0,
      message,
      syncedAt: Date.now(),
    })
  }
}

// ============================================================================
// New Releases from Followed Artists
// ============================================================================

export async function fetchNewReleasesForFollowedArtists(
  artists: FollowedArtistEntity[],
  limit = 10,
): Promise<ArtistNewRelease[]> {
  if (artists.length === 0) return []

  const releases: ArtistNewRelease[] = []
  // Check the top 5 most recently followed artists for fresh releases
  const targetArtists = artists.slice(0, 5)

  for (const artist of targetArtists) {
    try {
      const res = await fetch('/api/innertube/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ browseId: artist.id }),
      })

      if (res.ok) {
        const data = await res.json()
        const sections =
          data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
            ?.sectionListRenderer?.contents || []

        for (const sec of sections) {
          const title =
            sec?.musicCarouselShelfRenderer?.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs?.[0]?.text ||
            sec?.musicShelfRenderer?.title?.runs?.[0]?.text ||
            ''

          if (/albums|singles|latest|releases/i.test(title)) {
            const items =
              sec?.musicCarouselShelfRenderer?.contents || sec?.musicShelfRenderer?.contents || []
            for (const it of items.slice(0, 2)) {
              const renderer = it?.musicTwoRowItemRenderer
              if (renderer) {
                const releaseId =
                  renderer.navigationEndpoint?.browseEndpoint?.browseId ||
                  renderer.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
                const releaseTitle =
                  renderer.title?.runs?.[0]?.text || renderer.title?.simpleText
                const coverUrl =
                  renderer.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url
                const subtitle =
                  renderer.subtitle?.runs?.[0]?.text || renderer.subtitle?.simpleText || ''
                const yearMatch = subtitle.match(/\b(20\d\d|19\d\d)\b/)
                const year = yearMatch ? parseInt(yearMatch[1]!, 10) : undefined

                if (releaseId && releaseTitle) {
                  releases.push({
                    id: releaseId,
                    artistId: artist.id,
                    artistName: artist.name,
                    title: releaseTitle,
                    coverUrl,
                    year,
                    type: /single/i.test(subtitle) ? 'single' : 'album',
                  })
                }
              }
            }
          }
        }
      }
    } catch {
      // Continue next artist gracefully
    }
  }

  recordFollowedArtistsMetric('newReleasesFetchedCount', releases.length)
  return releases.slice(0, limit)
}
