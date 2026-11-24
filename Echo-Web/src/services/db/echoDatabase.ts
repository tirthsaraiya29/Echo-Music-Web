import Dexie, { type EntityTable } from 'dexie'
import { z } from 'zod'
import type { Track } from '../../types/domain'
import type { SynchronizedLyrics } from '../../types/lyrics'
import { getLocalArtworkUrl } from '../local/objectUrlRegistry.ts'

export interface StoredPlaylistRecord {
  id: string
  title: string
  description: string
  coverUrl?: string | undefined
  coverBlob?: Blob | undefined
  trackIds: string[]
  createdAt: number
  updatedAt: number
  isSystem?: boolean | undefined
}

export interface ListeningHistoryRecord {
  id?: number | undefined
  trackId: string
  trackTitle: string
  artistName: string
  artistId?: string | undefined
  albumTitle?: string | undefined
  artwork?: string | undefined
  playedAt: number
  durationPlayedMs: number
  trackDurationMs: number
  completed: boolean
  skipped: boolean
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night'
  deviceId?: string | undefined
  deviceName?: string | undefined
  source?: ('youtube' | 'local' | 'spotify' | 'cloud' | 'podcast') | undefined
}

export interface LocalFileRecord {
  id: string
  fileName: string
  title: string
  artist: string
  album: string
  durationSeconds: number
  year?: string | undefined
  genre?: string | undefined
  artworkBlob?: Blob | undefined
  audioBlob: Blob
  mimeType: string
  addedAt: number
  fileSize: number
}

export interface PodcastProgressRecord {
  episodeId: string
  showTitle: string
  episodeTitle: string
  positionMs: number
  durationMs: number
  positionSeconds?: number | undefined
  durationSeconds?: number | undefined
  artworkUrl?: string | undefined
  completed: boolean
  dismissed: boolean
  updatedAt: number
}

export interface RecommendationExclusionRecord {
  trackId: string
  trackTitle: string
  artistName: string
  excludedAt: number
  reason?: string | undefined
}

export interface SyncOffsetRecord {
  trackId: string
  offsetMs: number
  updatedAt: number
}

export interface CachedLyricsRecord {
  trackId: string
  query: string
  lyrics: SynchronizedLyrics
  provider: string
  fetchedAt: number
}

export interface MetadataCacheRecord {
  key: string
  kind: 'shelf' | 'album' | 'artist' | 'playlist' | 'search' | 'suggestions'
  data: unknown
  updatedAt: number
  expiresAt: number
}

export class EchoDatabase extends Dexie {
  playlists!: EntityTable<StoredPlaylistRecord, 'id'>
  history!: EntityTable<ListeningHistoryRecord, 'id'>
  localFiles!: EntityTable<LocalFileRecord, 'id'>
  podcastProgress!: EntityTable<PodcastProgressRecord, 'episodeId'>
  recommendationExclusions!: EntityTable<RecommendationExclusionRecord, 'trackId'>
  cachedLyrics!: EntityTable<CachedLyricsRecord, 'trackId'>
  syncOffsets!: EntityTable<SyncOffsetRecord, 'trackId'>
  metadataCache!: EntityTable<MetadataCacheRecord, 'key'>

  constructor() {
    super('EchoMusicWebDB')
    this.version(1).stores({
      tracks: 'id, videoId, title, artistName, downloadedAt',
      playlists: 'id, title, updatedAt, createdAt',
      history: '++id, trackId, artistName, playedAt, timeOfDay, completed, skipped',
      localFiles: 'id, title, artist, album, addedAt',
      podcastProgress: 'episodeId, showTitle, completed, dismissed, updatedAt',
      recommendationExclusions: 'trackId, artistName, excludedAt',
      cachedLyrics: 'trackId, query, provider, fetchedAt',
    })
    // Offline song downloads were removed; drop the orphaned table for existing users.
    this.version(2).stores({ tracks: null })
    this.version(3).stores({ syncOffsets: 'trackId, updatedAt' })
    this.version(4).stores({ metadataCache: 'key, kind, updatedAt, expiresAt' })
  }
}

export const db = new EchoDatabase()

