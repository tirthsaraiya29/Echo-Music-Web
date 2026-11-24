/**
 * Discord Rich Presence schemas, telemetry metrics, and types.
 */

import { z } from 'zod'

export const discordPresencePayloadSchema = z.object({
  track: z.string().trim().min(1, 'Track title cannot be empty').max(128),
  artist: z.string().trim().min(1, 'Artist name cannot be empty').max(128),
  album: z.string().trim().max(128).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  positionMs: z.number().int().nonnegative().optional(),
  isPlaying: z.boolean().default(true),
  companionUrl: z.string().url().max(256).optional(),
})

export type DiscordPresencePayload = z.infer<typeof discordPresencePayloadSchema>

export const discordStatusResponseSchema = z.object({
  ok: z.boolean(),
  isLocalDeployment: z.boolean(),
  socketConnected: z.boolean(),
  platform: z.string(),
  hint: z.string(),
})

export type DiscordStatusResponse = z.infer<typeof discordStatusResponseSchema>

export const discordPreferenceSchema = z.object({
  discordRpc: z.boolean().default(false),
  discordMode: z.enum(['auto', 'companion', 'backend']).default('auto'),
  discordBridgeUrl: z.string().url().default('http://127.0.0.1:6463'),
})

export type DiscordPreferences = z.infer<typeof discordPreferenceSchema>

export const discordMetricsSchema = z.object({
  updatesQueued: z.number().int().nonnegative(),
  updatesSucceeded: z.number().int().nonnegative(),
  updatesFailed: z.number().int().nonnegative(),
  deduplications: z.number().int().nonnegative(),
  companionFallbacks: z.number().int().nonnegative(),
  clearOperations: z.number().int().nonnegative(),
  cancellations: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
})

export type DiscordMetrics = z.infer<typeof discordMetricsSchema>

let metrics: DiscordMetrics = {
  updatesQueued: 0,
  updatesSucceeded: 0,
  updatesFailed: 0,
  deduplications: 0,
  companionFallbacks: 0,
  clearOperations: 0,
  cancellations: 0,
  errors: 0,
}

export function getDiscordMetrics(): DiscordMetrics {
  return { ...metrics }
}

export function resetDiscordMetrics(): void {
  metrics = {
    updatesQueued: 0,
    updatesSucceeded: 0,
    updatesFailed: 0,
    deduplications: 0,
    companionFallbacks: 0,
    clearOperations: 0,
    cancellations: 0,
    errors: 0,
  }
}

export function recordDiscordMetric(metric: keyof DiscordMetrics): void {
  metrics[metric]++
}
