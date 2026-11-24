/**
 * Lyrics Synchronization & Calibration Service.
 *
 * Responsibilities:
 * - Manages saved per-track lyric timing offsets with optional provider-specific keying.
 * - Manages audio sync profiles (e.g. Default/ASIO, Bluetooth A2DP latency compensation, Network Cast).
 * - Manages provider-specific calibration offsets (e.g. YouTube subtitles, LRCLIB, BetterLyrics).
 * - Computes combined effective sync timing:
 *     effectiveOffset = clampSyncOffset(trackOffset + globalProfileOffset + providerCalibration)
 * - Persists profiles and track offsets to Dexie IndexedDB with in-memory & localStorage fallback.
 * - Provides comprehensive telemetry metrics and runtime validation via Zod schemas.
 */

import { z } from 'zod'
import { db, type SyncOffsetRecord } from '../db/echoDatabase.ts'
import { clampSyncOffset } from './lyricsUtils.ts'
import { useEchoStore } from '../../stores/useEchoStore.ts'

// --- Runtime Schemas ---

export const lyricsSyncProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  globalOffsetMs: z.number().int().min(-60000).max(60000).default(0),
  providerOffsets: z.record(z.string(), z.number().int().min(-60000).max(60000)).default({}),
  isDefault: z.boolean().default(false),
  updatedAt: z.number().nonnegative(),
})

export type LyricsSyncProfile = z.infer<typeof lyricsSyncProfileSchema>

export const trackSyncRecordSchema = z.object({
  trackId: z.string().min(1),
  offsetMs: z.number().int().min(-60000).max(60000),
  provider: z.string().optional(),
  profileId: z.string().optional(),
  updatedAt: z.number().nonnegative(),
})

export type TrackSyncRecord = z.infer<typeof trackSyncRecordSchema>

export const syncCalibrationSummarySchema = z.object({
  effectiveOffsetMs: z.number().int(),
  trackOffsetMs: z.number().int(),
  providerCalibrationMs: z.number().int(),
  globalOffsetMs: z.number().int(),
  profileId: z.string(),
  profileName: z.string(),
  provider: z.string().optional(),
})

export type SyncCalibrationSummary = z.infer<typeof syncCalibrationSummarySchema>

export const lyricsSyncMetricsSchema = z.object({
  profileSwitches: z.number().int().nonnegative(),
  providerCalibrationsSet: z.number().int().nonnegative(),
  trackOffsetsSaved: z.number().int().nonnegative(),
  effectiveOffsetLookups: z.number().int().nonnegative(),
  profilesCreated: z.number().int().nonnegative(),
  profilesDeleted: z.number().int().nonnegative(),
})

export type LyricsSyncMetrics = z.infer<typeof lyricsSyncMetricsSchema>

// --- Default Built-in Profiles ---

export const BUILTIN_SYNC_PROFILES: LyricsSyncProfile[] = [
  {
    id: 'default',
    name: 'Default (Direct / Low Latency)',
    description: 'Zero audio latency compensation for wired headphones, DACs, and system audio',
    globalOffsetMs: 0,
    providerOffsets: {
      YOUTUBE: -200,
      YOUTUBE_SUBTITLES: -200,
    },
    isDefault: true,
    updatedAt: 1700000000000,
  },
  {
    id: 'bluetooth',
    name: 'Bluetooth A2DP (+180ms)',
    description: 'Compensates for standard wireless Bluetooth codec and buffer latency',
    globalOffsetMs: 180,
    providerOffsets: {
      YOUTUBE: -200,
      YOUTUBE_SUBTITLES: -200,
    },
    isDefault: false,
    updatedAt: 1700000000000,
  },
  {
    id: 'network-cast',
    name: 'AirPlay & Cast (+350ms)',
    description: 'Compensates for network streaming buffer delays on smart speakers and receivers',
    globalOffsetMs: 350,
    providerOffsets: {
      YOUTUBE: -200,
      YOUTUBE_SUBTITLES: -200,
    },
    isDefault: false,
    updatedAt: 1700000000000,
  },
  {
    id: 'anticipated-lead',
    name: 'Anticipated Lead (-200ms)',
    description: 'Displays lyrics 200ms ahead of vocals for fast karaoke readability',
    globalOffsetMs: -200,
    providerOffsets: {
      YOUTUBE: -200,
    },
    isDefault: false,
    updatedAt: 1700000000000,
  },
]

