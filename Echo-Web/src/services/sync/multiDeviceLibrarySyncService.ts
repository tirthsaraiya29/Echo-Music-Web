/**
 * Multi-Device & Cross-Tab Library Synchronization Service for Echo Music Web
 *
 * Implements real-time library synchronization across browser tabs, windows,
 * and devices via BroadcastChannel with fallback storage events and snapshot versioning.
 *
 * Synchronizes:
 * - Playlists
 * - Liked tracks
 * - Liked albums
 * - Followed artists
 * - Recently played items
 * - User preferences
 *
 * Deliberately isolates local playback state (current track, play state, queue)
 * to maintain independent playback sessions while keeping library collections identical.
 */

import { z } from 'zod'
import { useEchoStore } from '../../stores/useEchoStore.ts'
import type { Playlist, RecentlyPlayedItem, UserPreferences } from '../../types/domain.ts'
import type { LikedAlbumEntity } from './likedAlbumsSyncService.ts'
import type { FollowedArtistEntity } from './followedArtistsSyncService.ts'

// ============================================================================
// Schemas
// ============================================================================

export const librarySyncSnapshotSchema = z.object({
  version: z.number().int().nonnegative(),
  deviceId: z.string().min(1),
  timestamp: z.number().nonnegative(),
  playlists: z.array(z.any()),
  likedTrackIds: z.array(z.string()),
  likedAlbumIds: z.array(z.string()),
  likedAlbums: z.array(z.any()),
  followedArtistIds: z.array(z.string()),
  followedArtists: z.array(z.any()),
  recentlyPlayedIds: z.array(z.string()),
  recentItems: z.array(z.any()),
  preferences: z.record(z.string(), z.any()).optional(),
})

export type LibrarySyncSnapshot = z.infer<typeof librarySyncSnapshotSchema>

export const syncMessageTypeSchema = z.enum([
  'SNAPSHOT_BROADCAST',
  'SYNC_REQUEST',
  'SYNC_RESPONSE',
  'PING',
  'PONG',
])

export type SyncMessageType = z.infer<typeof syncMessageTypeSchema>

export const syncBroadcastMessageSchema = z.object({
  type: syncMessageTypeSchema,
  senderDeviceId: z.string().min(1),
  timestamp: z.number().nonnegative(),
  snapshot: librarySyncSnapshotSchema.optional(),
})

export type SyncBroadcastMessage = z.infer<typeof syncBroadcastMessageSchema>

export const multiDeviceSyncMetricsSchema = z.object({
  messagesSentCount: z.number().nonnegative(),
  messagesReceivedCount: z.number().nonnegative(),
  snapshotsBroadcastCount: z.number().nonnegative(),
  snapshotsAppliedCount: z.number().nonnegative(),
  syncRequestsHandledCount: z.number().nonnegative(),
  errorsCount: z.number().nonnegative(),
})

export type MultiDeviceSyncMetrics = z.infer<typeof multiDeviceSyncMetricsSchema>

// ============================================================================
// Telemetry & State
// ============================================================================

const CHANNEL_NAME = 'echo_multi_device_library_sync'
const STORAGE_BACKUP_KEY = 'echo_library_sync_payload'
const DEVICE_ID_KEY = 'echo_device_id'

let metrics: MultiDeviceSyncMetrics = {
  messagesSentCount: 0,
  messagesReceivedCount: 0,
  snapshotsBroadcastCount: 0,
  snapshotsAppliedCount: 0,
  syncRequestsHandledCount: 0,
  errorsCount: 0,
}

let activeChannel: BroadcastChannel | null = null
let localRevision = 1
let isSyncRunning = false
let lastAppliedTimestamp = 0
let lastAppliedDeviceId = ''

export function recordMultiDeviceSyncMetric(
  key: keyof MultiDeviceSyncMetrics,
  delta = 1,
): void {
  if (key in metrics) {
    metrics[key] += delta
  }
}

export function getMultiDeviceSyncMetrics(): MultiDeviceSyncMetrics {
  return { ...metrics }
}