export async function getStorageUsage(): Promise<{
  localFilesCount: number
  localFilesSizeBytes: number
  historyCount: number
  totalEstimateBytes?: number | undefined
}> {
  const localFiles = await db.localFiles.toArray()
  const localFilesSizeBytes = localFiles.reduce((acc, cur) => acc + (cur.fileSize || 0), 0)

  const historyCount = await db.history.count()

  let totalEstimateBytes: number | undefined
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate()
      totalEstimateBytes = estimate.usage
    } catch {
      // Ignore if unsupported
    }
  }

  return {
    localFilesCount: localFiles.length,
    localFilesSizeBytes,
    historyCount,
    totalEstimateBytes,
  }
}

export async function clearAllLocalFiles(): Promise<void> {
  await db.localFiles.clear()
}

export async function clearListeningHistory(): Promise<void> {
  await db.history.clear()
}

/**
 * Full Library Backup & Restore
 */
export const backupPlaylistSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  coverUrl: z.string().optional(),
  trackIds: z.array(z.string()),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
})

export const backupHistorySchema = z.object({
  trackId: z.string().min(1),
  trackTitle: z.string().min(1),
  artistName: z.string().min(1),
  artistId: z.string().optional(),
  albumTitle: z.string().optional(),
  artwork: z.string().optional(),
  playedAt: z.number().optional(),
  durationPlayedMs: z.number().optional(),
  trackDurationMs: z.number().optional(),
  completed: z.boolean().optional(),
  skipped: z.boolean().optional(),
  timeOfDay: z.enum(['morning', 'afternoon', 'evening', 'night']).optional(),
})

export const backupExclusionSchema = z.object({
  trackId: z.string().min(1),
  trackTitle: z.string().min(1),
  artistName: z.string().min(1),
  excludedAt: z.number().optional(),
  reason: z.string().optional(),
})

export const backupPayloadSchema = z.object({
  version: z.literal(1),
  exportedAt: z.number().positive().optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
  playlists: z.array(backupPlaylistSchema).optional(),
  likedTrackIds: z.array(z.string()).optional(),
  history: z.array(backupHistorySchema).optional(),
  exclusions: z.array(backupExclusionSchema).optional(),
})

export type BackupPayload = z.infer<typeof backupPayloadSchema>

export const backupMetricsSchema = z.object({
  exportsCount: z.number().nonnegative(),
  importsCount: z.number().nonnegative(),
  importFailuresCount: z.number().nonnegative(),
  lastError: z.string().nullable(),
})

export type BackupMetrics = z.infer<typeof backupMetricsSchema>

const backupMetrics: BackupMetrics = {
  exportsCount: 0,
  importsCount: 0,
  importFailuresCount: 0,
  lastError: null,
}

export function getBackupMetrics(): BackupMetrics {
  return { ...backupMetrics }
}

export function resetBackupMetrics(): void {
  backupMetrics.exportsCount = 0
  backupMetrics.importsCount = 0
  backupMetrics.importFailuresCount = 0
  backupMetrics.lastError = null
}

export interface FullEchoBackup {
  version: 1
  exportedAt: number
  preferences: Record<string, unknown>
  playlists: StoredPlaylistRecord[]
  likedTrackIds: string[]
  history: ListeningHistoryRecord[]
  exclusions: RecommendationExclusionRecord[]
}

export async function exportFullBackup(
  preferences: Record<string, unknown>,
  likedTrackIds: string[],
  activePlaylists?: Array<{
    id: string
    title: string
    description?: string
    image?: string
    coverUrl?: string
    trackIds: string[]
    createdAt?: number
  }>,
  options?: { signal?: AbortSignal },
): Promise<string> {
  if (options?.signal?.aborted) {
    throw new Error('Export operation cancelled')
  }
  backupMetrics.exportsCount++
  let playlists: StoredPlaylistRecord[] = []
  let history: ListeningHistoryRecord[] = []
  let exclusions: RecommendationExclusionRecord[] = []

  const isIndexedDbAvailable = typeof indexedDB !== 'undefined'

  // Sync activePlaylists into Dexie table before exporting if DB is available
  if (isIndexedDbAvailable && activePlaylists && activePlaylists.length > 0) {
    for (const p of activePlaylists) {
      if (options?.signal?.aborted) throw new Error('Export operation cancelled')
      await db.playlists
        .put({
          id: p.id,
          title: p.title,
          description: p.description || '',
          coverUrl: p.coverUrl || p.image || undefined,
          trackIds: p.trackIds || [],
          createdAt: p.createdAt || Date.now(),
          updatedAt: Date.now(),
        })
        .catch(() => {})
    }
  }

  if (isIndexedDbAvailable) {
    try {
      playlists = await db.playlists.toArray()
      history = await db.history.limit(500).toArray()
      exclusions = await db.recommendationExclusions.toArray()
    } catch {
      // Ignore if DB closed
    }
  }

  // Ensure activePlaylists are represented in exported backup even if not yet flushed to DB
  if (activePlaylists && activePlaylists.length > 0) {
    const existingIds = new Set(playlists.map((p) => p.id))
    for (const p of activePlaylists) {
      if (!existingIds.has(p.id)) {
        playlists.push({
          id: p.id,
          title: p.title,
          description: p.description || '',
          coverUrl: p.coverUrl || p.image || undefined,
          trackIds: p.trackIds || [],
          createdAt: p.createdAt || Date.now(),
          updatedAt: Date.now(),
        })
      }
    }
  }

  const backup: FullEchoBackup = {
    version: 1,
    exportedAt: Date.now(),
    preferences,
    playlists: playlists.map((p) => ({ ...p, coverBlob: undefined })),
    likedTrackIds,
    history,
    exclusions,
  }

  return JSON.stringify(backup, null, 2)
}

