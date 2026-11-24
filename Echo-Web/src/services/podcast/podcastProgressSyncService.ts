/**
 * Podcast Progress Sync Service for Echo Music Web
 *
 * Implements cross-tab real-time sync via BroadcastChannel, remote YouTube progress
 * merging, and cross-device import/export matching upstream Echo Music architecture:
 * - PodcastProgress.kt (REMOTE_PLAYED_PERCENT, REMOTE_AHEAD_MARGIN_MS, mergeRemote)
 */

import { z } from 'zod'
import {
  db,
  type PodcastProgressRecord,
} from '../db/echoDatabase.ts'
import { isNearEnd } from './podcastProgressService.ts'

// ============================================================================
// Constants from Upstream Echo Music (PodcastProgress.kt)
// ============================================================================

export const REMOTE_PLAYED_PERCENT = 95
export const REMOTE_AHEAD_MARGIN_MS = 60_000 // 1 minute clear lead needed

// ============================================================================
// Schemas
// ============================================================================

export const podcastProgressRecordSchema = z.object({
  episodeId: z.string().min(1),
  showTitle: z.string().default('Podcast Show'),
  episodeTitle: z.string().default('Episode'),
  positionSeconds: z.number().nonnegative().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  positionMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  artworkUrl: z.string().optional(),
  completed: z.boolean(),
  dismissed: z.boolean().default(false),
  updatedAt: z.number().nonnegative(),
})

export const podcastProgressExportSchema = z.object({
  version: z.literal(1),
  timestamp: z.number().positive(),
  device: z.string().default('Echo-Web'),
  records: z.array(podcastProgressRecordSchema),
})

export type PodcastProgressExport = z.infer<typeof podcastProgressExportSchema>

export const syncBroadcastMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('PROGRESS_UPDATE'),
    record: podcastProgressRecordSchema,
  }),
  z.object({
    type: z.literal('DISMISS_EPISODE'),
    episodeId: z.string().min(1),
  }),
  z.object({
    type: z.literal('BATCH_SYNC'),
    timestamp: z.number(),
    records: z.array(podcastProgressRecordSchema),
  }),
])

export type SyncBroadcastMessage = z.infer<typeof syncBroadcastMessageSchema>

export const progressSyncMetricsSchema = z.object({
  broadcastsSent: z.number().nonnegative(),
  broadcastsReceived: z.number().nonnegative(),
  remoteProgressMerged: z.number().nonnegative(),
  conflictsResolved: z.number().nonnegative(),
  exportsGenerated: z.number().nonnegative(),
  importsProcessed: z.number().nonnegative(),
})

export type ProgressSyncMetrics = z.infer<typeof progressSyncMetricsSchema>

// ============================================================================
// Telemetry State
// ============================================================================

let syncMetrics: ProgressSyncMetrics = {
  broadcastsSent: 0,
  broadcastsReceived: 0,
  remoteProgressMerged: 0,
  conflictsResolved: 0,
  exportsGenerated: 0,
  importsProcessed: 0,
}

export function recordProgressSyncMetric(key: keyof ProgressSyncMetrics, delta = 1): void {
  if (key in syncMetrics) {
    syncMetrics[key] += delta
  }
}

export function getProgressSyncMetrics(): ProgressSyncMetrics {
  return { ...syncMetrics }
}

export function resetProgressSyncMetrics(): void {
  syncMetrics = {
    broadcastsSent: 0,
    broadcastsReceived: 0,
    remoteProgressMerged: 0,
    conflictsResolved: 0,
    exportsGenerated: 0,
    importsProcessed: 0,
  }
}

// ============================================================================
// Upstream Remote Progress Merging (PodcastProgress.kt mergeRemote)
// ============================================================================

export interface RemoteEpisodeInput {
  episodeId: string
  showTitle?: string | undefined
  episodeTitle?: string | undefined
  artworkUrl?: string | undefined
  playedPercent?: number | undefined
  durationSeconds?: number | undefined
}

/**
 * Merges coarse remote progress from YouTube / InnerTube with local high-precision records.
 * Matches upstream Echo Music rules:
 * - If percent >= 95: counts as finished.
 * - If local is already finished: never un-completes.
 * - Only clear remote lead (> 60s ahead of local) updates position.
 */
export function mergeRemoteProgress(
  existing: PodcastProgressRecord | null | undefined,
  remote: RemoteEpisodeInput,
): { updatedRecord: PodcastProgressRecord | null; wasMerged: boolean } {
  const percent = remote.playedPercent ?? 0
  if (percent <= 0) {
    return { updatedRecord: existing ?? null, wasMerged: false }
  }

  const finished = percent >= REMOTE_PLAYED_PERCENT
  const durationSec = remote.durationSeconds && remote.durationSeconds > 0 ? remote.durationSeconds : (existing?.durationSeconds ?? 0)
  const durationMs = durationSec * 1000

  if (durationMs <= 0 && !finished) {
    return { updatedRecord: existing ?? null, wasMerged: false }
  }

  const positionMs = finished ? 0 : Math.round((durationMs * percent) / 100)
  const positionSec = Math.round(positionMs / 1000)

  // 1. No existing local record: create new entry
  if (!existing) {
    const newRecord: PodcastProgressRecord = {
      episodeId: remote.episodeId,
      showTitle: remote.showTitle || 'Podcast Show',
      episodeTitle: remote.episodeTitle || 'Episode',
      positionSeconds: positionSec,
      durationSeconds: durationSec,
      positionMs,
      durationMs,
      artworkUrl: remote.artworkUrl,
      completed: finished,
      dismissed: false,
      updatedAt: Date.now(),
    }
    recordProgressSyncMetric('remoteProgressMerged')
    return { updatedRecord: newRecord, wasMerged: true }
  }

  // 2. Already finished locally: preserve completed state
  if (existing.completed) {
    return { updatedRecord: existing, wasMerged: false }
  }

  // 3. Remote finished or clear lead (> 60s ahead)
  if (finished || positionMs > existing.positionMs + REMOTE_AHEAD_MARGIN_MS) {
    const merged: PodcastProgressRecord = {
      ...existing,
      positionSeconds: finished ? 0 : positionSec,
      positionMs: finished ? 0 : positionMs,
      completed: finished || isNearEnd(positionMs, durationMs),
      updatedAt: Date.now(),
    }
    recordProgressSyncMetric('remoteProgressMerged')
    recordProgressSyncMetric('conflictsResolved')
    return { updatedRecord: merged, wasMerged: true }
  }

  return { updatedRecord: existing, wasMerged: false }
}