export function resetMultiDeviceSyncMetrics(): void {
  metrics = {
    messagesSentCount: 0,
    messagesReceivedCount: 0,
    snapshotsBroadcastCount: 0,
    snapshotsAppliedCount: 0,
    syncRequestsHandledCount: 0,
    errorsCount: 0,
  }
}

export function getCurrentLibraryRevision(): number {
  return localRevision
}

export function incrementLibraryRevision(): number {
  localRevision += 1
  return localRevision
}

export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined' || !window.localStorage) {
    return 'device_node_env'
  }
  try {
    let id = window.localStorage.getItem(DEVICE_ID_KEY)
    if (!id) {
      const randomSegment = Math.random().toString(36).substring(2, 10)
      id = `echo_device_${Date.now().toString(36)}_${randomSegment}`
      window.localStorage.setItem(DEVICE_ID_KEY, id)
    }
    return id
  } catch {
    return 'device_fallback'
  }
}

// ============================================================================
// Snapshot Creation & Ingestion
// ============================================================================

export function createLocalLibrarySnapshot(): LibrarySyncSnapshot {
  const state = useEchoStore.getState()
  const snapshot: LibrarySyncSnapshot = {
    version: localRevision,
    deviceId: getOrCreateDeviceId(),
    timestamp: Date.now(),
    playlists: (state.playlists || []).map((p) => ({ ...p })),
    likedTrackIds: [...(state.likedTrackIds || [])],
    likedAlbumIds: [...(state.likedAlbumIds || [])],
    likedAlbums: [...(state.likedAlbums || [])],
    followedArtistIds: [...(state.followedArtistIds || [])],
    followedArtists: [...(state.followedArtists || [])],
    recentlyPlayedIds: [...(state.recentlyPlayedIds || [])],
    recentItems: [...(state.recentItems || [])],
    preferences: { ...state.preferences },
  }
  return librarySyncSnapshotSchema.parse(snapshot)
}

export function applyRemoteLibrarySnapshot(
  snapshot: LibrarySyncSnapshot,
  _source = 'broadcast',
): boolean {
  try {
    const valid = librarySyncSnapshotSchema.parse(snapshot)

    // Ignore snapshots originated from self
    if (valid.deviceId === getOrCreateDeviceId()) {
      return false
    }

    // Guard against older or duplicate snapshots
    if (valid.timestamp <= lastAppliedTimestamp && valid.deviceId === lastAppliedDeviceId) {
      return false
    }

    const store = useEchoStore.getState()

    // Apply library entities atomically to store while preserving local playback state
    useEchoStore.setState({
      playlists: valid.playlists as Playlist[],
      likedTrackIds: valid.likedTrackIds,
      likedAlbumIds: valid.likedAlbumIds,
      likedAlbums: valid.likedAlbums as LikedAlbumEntity[],
      followedArtistIds: valid.followedArtistIds,
      followedArtists: valid.followedArtists as FollowedArtistEntity[],
      recentlyPlayedIds: valid.recentlyPlayedIds,
      recentItems: valid.recentItems as RecentlyPlayedItem[],
      preferences: {
        ...store.preferences,
        ...(valid.preferences as Partial<UserPreferences>),
      },
    })

    lastAppliedTimestamp = valid.timestamp
    lastAppliedDeviceId = valid.deviceId
    localRevision = Math.max(localRevision, valid.version) + 1

    recordMultiDeviceSyncMetric('snapshotsAppliedCount')
    return true
  } catch (err) {
    recordMultiDeviceSyncMetric('errorsCount')
    return false
  }
}

// ============================================================================
// Messaging & Broadcast Handlers
// ============================================================================