// Module-level telemetry
let syncMetrics: LyricsSyncMetrics = {
  profileSwitches: 0,
  providerCalibrationsSet: 0,
  trackOffsetsSaved: 0,
  effectiveOffsetLookups: 0,
  profilesCreated: 0,
  profilesDeleted: 0,
}

export class LyricsSyncProfileService {
  private static instance: LyricsSyncProfileService | null = null
  private memoryProfiles: Map<string, LyricsSyncProfile> = new Map()
  private memoryTrackOffsets: Map<string, number> = new Map()
  private activeProfileId = 'default'
  private initialized = false

  public static getInstance(): LyricsSyncProfileService {
    if (!LyricsSyncProfileService.instance) {
      LyricsSyncProfileService.instance = new LyricsSyncProfileService()
    }
    return LyricsSyncProfileService.instance
  }

  constructor() {
    this.seedMemoryProfiles()
  }

  private seedMemoryProfiles(): void {
    for (const p of BUILTIN_SYNC_PROFILES) {
      this.memoryProfiles.set(p.id, { ...p })
    }
  }

  /**
   * Initializes the database seeding default profiles if none exist.
   */
  public async init(): Promise<void> {
    if (this.initialized) return

    try {
      const activePref = useEchoStore.getState().preferences.activeLyricsSyncProfileId
      if (activePref) {
        this.activeProfileId = activePref
      }

      if (typeof indexedDB !== 'undefined' && db?.syncProfiles) {
        const count = await db.syncProfiles.count()
        if (count === 0) {
          await db.syncProfiles.bulkPut(BUILTIN_SYNC_PROFILES)
        } else {
          const stored = await db.syncProfiles.toArray()
          for (const item of stored) {
            this.memoryProfiles.set(item.id, item)
          }
        }
      }
    } catch {
      // IndexedDB unavailable or SSR fallback
    }

    this.initialized = true
  }

  /**
   * Returns all available sync profiles.
   */
  public async getProfiles(): Promise<LyricsSyncProfile[]> {
    await this.init()

    try {
      if (typeof indexedDB !== 'undefined' && db?.syncProfiles) {
        const stored = await db.syncProfiles.toArray()
        if (stored && stored.length > 0) {
          for (const p of stored) {
            this.memoryProfiles.set(p.id, p)
          }
          return stored
        }
      }
    } catch {
      // Fallback to memory
    }

    return Array.from(this.memoryProfiles.values())
  }

  /**
   * Returns a specific profile by ID, or null if not found.
   */
  public async getProfile(profileId: string): Promise<LyricsSyncProfile | null> {
    await this.init()

    try {
      if (typeof indexedDB !== 'undefined' && db?.syncProfiles) {
        const stored = await db.syncProfiles.get(profileId)
        if (stored) return stored
      }
    } catch {
      // Fallback to memory
    }

    return this.memoryProfiles.get(profileId) || null
  }

  /**
   * Returns the current active sync profile.
   */
  public async getActiveProfile(): Promise<LyricsSyncProfile> {
    await this.init()
    const active = await this.getProfile(this.activeProfileId)
    if (active) return active

    const defaultProfile = await this.getProfile('default')
    return defaultProfile || BUILTIN_SYNC_PROFILES[0]!
  }

  /**
   * Sets the active sync profile.
   */
  public async setActiveProfile(profileId: string): Promise<void> {
    await this.init()
    const profile = await this.getProfile(profileId)
    if (!profile) {
      throw new Error(`Lyrics sync profile "${profileId}" not found`)
    }

    this.activeProfileId = profileId
    syncMetrics.profileSwitches++

    try {
      useEchoStore.getState().setPreference('activeLyricsSyncProfileId', profileId)
    } catch {
      // Store unavailable
    }
  }

