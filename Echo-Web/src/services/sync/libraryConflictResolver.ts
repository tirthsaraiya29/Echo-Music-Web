/**
 * Library Conflict Resolution Service for Echo Music Web
 *
 * Implements deterministic conflict resolution for concurrent playlist edits,
 * additions, reorders, and deletions across devices, sessions, and cloud sync:
 * - Last-Write-Wins (LWW) with vector clock / revision and timestamp tie-breaking
 * - Additive track-list reconciliation (union merge preserving user additions)
 * - Tombstone-based deletion tracking with configurable resurrection threshold
 * - Automatic pruning of expired tombstones
 */

import { z } from 'zod'
import type { Playlist } from '../../types/domain.ts'

// ============================================================================
// Schemas
// ============================================================================

export const playlistConflictEntitySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  owner: z.string().default('You'),
  image: z.string().default(''),
  trackIds: z.array(z.string()).default([]),
  curated: z.boolean().default(false),
  createdAt: z.number().nonnegative().default(() => Date.now()),
  updatedAt: z.number().nonnegative().default(() => Date.now()),
  revision: z.number().int().nonnegative().default(1),
  deletedAt: z.number().nonnegative().optional(),
})

export type PlaylistConflictEntity = z.infer<typeof playlistConflictEntitySchema>

export const conflictResolutionActionSchema = z.enum([
  'keep_local',
  'accept_remote',
  'merge_tracks',
  'resurrect',
  'delete_tombstone',
])

export type ConflictResolutionAction = z.infer<typeof conflictResolutionActionSchema>

export const conflictResolutionResultSchema = z.object({
  action: conflictResolutionActionSchema,
  resolved: playlistConflictEntitySchema.nullable(),
  reason: z.string(),
})

export type ConflictResolutionResult = z.infer<typeof conflictResolutionResultSchema>

export const libraryConflictMetricsSchema = z.object({
  conflictsDetectedCount: z.number().nonnegative(),
  conflictsResolvedLWWCount: z.number().nonnegative(),
  trackMergesCount: z.number().nonnegative(),
  tombstoneDeletionsCount: z.number().nonnegative(),
  resurrectionsCount: z.number().nonnegative(),
})

export type LibraryConflictMetrics = z.infer<typeof libraryConflictMetricsSchema>

// ============================================================================
// Telemetry & Constants
// ============================================================================

export const TOMBSTONE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
export const CLOCK_SKEW_TOLERANCE_MS = 2000 // 2 seconds tolerance

let metrics: LibraryConflictMetrics = {
  conflictsDetectedCount: 0,
  conflictsResolvedLWWCount: 0,
  trackMergesCount: 0,
  tombstoneDeletionsCount: 0,
  resurrectionsCount: 0,
}

export function recordConflictMetric(
  key: keyof LibraryConflictMetrics,
  delta = 1,
): void {
  if (key in metrics) {
    metrics[key] += delta
  }
}

export function getLibraryConflictMetrics(): LibraryConflictMetrics {
  return { ...metrics }
}

export function resetLibraryConflictMetrics(): void {
  metrics = {
    conflictsDetectedCount: 0,
    conflictsResolvedLWWCount: 0,
    trackMergesCount: 0,
    tombstoneDeletionsCount: 0,
    resurrectionsCount: 0,
  }
}

// ============================================================================
// Core Resolution Algorithm
// ============================================================================

export interface ConflictResolutionOptions {
  clockSkewToleranceMs?: number
  allowResurrection?: boolean
}

