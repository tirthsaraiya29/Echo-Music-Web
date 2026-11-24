/**
 * Listen Together room security, entropy calculations, rate limiting boundaries, and limit schemas.
 */

import { z } from 'zod'

export const roomLimitsSchema = z.object({
  maxGlobalRooms: z.number().int().positive().default(1000),
  maxRoomMembers: z.number().int().positive().default(50),
  maxRoomLogs: z.number().int().positive().default(50),
  maxNameLength: z.number().int().positive().default(32),
  maxTrackStringLength: z.number().int().positive().default(256),
  maxTrackUrlLength: z.number().int().positive().default(1024),
  maxPlaybackPositionSeconds: z.number().int().positive().default(86400),
  joinLimitPerWindow: z.number().int().positive().default(20),
  createLimitPerWindow: z.number().int().positive().default(10),
  windowDurationMs: z.number().int().positive().default(600000), // 10 minutes
})

export type RoomLimits = z.infer<typeof roomLimitsSchema>

export const DEFAULT_ROOM_LIMITS: RoomLimits = roomLimitsSchema.parse({})

export const roomSecurityMetricsSchema = z.object({
  rateLimitedJoins: z.number().int().nonnegative(),
  rateLimitedCreations: z.number().int().nonnegative(),
  invalidCodeRejections: z.number().int().nonnegative(),
  tokenAuthFailures: z.number().int().nonnegative(),
  payloadClampedOperations: z.number().int().nonnegative(),
  oversizedTrackSanitizations: z.number().int().nonnegative(),
})

export type RoomSecurityMetrics = z.infer<typeof roomSecurityMetricsSchema>

let securityMetrics: RoomSecurityMetrics = {
  rateLimitedJoins: 0,
  rateLimitedCreations: 0,
  invalidCodeRejections: 0,
  tokenAuthFailures: 0,
  payloadClampedOperations: 0,
  oversizedTrackSanitizations: 0,
}

export function getRoomSecurityMetrics(): RoomSecurityMetrics {
  return { ...securityMetrics }
}

export function resetRoomSecurityMetrics(): void {
  securityMetrics = {
    rateLimitedJoins: 0,
    rateLimitedCreations: 0,
    invalidCodeRejections: 0,
    tokenAuthFailures: 0,
    payloadClampedOperations: 0,
    oversizedTrackSanitizations: 0,
  }
}

export function recordRoomSecurityMetric(metric: keyof RoomSecurityMetrics): void {
  securityMetrics[metric]++
}

/**
 * Calculates the theoretical Shannon entropy in bits for an n-character code from an alphabet of size S:
 * H = n * log2(S)
 */
export function calculateCodeEntropy(codeLength: number, alphabetSize: number): number {
  if (codeLength <= 0 || alphabetSize <= 1) return 0
  return Number((codeLength * Math.log2(alphabetSize)).toFixed(2))
}

/**
 * Validates that an input URL is safe (http/https only, no dangerous protocols like javascript: or file:).
 */
export function isSafeArtworkUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false
  const trimmed = url.trim()
  if (trimmed.length > DEFAULT_ROOM_LIMITS.maxTrackUrlLength) return false
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}