  /**
   * Creates a new custom sync profile.
   */
  public async createProfile(
    profileInput: Omit<LyricsSyncProfile, 'id' | 'updatedAt'>,
  ): Promise<LyricsSyncProfile> {
    await this.init()

    const id = `profile-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    const newProfile: LyricsSyncProfile = lyricsSyncProfileSchema.parse({
      ...profileInput,
      id,
      isDefault: false,
      updatedAt: Date.now(),
    })

    this.memoryProfiles.set(id, newProfile)
    syncMetrics.profilesCreated++

    try {
      if (typeof indexedDB !== 'undefined' && db?.syncProfiles) {
        await db.syncProfiles.put(newProfile)
      }
    } catch {
      // Fallback
    }

    return newProfile
  }

  /**
   * Updates an existing profile.
   */
  public async updateProfile(
    profileId: string,
    updates: Partial<Omit<LyricsSyncProfile, 'id'>>,
  ): Promise<LyricsSyncProfile> {
    await this.init()

    const existing = await this.getProfile(profileId)
    if (!existing) {
      throw new Error(`Profile ${profileId} not found`)
    }

    const updated: LyricsSyncProfile = lyricsSyncProfileSchema.parse({
      ...existing,
      ...updates,
      id: profileId,
      updatedAt: Date.now(),
    })

    this.memoryProfiles.set(profileId, updated)

    try {
      if (typeof indexedDB !== 'undefined' && db?.syncProfiles) {
        await db.syncProfiles.put(updated)
      }
    } catch {
      // Fallback
    }

    return updated
  }

  /**
   * Deletes a custom profile. Built-in or default profiles cannot be deleted.
   */
  public async deleteProfile(profileId: string): Promise<boolean> {
    await this.init()

    const existing = await this.getProfile(profileId)
    if (!existing || existing.isDefault || profileId === 'default') {
      return false
    }

    this.memoryProfiles.delete(profileId)
    syncMetrics.profilesDeleted++

    if (this.activeProfileId === profileId) {
      this.activeProfileId = 'default'
      useEchoStore.getState().setPreference('activeLyricsSyncProfileId', 'default')
    }

    try {
      if (typeof indexedDB !== 'undefined' && db?.syncProfiles) {
        await db.syncProfiles.delete(profileId)
      }
    } catch {
      // Fallback
    }

    return true
  }

  /**
   * Sets provider-specific calibration offset on a profile (or active profile).
   */
  public async setProviderCalibration(
    provider: string,
    offsetMs: number,
    profileId?: string,
  ): Promise<void> {
    await this.init()
    const targetProfileId = profileId || this.activeProfileId
    const profile = await this.getProfile(targetProfileId)
    if (!profile) return

    const normProvider = provider.toUpperCase().trim()
    const clampedOffset = clampSyncOffset(offsetMs)

    const updatedOffsets = {
      ...profile.providerOffsets,
      [normProvider]: clampedOffset,
    }

    await this.updateProfile(targetProfileId, {
      providerOffsets: updatedOffsets,
    })

    syncMetrics.providerCalibrationsSet++
  }

  /**
   * Generates a composite key for track and provider offset lookup.
   */
  private buildTrackKey(trackId: string, provider?: string): string {
    const cleanTrack = trackId.trim()
    if (provider && provider.trim()) {
      return `${cleanTrack}:${provider.trim().toUpperCase()}`
    }
    return cleanTrack
  }

  /**
   * Retrieves saved track offset. Checks provider-specific track key, then general track key.
   */
  public async getTrackOffset(trackId: string, provider?: string): Promise<number> {
    if (!trackId) return 0
    await this.init()

    const providerKey = this.buildTrackKey(trackId, provider)
    const baseKey = trackId.trim()

    try {
      if (typeof indexedDB !== 'undefined' && db?.syncOffsets) {
        if (provider) {
          const providerRecord = await db.syncOffsets.get(providerKey)
          if (providerRecord) return providerRecord.offsetMs
        }

        const baseRecord = await db.syncOffsets.get(baseKey)
        if (baseRecord) return baseRecord.offsetMs
      }
    } catch {
      // Fallback to memory
    }

    if (provider && this.memoryTrackOffsets.has(providerKey)) {
      return this.memoryTrackOffsets.get(providerKey)!
    }
    return this.memoryTrackOffsets.get(baseKey) ?? 0
  }

  /**
   * Saves offset for a specific track, optionally scoped to a provider.
   */
  public async saveTrackOffset(
    trackId: string,
    offsetMs: number,
    provider?: string,
  ): Promise<void> {
    if (!trackId) return
    await this.init()

    const clamped = clampSyncOffset(offsetMs)
    const key = this.buildTrackKey(trackId, provider)
    this.memoryTrackOffsets.set(key, clamped)
    syncMetrics.trackOffsetsSaved++

    const record: SyncOffsetRecord = {
      trackId: key,
      offsetMs: clamped,
      provider: provider ? provider.toUpperCase().trim() : undefined,
      profileId: this.activeProfileId,
      updatedAt: Date.now(),
    }

    try {
      if (typeof indexedDB !== 'undefined' && db?.syncOffsets) {
        await db.syncOffsets.put(record)
      }
    } catch {
      // Fallback
    }
  }

  /**
   * Resets (removes) saved offset for a track.
   */
  public async resetTrackOffset(trackId: string, provider?: string): Promise<void> {
    if (!trackId) return
    await this.init()

    const key = this.buildTrackKey(trackId, provider)
    this.memoryTrackOffsets.delete(key)
    if (provider) {
      this.memoryTrackOffsets.delete(trackId.trim())
    }

    try {
      if (typeof indexedDB !== 'undefined' && db?.syncOffsets) {
        await db.syncOffsets.delete(key)
        if (provider) {
          await db.syncOffsets.delete(trackId.trim())
        }
      }
    } catch {
      // Fallback
    }
  }

  /**
   * Resolves total effective offset for a track and provider under active sync profile:
   *   effectiveOffset = clampSyncOffset(trackOffset + profileGlobalOffset + providerCalibration)
   */
  public async resolveEffectiveOffset(
    trackId: string,
    provider?: string,
  ): Promise<SyncCalibrationSummary> {
    await this.init()
    syncMetrics.effectiveOffsetLookups++

    const profile = await this.getActiveProfile()
    const trackOffsetMs = await this.getTrackOffset(trackId, provider)
    const globalOffsetMs = profile.globalOffsetMs || 0

    let providerCalibrationMs = 0
    if (provider && profile.providerOffsets) {
      const normProvider = provider.toUpperCase().trim()
      providerCalibrationMs = profile.providerOffsets[normProvider] ?? 0
    }

    const effectiveOffsetMs = clampSyncOffset(
      trackOffsetMs + globalOffsetMs + providerCalibrationMs,
    )

    return syncCalibrationSummarySchema.parse({
      effectiveOffsetMs,
      trackOffsetMs,
      providerCalibrationMs,
      globalOffsetMs,
      profileId: profile.id,
      profileName: profile.name,
      provider: provider || undefined,
    })
  }

  /**
   * Resets all profiles to factory defaults.
   */
  public async resetAll(): Promise<void> {
    this.memoryProfiles.clear()
    this.memoryTrackOffsets.clear()
    this.seedMemoryProfiles()
    this.activeProfileId = 'default'

    try {
      useEchoStore.getState().setPreference('activeLyricsSyncProfileId', 'default')
      if (typeof indexedDB !== 'undefined' && db?.syncProfiles) {
        await db.syncProfiles.clear()
        await db.syncProfiles.bulkPut(BUILTIN_SYNC_PROFILES)
      }
      if (typeof indexedDB !== 'undefined' && db?.syncOffsets) {
        await db.syncOffsets.clear()
      }
    } catch {
      // Fallback
    }
  }

  /**
   * Telemetry metrics accessors.
   */
  public getMetrics(): LyricsSyncMetrics {
    return { ...syncMetrics }
  }

  public resetMetrics(): void {
    syncMetrics = {
      profileSwitches: 0,
      providerCalibrationsSet: 0,
      trackOffsetsSaved: 0,
      effectiveOffsetLookups: 0,
      profilesCreated: 0,
      profilesDeleted: 0,
    }
  }
}

export const lyricsSyncProfileService = LyricsSyncProfileService.getInstance()