export async function importFullBackup(
  jsonString: string,
  mode: 'merge' | 'replace' = 'merge',
  options?: { signal?: AbortSignal },
): Promise<{
  playlistsRestored: number
  restoredPlaylists: StoredPlaylistRecord[]
  historyRestored: number
  exclusionsRestored: number
  likedTrackIds: string[]
  preferences?: Record<string, unknown> | undefined
}> {
  if (options?.signal?.aborted) {
    backupMetrics.importFailuresCount++
    backupMetrics.lastError = 'Import operation cancelled'
    throw new Error('Import operation cancelled')
  }

  let rawData: unknown
  try {
    rawData = JSON.parse(jsonString)
  } catch (err) {
    backupMetrics.importFailuresCount++
    const msg = 'Invalid JSON: ' + (err instanceof Error ? err.message : String(err))
    backupMetrics.lastError = msg
    throw new Error('Invalid JSON format in backup file')
  }

  const validation = backupPayloadSchema.safeParse(rawData)
  if (!validation.success) {
    const issueMsg = validation.error.issues[0]?.message || 'Invalid Echo backup format'
    backupMetrics.importFailuresCount++
    backupMetrics.lastError = issueMsg
    throw new Error(`Invalid Echo backup format: ${issueMsg}`)
  }

  const data = validation.data
  backupMetrics.importsCount++

  const isIndexedDbAvailable = typeof indexedDB !== 'undefined'

  if (isIndexedDbAvailable && mode === 'replace') {
    try {
      await db.playlists.clear()
      await db.history.clear()
      await db.recommendationExclusions.clear()
    } catch {
      // Ignore
    }
  }

  const restoredPlaylists: StoredPlaylistRecord[] = []
  let playlistsRestored = 0
  if (Array.isArray(data.playlists)) {
    for (const p of data.playlists) {
      if (options?.signal?.aborted) throw new Error('Import operation cancelled')
      if (isIndexedDbAvailable) {
        await db.playlists.put(p as StoredPlaylistRecord).catch(() => {})
      }
      restoredPlaylists.push(p as StoredPlaylistRecord)
      playlistsRestored++
    }
  }

  let historyRestored = 0
  if (Array.isArray(data.history)) {
    for (const h of data.history) {
      if (options?.signal?.aborted) throw new Error('Import operation cancelled')
      const record = { ...h } as Partial<ListeningHistoryRecord>
      delete record.id
      if (isIndexedDbAvailable) {
        await db.history.add(record as ListeningHistoryRecord).catch(() => {})
      }
      historyRestored++
    }
  }

  let exclusionsRestored = 0
  if (Array.isArray(data.exclusions)) {
    for (const e of data.exclusions) {
      if (options?.signal?.aborted) throw new Error('Import operation cancelled')
      if (isIndexedDbAvailable) {
        await db.recommendationExclusions.put(e as RecommendationExclusionRecord).catch(() => {})
      }
      exclusionsRestored++
    }
  }

  return {
    playlistsRestored,
    restoredPlaylists,
    historyRestored,
    exclusionsRestored,
    likedTrackIds: Array.isArray(data.likedTrackIds) ? data.likedTrackIds : [],
    preferences: data.preferences,
  }
}

