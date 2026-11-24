/**
 * Echo Find Music Recognition History Service.
 *
 * Responsibilities:
 * - Persists music recognition matches, timestamps, confidence scores, and providers.
 * - Stores match history in Dexie IndexedDB `db.recognitionHistory` with memory fallback.
 * - Supports chronological retrieval, text searching, single-item deletion, and full history clearing.
 * - Tracks user playback actions and telemetry metrics.
 * - Validates all records and payloads at runtime using Zod schemas.
 */

import { z } from 'zod'
import { db, type RecognitionHistoryRecord } from '../db/echoDatabase.ts'
import type { Track } from '../../types/domain.ts'

// --- Runtime Schemas ---

export const recognitionHistoryItemSchema = z.object({
  id: z.string().min(1),
  trackId: z.string().min(1),
  title: z.string().min(1),
  artist: z.string().min(1),
  album: z.string().optional(),
  artwork: z.string().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  confidence: z.number().min(0).max(100),
  recognizedAt: z.number().nonnegative(),
  provider: z.string().default('Shazam Gateway (Default)'),
  played: z.boolean().default(false),
})

export type RecognitionHistoryItem = z.infer<typeof recognitionHistoryItemSchema>

export const recognitionHistoryMetricsSchema = z.object({
  itemsAdded: z.number().int().nonnegative(),
  itemsDeleted: z.number().int().nonnegative(),
  historyCleared: z.number().int().nonnegative(),
  historyPlays: z.number().int().nonnegative(),
})

export type RecognitionHistoryMetrics = z.infer<typeof recognitionHistoryMetricsSchema>

// Module-level telemetry
let historyMetrics: RecognitionHistoryMetrics = {
  itemsAdded: 0,
  itemsDeleted: 0,
  historyCleared: 0,
  historyPlays: 0,
}

export class RecognitionHistoryService {
  private static instance: RecognitionHistoryService | null = null
  private memoryHistory: Map<string, RecognitionHistoryItem> = new Map()

  public static getInstance(): RecognitionHistoryService {
    if (!RecognitionHistoryService.instance) {
      RecognitionHistoryService.instance = new RecognitionHistoryService()
    }
    return RecognitionHistoryService.instance
  }

  /**
   * Records a new matched track into recognition history.
   */
  public async addMatch(
    track: Track,
    confidence = 95,
    provider = 'Shazam Gateway (Default)',
  ): Promise<RecognitionHistoryItem> {
    const trackId = track.videoId || track.id || `rec-${Date.now()}`
    const id = `rec_hist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`

    const item: RecognitionHistoryItem = recognitionHistoryItemSchema.parse({
      id,
      trackId,
      title: track.title,
      artist: track.artistName,
      album: track.albumTitle || undefined,
      artwork: track.artwork || undefined,
      durationSeconds: track.durationSeconds || undefined,
      confidence: Math.round(confidence),
      recognizedAt: Date.now(),
      provider,
      played: false,
    })

    this.memoryHistory.set(id, item)
    historyMetrics.itemsAdded++

    try {
      if (typeof indexedDB !== 'undefined' && db?.recognitionHistory) {
        const record: RecognitionHistoryRecord = {
          ...item,
        }
        await db.recognitionHistory.put(record)
      }
    } catch {
      // Fallback to memory
    }

    return item
  }

  /**
   * Retrieves all recognition history ordered chronologically (newest first).
   */
  public async getHistory(): Promise<RecognitionHistoryItem[]> {
    try {
      if (typeof indexedDB !== 'undefined' && db?.recognitionHistory) {
        const stored = await db.recognitionHistory.orderBy('recognizedAt').reverse().toArray()
        if (stored && stored.length > 0) {
          for (const item of stored) {
            this.memoryHistory.set(item.id, item)
          }
          return stored
        }
      }
    } catch {
      // Fallback to memory
    }

    const items = Array.from(this.memoryHistory.values())
    items.sort((a, b) => b.recognizedAt - a.recognizedAt)
    return items
  }

  /**
   * Retrieves a single history item by ID.
   */
  public async getHistoryItem(id: string): Promise<RecognitionHistoryItem | null> {
    try {
      if (typeof indexedDB !== 'undefined' && db?.recognitionHistory) {
        const stored = await db.recognitionHistory.get(id)
        if (stored) return stored
      }
    } catch {
      // Fallback
    }

    return this.memoryHistory.get(id) || null
  }

  /**
   * Deletes a single history item by ID.
   */
  public async deleteItem(id: string): Promise<boolean> {
    const existed = this.memoryHistory.delete(id)
    historyMetrics.itemsDeleted++

    try {
      if (typeof indexedDB !== 'undefined' && db?.recognitionHistory) {
        await db.recognitionHistory.delete(id)
        return true
      }
    } catch {
      // Fallback
    }

    return existed
  }

  /**
   * Clears all recognition history.
   */
  public async clearHistory(): Promise<void> {
    this.memoryHistory.clear()
    historyMetrics.historyCleared++

    try {
      if (typeof indexedDB !== 'undefined' && db?.recognitionHistory) {
        await db.recognitionHistory.clear()
      }
    } catch {
      // Fallback
    }
  }

  /**
   * Marks a history item as played.
   */
  public async markAsPlayed(id: string): Promise<void> {
    const item = await this.getHistoryItem(id)
    if (!item) return

    item.played = true
    this.memoryHistory.set(id, item)
    historyMetrics.historyPlays++

    try {
      if (typeof indexedDB !== 'undefined' && db?.recognitionHistory) {
        await db.recognitionHistory.update(id, { played: true })
      }
    } catch {
      // Fallback
    }
  }

  /**
   * Searches history items by title or artist.
   */
  public async searchHistory(query: string): Promise<RecognitionHistoryItem[]> {
    const all = await this.getHistory()
    if (!query || !query.trim()) return all

    const clean = query.trim().toLowerCase()
    return all.filter(
      (item) =>
        item.title.toLowerCase().includes(clean) ||
        item.artist.toLowerCase().includes(clean) ||
        (item.album && item.album.toLowerCase().includes(clean)),
    )
  }

  /**
   * Telemetry metrics accessors.
   */
  public getMetrics(): RecognitionHistoryMetrics {
    return { ...historyMetrics }
  }

  public resetMetrics(): void {
    historyMetrics = {
      itemsAdded: 0,
      itemsDeleted: 0,
      historyCleared: 0,
      historyPlays: 0,
    }
  }
}

export const recognitionHistoryService = RecognitionHistoryService.getInstance()
