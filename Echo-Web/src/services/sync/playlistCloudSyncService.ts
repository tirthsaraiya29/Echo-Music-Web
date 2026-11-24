/**
 * Playlist Cloud Synchronization Service for Echo Music Web
 *
 * Implements cloud playlist sync, anti-wipe protections, and additive-only
 * reconciliation matching upstream Echo Music architecture (SyncUtils.kt):
 *
 * Anti-Wipe Protection:
 * "if (songs.isEmpty()) {
 *    // Remote returned empty — could be a transient API hiccup.
 *    // Don't clear local songs to avoid data loss.
 *    Timber.w("syncPlaylist: Remote playlist returned empty, skipping clear to preserve local songs")
 *    return@onSuccess
 *  }"
 *
 * Additive-Only Sync:
 * "val localOnlySongs = localIdSet - remoteIds
 *  if (localOnlySongs.isNotEmpty()) {
 *    // Local has songs that remote doesn't have (freshly added).
 *    // Performing additive-only sync to preserve local songs.
 *  }"
 */

import { z } from 'zod'
import { useEchoStore } from '../../stores/useEchoStore.ts'

// ============================================================================
// Schemas
// ============================================================================

export const syncActionSchema = z.enum([
  'no_change',
  'wipe_prevented',
  'additive_merge',
  'full_update',
  'error',
])

export type SyncAction = z.infer<typeof syncActionSchema>

export const playlistSyncResultSchema = z.object({
  playlistId: z.string(),
  browseId: z.string().optional(),
  action: syncActionSchema,
  localCount: z.number().nonnegative(),
  remoteCount: z.number().nonnegative(),
  addedCount: z.number().nonnegative(),
  message: z.string(),
  syncedAt: z.number().nonnegative(),
})

export type PlaylistSyncResult = z.infer<typeof playlistSyncResultSchema>

export const playlistSyncMetricsSchema = z.object({
  syncAttemptsCount: z.number().nonnegative(),
  syncSuccessCount: z.number().nonnegative(),
  syncErrorsCount: z.number().nonnegative(),
  wipesPreventedCount: z.number().nonnegative(),
  tracksAddedCount: z.number().nonnegative(),
  additiveSyncsCount: z.number().nonnegative(),
})

export type PlaylistSyncMetrics = z.infer<typeof playlistSyncMetricsSchema>

// ============================================================================
// Telemetry State
// ============================================================================

let syncMetrics: PlaylistSyncMetrics = {
  syncAttemptsCount: 0,
  syncSuccessCount: 0,
  syncErrorsCount: 0,
  wipesPreventedCount: 0,
  tracksAddedCount: 0,
  additiveSyncsCount: 0,
}

export function recordPlaylistSyncMetric(
  key: keyof PlaylistSyncMetrics,
  delta = 1,
): void {
  if (key in syncMetrics) {
    syncMetrics[key] += delta
  }
}

export function getPlaylistSyncMetrics(): PlaylistSyncMetrics {
  return { ...syncMetrics }
}

export function resetPlaylistSyncMetrics(): void {
  syncMetrics = {
    syncAttemptsCount: 0,
    syncSuccessCount: 0,
    syncErrorsCount: 0,
    wipesPreventedCount: 0,
    tracksAddedCount: 0,
    additiveSyncsCount: 0,
  }
}

// ============================================================================
// Anti-Wipe & Reconcile Algorithm (Matching upstream SyncUtils.kt)
// ============================================================================

export interface ReconcilePlaylistOptions {
  localTrackIds: string[]
  remoteTrackIds: string[]
  allowEmptyRemote?: boolean | undefined
}

export interface ReconcileResult {
  action: SyncAction
  finalTrackIds: string[]
  addedCount: number
  message: string
}

/**
 * Reconciles local and remote playlist track IDs according to upstream Echo Music rules:
 * 1. If remote is empty but local has songs: PREVENT WIPE (ignore empty response).
 * 2. If local has songs that remote does not have: ADDITIVE MERGE (keep local songs, append missing remote songs).
 * 3. If remote is fully populated: FULL UPDATE (apply remote order).
 * 4. If remote and local are identical: NO CHANGE.
 */
export function reconcilePlaylistTracks(options: ReconcilePlaylistOptions): ReconcileResult {
  const { localTrackIds, remoteTrackIds, allowEmptyRemote = false } = options

  // 1. Anti-wipe check: Remote is empty but local has tracks
  if (remoteTrackIds.length === 0) {
    if (localTrackIds.length > 0 && !allowEmptyRemote) {
      recordPlaylistSyncMetric('wipesPreventedCount')
      return {
        action: 'wipe_prevented',
        finalTrackIds: [...localTrackIds],
        addedCount: 0,
        message: 'Remote returned empty — wipe prevented to protect local tracks',
      }
    }
    if (allowEmptyRemote) {
      return {
        action: 'full_update',
        finalTrackIds: [],
        addedCount: 0,
        message: 'Empty remote accepted (allowEmptyRemote=true)',
      }
    }
  }

  // 2. Exact match check
  const localSet = new Set(localTrackIds)
  const remoteSet = new Set(remoteTrackIds)

  const isIdentical =
    localTrackIds.length === remoteTrackIds.length &&
    localTrackIds.every((id, idx) => id === remoteTrackIds[idx])

  if (isIdentical) {
    return {
      action: 'no_change',
      finalTrackIds: [...localTrackIds],
      addedCount: 0,
      message: 'Playlist is already in sync with cloud',
    }
  }

  // 3. Additive-only merge check: User added tracks locally that haven't reached cloud
  const localOnly = localTrackIds.filter((id) => !remoteSet.has(id))
  if (localOnly.length > 0) {
    recordPlaylistSyncMetric('additiveSyncsCount')
    // Append any remote tracks that are missing from local
    const missingFromLocal = remoteTrackIds.filter((id) => !localSet.has(id))
    const merged = [...localTrackIds, ...missingFromLocal]

    recordPlaylistSyncMetric('tracksAddedCount', missingFromLocal.length)

    return {
      action: 'additive_merge',
      finalTrackIds: merged,
      addedCount: missingFromLocal.length,
      message: `Preserved ${localOnly.length} local-only track(s) and merged ${missingFromLocal.length} cloud track(s)`,
    }
  }

  // 4. Standard full update from cloud
  const added = remoteTrackIds.filter((id) => !localSet.has(id)).length
  recordPlaylistSyncMetric('tracksAddedCount', added)

  return {
    action: 'full_update',
    finalTrackIds: [...remoteTrackIds],
    addedCount: added,
    message: `Updated playlist from cloud (${remoteTrackIds.length} tracks)`,
  }
}