export function resolvePlaylistConflict(
  local: PlaylistConflictEntity | null,
  remote: PlaylistConflictEntity | null,
  tombstones: Map<string, number>,
  options: ConflictResolutionOptions = {},
): ConflictResolutionResult {
  const {
    clockSkewToleranceMs = CLOCK_SKEW_TOLERANCE_MS,
    allowResurrection = true,
  } = options

  // Case 1: Neither exists
  if (!local && !remote) {
    return {
      action: 'delete_tombstone',
      resolved: null,
      reason: 'Neither local nor remote playlist exists',
    }
  }

  // Case 2: Only local exists
  if (local && !remote) {
    const tombstoneTime = tombstones.get(local.id)
    if (tombstoneTime !== undefined) {
      // If local edit happened AFTER tombstone + clock skew, resurrect
      if (allowResurrection && local.updatedAt > tombstoneTime + clockSkewToleranceMs) {
        recordConflictMetric('resurrectionsCount')
        return {
          action: 'resurrect',
          resolved: {
            ...local,
            revision: local.revision + 1,
            updatedAt: Date.now(),
          },
          reason: 'Local edit was made after remote deletion — resurrected playlist',
        }
      }
      // Otherwise tombstone deletion wins
      recordConflictMetric('tombstoneDeletionsCount')
      return {
        action: 'delete_tombstone',
        resolved: null,
        reason: 'Playlist was deleted remotely — tombstone applied',
      }
    }
    return {
      action: 'keep_local',
      resolved: local,
      reason: 'Local playlist exists without remote conflict',
    }
  }

  // Case 3: Only remote exists
  if (!local && remote) {
    const tombstoneTime = tombstones.get(remote.id)
    if (tombstoneTime !== undefined) {
      if (allowResurrection && remote.updatedAt > tombstoneTime + clockSkewToleranceMs) {
        recordConflictMetric('resurrectionsCount')
        return {
          action: 'resurrect',
          resolved: {
            ...remote,
            revision: remote.revision + 1,
            updatedAt: Date.now(),
          },
          reason: 'Remote edit was made after local deletion — resurrected playlist',
        }
      }
      recordConflictMetric('tombstoneDeletionsCount')
      return {
        action: 'delete_tombstone',
        resolved: null,
        reason: 'Playlist was deleted locally — tombstone applied',
      }
    }
    return {
      action: 'accept_remote',
      resolved: remote,
      reason: 'Remote playlist accepted without local conflict',
    }
  }

  // Case 4: Both local and remote exist
  if (local && remote) {
    // Check if identical
    const isTracksIdentical =
      local.trackIds.length === remote.trackIds.length &&
      local.trackIds.every((id, idx) => id === remote.trackIds[idx])

    const isMetadataIdentical =
      local.title === remote.title && local.description === remote.description

    if (isTracksIdentical && isMetadataIdentical) {
      return {
        action: 'keep_local',
        resolved: local,
        reason: 'Local and remote are identical',
      }
    }

    recordConflictMetric('conflictsDetectedCount')

    // If tracks differ concurrently, perform additive track union
    if (!isTracksIdentical) {
      recordConflictMetric('trackMergesCount')
      const mergedTrackSet = new Set(local.trackIds)
      const mergedTrackIds = [...local.trackIds]

      for (const trackId of remote.trackIds) {
        if (!mergedTrackSet.has(trackId)) {
          mergedTrackSet.add(trackId)
          mergedTrackIds.push(trackId)
        }
      }

      // Pick metadata from whichever has higher revision / newer timestamp (LWW)
      const isRemoteNewer =
        remote.revision > local.revision ||
        (remote.revision === local.revision && remote.updatedAt > local.updatedAt)

      const dominant = isRemoteNewer ? remote : local
      const resolved: PlaylistConflictEntity = {
        ...dominant,
        trackIds: mergedTrackIds,
        revision: Math.max(local.revision, remote.revision) + 1,
        updatedAt: Math.max(local.updatedAt, remote.updatedAt),
      }

      return {
        action: 'merge_tracks',
        resolved,
        reason: `Merged ${mergedTrackIds.length} tracks concurrently added across devices`,
      }
    }

    // Tracks identical, metadata differs: Last-Write-Wins (LWW)
    recordConflictMetric('conflictsResolvedLWWCount')
    const isRemoteDominant =
      remote.revision > local.revision ||
      (remote.revision === local.revision && remote.updatedAt > local.updatedAt)

    if (isRemoteDominant) {
      return {
        action: 'accept_remote',
        resolved: remote,
        reason: 'Remote metadata revision is dominant (LWW)',
      }
    }

    return {
      action: 'keep_local',
      resolved: local,
      reason: 'Local metadata revision is dominant (LWW)',
    }
  }

  return {
    action: 'keep_local',
    resolved: local,
    reason: 'Default local resolution fallback',
  }
}