function handleIncomingMessage(msg: SyncBroadcastMessage): void {
  recordMultiDeviceSyncMetric('messagesReceivedCount')

  if (msg.senderDeviceId === getOrCreateDeviceId()) {
    return
  }

  switch (msg.type) {
    case 'SNAPSHOT_BROADCAST':
    case 'SYNC_RESPONSE':
      if (msg.snapshot) {
        applyRemoteLibrarySnapshot(msg.snapshot, msg.type)
      }
      break

    case 'SYNC_REQUEST':
      recordMultiDeviceSyncMetric('syncRequestsHandledCount')
      broadcastMessage({
        type: 'SYNC_RESPONSE',
        senderDeviceId: getOrCreateDeviceId(),
        timestamp: Date.now(),
        snapshot: createLocalLibrarySnapshot(),
      })
      break

    case 'PING':
      broadcastMessage({
        type: 'PONG',
        senderDeviceId: getOrCreateDeviceId(),
        timestamp: Date.now(),
      })
      break

    default:
      break
  }
}

function broadcastMessage(msg: SyncBroadcastMessage): void {
  try {
    const valid = syncBroadcastMessageSchema.parse(msg)
    if (activeChannel) {
      activeChannel.postMessage(valid)
      recordMultiDeviceSyncMetric('messagesSentCount')
    }

    // Storage fallback for cross-tab synchrony across frames/subdomains
    if (typeof window !== 'undefined' && window.localStorage && valid.snapshot) {
      window.localStorage.setItem(
        STORAGE_BACKUP_KEY,
        JSON.stringify({ ...valid, storageBust: Math.random() }),
      )
    }
  } catch {
    recordMultiDeviceSyncMetric('errorsCount')
  }
}

export function broadcastLibrarySnapshot(): void {
  incrementLibraryRevision()
  const snapshot = createLocalLibrarySnapshot()
  recordMultiDeviceSyncMetric('snapshotsBroadcastCount')
  broadcastMessage({
    type: 'SNAPSHOT_BROADCAST',
    senderDeviceId: getOrCreateDeviceId(),
    timestamp: Date.now(),
    snapshot,
  })
}

export function requestSyncFromPeers(): void {
  broadcastMessage({
    type: 'SYNC_REQUEST',
    senderDeviceId: getOrCreateDeviceId(),
    timestamp: Date.now(),
  })
}

// ============================================================================
// Lifecycle Management
// ============================================================================

export function startMultiDeviceSync(): () => void {
  if (isSyncRunning) {
    return stopMultiDeviceSync
  }
  isSyncRunning = true

  // 1. Setup BroadcastChannel if supported
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      activeChannel = new BroadcastChannel(CHANNEL_NAME)
      activeChannel.onmessage = (event: MessageEvent) => {
        try {
          const parsed = syncBroadcastMessageSchema.safeParse(event.data)
          if (parsed.success) {
            handleIncomingMessage(parsed.data)
          }
        } catch {
          recordMultiDeviceSyncMetric('errorsCount')
        }
      }
    } catch {
      activeChannel = null
    }
  }

  // 2. Storage event listener fallback
  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key === STORAGE_BACKUP_KEY && event.newValue) {
      try {
        const raw = JSON.parse(event.newValue)
        const parsed = syncBroadcastMessageSchema.safeParse(raw)
        if (parsed.success) {
          handleIncomingMessage(parsed.data)
        }
      } catch {
        recordMultiDeviceSyncMetric('errorsCount')
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorageEvent)
  }

  // 3. Request initial sync from peers
  requestSyncFromPeers()

  return () => {
    stopMultiDeviceSync()
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorageEvent)
    }
  }
}

export function stopMultiDeviceSync(): void {
  isSyncRunning = false
  if (activeChannel) {
    try {
      activeChannel.close()
    } catch {
      // Ignore
    }
    activeChannel = null
  }
}

export function isMultiDeviceSyncActive(): boolean {
  return isSyncRunning
}

// ============================================================================
// Export & Import Portable Deltas
// ============================================================================

export function exportLibrarySnapshotJson(): string {
  const snapshot = createLocalLibrarySnapshot()
  return JSON.stringify(snapshot, null, 2)
}

export function importLibrarySnapshotJson(jsonStr: string): boolean {
  try {
    const raw = JSON.parse(jsonStr)
    const valid = librarySyncSnapshotSchema.parse(raw)
    return applyRemoteLibrarySnapshot(valid, 'manual_import')
  } catch {
    recordMultiDeviceSyncMetric('errorsCount')
    return false
  }
}