/**
 * Resolves track metadata for a given track or video ID from IndexedDB caches
 * (downloads, history, local files) or the server stream resolution endpoint.
 */
export async function resolveMissingTrack(id: string): Promise<Track | null> {
  if (!id) return null

  try {
    // 1. Check listening history records in IndexedDB
    const history = await db.history.where('trackId').equals(id).first()
    if (history) {
      const art = history.artwork || `https://i.ytimg.com/vi/${history.trackId}/hqdefault.jpg`
      return {
        id: history.trackId,
        title: history.trackTitle,
        artistName: history.artistName,
        artistId: history.artistId || `yt_${history.artistName}`,
        albumTitle: history.albumTitle || history.trackTitle,
        albumId: `album_${history.trackId}`,
        albumImage: art,
        durationMs: history.trackDurationMs,
        artwork: art,
        explicit: false,
        playCount: 1,
        videoId: history.trackId,
      }
    }

    // 3. Check local imported audio files
    const local = await db.localFiles.get(id)
    if (local) {
      const art = local.artworkBlob
        ? getLocalArtworkUrl(local.id, local.artworkBlob)
        : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
      return {
        id: local.id,
        title: local.title,
        artistName: local.artist,
        artistId: `local_${local.artist}`,
        albumTitle: local.album,
        albumId: `local_${local.album}`,
        albumImage: art,
        durationMs: local.durationSeconds * 1000,
        artwork: art,
        explicit: false,
        playCount: 0,
      }
    }

    // 4. Resolve metadata from audio stream resolution endpoint
    const res = await fetch(`/api/stream/resolve?videoId=${encodeURIComponent(id)}`)
    if (res.ok) {
      const data = (await res.json()) as {
        videoId?: string
        title?: string
        artist?: string
        durationMs?: number
      }
      const vid = data.videoId || id
      const art = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`
      return {
        id: vid,
        title: data.title || 'Unknown Title',
        artistName: data.artist || 'Unknown Artist',
        artistId: `artist_${vid}`,
        albumTitle: data.title || 'Single',
        albumId: `album_${vid}`,
        albumImage: art,
        durationMs: data.durationMs || 180000,
        artwork: art,
        explicit: false,
        playCount: 0,
        videoId: vid,
      }
    }
  } catch {
    // Network or server resolution error
  }

  // 5. Explicit unresolved fallback: no fabricated title or duration. Callers can detect this
  // via `unresolved` and surface an honest "unresolved" state.
  const fallbackArt = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
  return {
    id,
    title: 'Unresolved Track',
    artistName: 'Metadata unavailable',
    artistId: `artist_${id}`,
    albumTitle: 'Unknown Release',
    albumId: `unresolved_${id}`,
    albumImage: fallbackArt,
    durationMs: 0,
    artwork: fallbackArt,
    explicit: false,
    playCount: 0,
    videoId: id,
    unresolved: true,
  }
}

export async function getPodcastProgress(episodeId: string): Promise<PodcastProgressRecord | undefined> {
  return db.podcastProgress.get(episodeId)
}

export async function savePodcastProgress(record: PodcastProgressRecord): Promise<void> {
  await db.podcastProgress.put(record)
}

export async function getAllPodcastProgress(includeCompleted = false): Promise<PodcastProgressRecord[]> {
  const all = await db.podcastProgress.toArray()
  return all
    .filter((p) => !p.dismissed && (includeCompleted || !p.completed))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function dismissPodcastProgress(episodeId: string): Promise<void> {
  const existing = await db.podcastProgress.get(episodeId)
  if (existing) {
    existing.dismissed = true
    await db.podcastProgress.put(existing)
  }
}

export async function markPodcastCompleted(episodeId: string): Promise<void> {
  const existing = await db.podcastProgress.get(episodeId)
  if (existing) {
    existing.completed = true
    existing.positionMs = 0
    existing.positionSeconds = 0
    existing.updatedAt = Date.now()
    await db.podcastProgress.put(existing)
  }
}

export async function restorePodcastProgress(episodeId: string): Promise<void> {
  const existing = await db.podcastProgress.get(episodeId)
  if (existing && existing.dismissed) {
    existing.dismissed = false
    existing.updatedAt = Date.now()
    await db.podcastProgress.put(existing)
  }
}

export async function clearPodcastProgress(episodeId: string): Promise<void> {
  await db.podcastProgress.delete(episodeId)
}