// ============================================================================
// Multi-Playlist Reconciliation
// ============================================================================

export interface ReconcilePlaylistsResult {
  resolvedPlaylists: Playlist[]
  updatedTombstones: Map<string, number>
  conflictsResolvedCount: number
}

export function reconcilePlaylistsWithConflictResolution(
  localPlaylists: Playlist[],
  remotePlaylists: Playlist[],
  tombstones: Map<string, number> = new Map(),
  options: ConflictResolutionOptions = {},
): ReconcilePlaylistsResult {
  const localMap = new Map<string, PlaylistConflictEntity>()
  for (const pl of localPlaylists) {
    localMap.set(
      pl.id,
      playlistConflictEntitySchema.parse({
        id: pl.id,
        title: pl.title,
        description: pl.description || '',
        owner: pl.owner || 'You',
        image: pl.image || '',
        trackIds: pl.trackIds || [],
        curated: pl.curated ?? false,
        createdAt: pl.createdAt || Date.now(),
        updatedAt: pl.updatedAt || pl.createdAt || Date.now(),
        revision: pl.revision || 1,
        deletedAt: pl.deletedAt,
      }),
    )
  }

  const remoteMap = new Map<string, PlaylistConflictEntity>()
  for (const pl of remotePlaylists) {
    remoteMap.set(
      pl.id,
      playlistConflictEntitySchema.parse({
        id: pl.id,
        title: pl.title,
        description: pl.description || '',
        owner: pl.owner || 'You',
        image: pl.image || '',
        trackIds: pl.trackIds || [],
        curated: pl.curated ?? false,
        createdAt: pl.createdAt || Date.now(),
        updatedAt: pl.updatedAt || pl.createdAt || Date.now(),
        revision: pl.revision || 1,
        deletedAt: pl.deletedAt,
      }),
    )
  }

  const now = Date.now()
  const updatedTombstones = new Map(tombstones)
  // Prune tombstones older than TOMBSTONE_MAX_AGE_MS
  for (const [id, deletedTime] of updatedTombstones.entries()) {
    if (now - deletedTime > TOMBSTONE_MAX_AGE_MS) {
      updatedTombstones.delete(id)
    }
  }

  // Only process IDs present in local or remote playlists
  const allIds = new Set([...localMap.keys(), ...remoteMap.keys()])
  const resolvedList: Playlist[] = []
  let conflictsResolvedCount = 0

  for (const id of allIds) {
    const local = localMap.get(id) || null
    const remote = remoteMap.get(id) || null

    const result = resolvePlaylistConflict(local, remote, updatedTombstones, options)

    if (result.action !== 'keep_local' && result.action !== 'delete_tombstone') {
      conflictsResolvedCount++
    }

    if (result.resolved) {
      // If resurrected or kept, remove from tombstones
      updatedTombstones.delete(id)
      resolvedList.push({
        id: result.resolved.id,
        title: result.resolved.title,
        description: result.resolved.description,
        owner: result.resolved.owner,
        image: result.resolved.image,
        trackIds: result.resolved.trackIds,
        curated: result.resolved.curated,
        createdAt: result.resolved.createdAt,
        updatedAt: result.resolved.updatedAt,
        revision: result.resolved.revision,
      })
    } else {
      // Record deletion tombstone
      if (!updatedTombstones.has(id)) {
        updatedTombstones.set(id, now)
      }
    }
  }

  return {
    resolvedPlaylists: resolvedList,
    updatedTombstones,
    conflictsResolvedCount,
  }
}