// ============================================================================
// Cross-Tab BroadcastChannel Synchronizer
// ============================================================================

export class PodcastProgressSynchronizer {
  private static instance: PodcastProgressSynchronizer | null = null
  private channel: BroadcastChannel | null = null
  private listeners = new Set<(message: SyncBroadcastMessage) => void>()
  private storageKey = 'echo_podcast_progress_sync_event'

  private constructor() {
    if (typeof window !== 'undefined') {
      if ('BroadcastChannel' in window) {
        try {
          this.channel = new BroadcastChannel('echo_podcast_progress_sync')
          this.channel.onmessage = (event) => {
            const parsed = syncBroadcastMessageSchema.safeParse(event.data)
            if (parsed.success) {
              this.handleIncomingMessage(parsed.data)
            }
          }
        } catch {
          this.channel = null
        }
      }

      // Storage event fallback for older or sandboxed contexts
      window.addEventListener('storage', (e) => {
        if (e.key === this.storageKey && e.newValue) {
          try {
            const raw = JSON.parse(e.newValue)
            const parsed = syncBroadcastMessageSchema.safeParse(raw)
            if (parsed.success) {
              this.handleIncomingMessage(parsed.data)
            }
          } catch {
            // Ignore parse errors
          }
        }
      })
    }
  }

  public static getInstance(): PodcastProgressSynchronizer {
    if (!PodcastProgressSynchronizer.instance) {
      PodcastProgressSynchronizer.instance = new PodcastProgressSynchronizer()
    }
    return PodcastProgressSynchronizer.instance
  }

  public subscribe(listener: (message: SyncBroadcastMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private handleIncomingMessage(message: SyncBroadcastMessage): void {
    recordProgressSyncMetric('broadcastsReceived')

    // Persist received update to local Dexie database if not already identical
    if (typeof indexedDB !== 'undefined') {
      if (message.type === 'PROGRESS_UPDATE') {
        void db.podcastProgress.put(message.record).catch(() => {})
      } else if (message.type === 'DISMISS_EPISODE') {
        void db.podcastProgress
          .update(message.episodeId, { dismissed: true, updatedAt: Date.now() })
          .catch(() => {})
      }
    }

    for (const listener of this.listeners) {
      try {
        listener(message)
      } catch {
        // Safe listener dispatch
      }
    }
  }

  public broadcastProgress(record: PodcastProgressRecord): void {
    const message: SyncBroadcastMessage = {
      type: 'PROGRESS_UPDATE',
      record,
    }
    this.dispatchMessage(message)
  }

  public broadcastDismiss(episodeId: string): void {
    const message: SyncBroadcastMessage = {
      type: 'DISMISS_EPISODE',
      episodeId,
    }
    this.dispatchMessage(message)
  }

  private dispatchMessage(message: SyncBroadcastMessage): void {
    recordProgressSyncMetric('broadcastsSent')
    if (this.channel) {
      try {
        this.channel.postMessage(message)
      } catch {
        // Ignore channel errors
      }
    }

    // Storage event broadcast fallback
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(message))
      } catch {
        // Storage quotas
      }
    }
  }

  public destroy(): void {
    if (this.channel) {
      this.channel.close()
      this.channel = null
    }
    this.listeners.clear()
  }
}

export const podcastProgressSync = PodcastProgressSynchronizer.getInstance()

// ============================================================================
// Cross-Device Export & Import
// ============================================================================

export async function exportPodcastProgress(): Promise<PodcastProgressExport> {
  const records = await db.podcastProgress.toArray()
  recordProgressSyncMetric('exportsGenerated')
  return {
    version: 1,
    timestamp: Date.now(),
    device: 'Echo-Web',
    records: records.map((r) => podcastProgressRecordSchema.parse(r)),
  }
}

export async function importPodcastProgress(
  rawPayload: unknown,
  strategy: 'newest' | 'remote_ahead' = 'newest',
): Promise<{ importedCount: number; updatedCount: number }> {
  const parsed = podcastProgressExportSchema.parse(rawPayload)
  let importedCount = 0
  let updatedCount = 0

  for (const record of parsed.records) {
    const existing = await db.podcastProgress.get(record.episodeId)
    if (!existing) {
      await db.podcastProgress.put(record)
      importedCount++
      continue
    }

    if (strategy === 'newest') {
      if (record.updatedAt > (existing.updatedAt || 0)) {
        await db.podcastProgress.put(record)
        updatedCount++
      }
    } else if (strategy === 'remote_ahead') {
      if (record.completed && !existing.completed) {
        await db.podcastProgress.put(record)
        updatedCount++
      } else if (record.positionMs > existing.positionMs + REMOTE_AHEAD_MARGIN_MS) {
        await db.podcastProgress.put(record)
        updatedCount++
      }
    }
  }

  recordProgressSyncMetric('importsProcessed', importedCount + updatedCount)
  return { importedCount, updatedCount }
}