// ============================================================================
// Cloud Sync Execution
// ============================================================================

export async function syncPlaylistWithCloud(
  playlistId: string,
  browseIdOverride?: string,
): Promise<PlaylistSyncResult> {
  recordPlaylistSyncMetric('syncAttemptsCount')
  const store = useEchoStore.getState()
  const localPlaylist = store.playlists.find((p) => p.id === playlistId)

  if (!localPlaylist) {
    recordPlaylistSyncMetric('syncErrorsCount')
    throw new Error(`Playlist ${playlistId} not found in local library`)
  }

  const browseId = browseIdOverride || localPlaylist.browseId || localPlaylist.id
  const localTrackIds = localPlaylist.trackIds || []

  try {
    // 1. Fetch remote tracks via InnerTube browse endpoint
    let remoteTrackIds: string[] = []

    const res = await fetch('/api/innertube/browse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browseId }),
    })

    if (res.ok) {
      const data = await res.json()
      // Extract tracks from playlistPanelRenderer or sectionListRenderer
      const contents =
        data?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer
          ?.contents?.[0]?.musicPlaylistShelfRenderer?.contents ||
        data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
          ?.sectionListRenderer?.contents?.[0]?.musicPlaylistShelfRenderer?.contents ||
        []

      for (const item of contents) {
        const tr = item?.musicResponsiveListItemRenderer
        const id =
          tr?.playlistItemData?.videoId ||
          tr?.navigationEndpoint?.watchEndpoint?.videoId ||
          tr?.doubleTapToLikeEndpoint?.likeEndpoint?.target?.videoId
        if (id) remoteTrackIds.push(id)
      }
    }

    // 2. Reconcile with anti-wipe protections
    const reconcile = reconcilePlaylistTracks({
      localTrackIds,
      remoteTrackIds,
    })

    // 3. Update store if changes occurred
    if (reconcile.action !== 'no_change') {
      const updatedPlaylists = store.playlists.map((p) => {
        if (p.id === playlistId) {
          return {
            ...p,
            trackIds: reconcile.finalTrackIds,
            browseId,
            lastSyncedAt: Date.now(),
            syncError: undefined,
          }
        }
        return p
      })
      useEchoStore.setState({ playlists: updatedPlaylists })
    }

    recordPlaylistSyncMetric('syncSuccessCount')

    return playlistSyncResultSchema.parse({
      playlistId,
      browseId,
      action: reconcile.action,
      localCount: localTrackIds.length,
      remoteCount: remoteTrackIds.length,
      addedCount: reconcile.addedCount,
      message: reconcile.message,
      syncedAt: Date.now(),
    })
  } catch (err) {
    recordPlaylistSyncMetric('syncErrorsCount')
    const message = err instanceof Error ? err.message : String(err)

    // Preserve existing local playlist data and mark syncError
    const updatedPlaylists = store.playlists.map((p) => {
      if (p.id === playlistId) {
        return {
          ...p,
          syncError: message,
        }
      }
      return p
    })
    useEchoStore.setState({ playlists: updatedPlaylists })

    return playlistSyncResultSchema.parse({
      playlistId,
      browseId,
      action: 'error',
      localCount: localTrackIds.length,
      remoteCount: 0,
      addedCount: 0,
      message,
      syncedAt: Date.now(),
    })
  }
}

export async function syncAllCloudPlaylists(): Promise<PlaylistSyncResult[]> {
  const store = useEchoStore.getState()
  const syncable = store.playlists.filter((p) => p.isAutoSync || Boolean(p.browseId))
  const results: PlaylistSyncResult[] = []

  for (const pl of syncable) {
    try {
      const result = await syncPlaylistWithCloud(pl.id)
      results.push(result)
    } catch {
      // Continue next
    }
  }

  return results
}

export function setPlaylistAutoSync(playlistId: string, enabled: boolean, browseId?: string): void {
  const store = useEchoStore.getState()
  const updatedPlaylists = store.playlists.map((p) => {
    if (p.id === playlistId) {
      return {
        ...p,
        isAutoSync: enabled,
        browseId: browseId || p.browseId,
      }
    }
    return p
  })
  useEchoStore.setState({ playlists: updatedPlaylists })
}
