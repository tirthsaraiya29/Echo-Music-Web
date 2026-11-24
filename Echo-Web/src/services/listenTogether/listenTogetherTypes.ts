/**
 * Listen Together client schemas, types, and telemetry metrics.
 */

import { z } from 'zod'

export const roomParticipantSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(50),
  isHost: z.boolean(),
  isBuffering: z.boolean().default(false),
  lastSeen: z.number().int().nonnegative(),
})

export type RoomParticipant = z.infer<typeof roomParticipantSchema>

export const roomEventLogSchema = z.object({
  id: z.string().min(1),
  time: z.number().int().nonnegative(),
  message: z.string().trim().min(1).max(256),
})

export type RoomEventLog = z.infer<typeof roomEventLogSchema>

export const createRoomInputSchema = z.object({
  hostName: z.string().trim().min(1, 'Host nickname cannot be empty').max(50),
})

export type CreateRoomInput = z.infer<typeof createRoomInputSchema>

export const joinRoomInputSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6,8}$/, 'Room code must be 6 to 8 alphanumeric characters'),
  userName: z.string().trim().min(1, 'Nickname cannot be empty').max(50),
})

export type JoinRoomInput = z.infer<typeof joinRoomInputSchema>

export const syncPayloadSchema = z.object({
  code: z.string().trim().toUpperCase().min(6).max(8),
  userId: z.string().min(1),
  token: z.string().min(1),
  action: z.enum(['update_state', 'heartbeat', 'leave']),
  track: z.any().nullable().optional(),
  isPlaying: z.boolean().optional(),
  playbackPositionSeconds: z.number().nonnegative().optional(),
})

export type SyncPayload = z.infer<typeof syncPayloadSchema>

export const listenTogetherMetricsSchema = z.object({
  roomsCreated: z.number().int().nonnegative(),
  roomsJoined: z.number().int().nonnegative(),
  roomsLeft: z.number().int().nonnegative(),
  syncHeartbeats: z.number().int().nonnegative(),
  syncStateUpdates: z.number().int().nonnegative(),
  deduplications: z.number().int().nonnegative(),
  coalescedActions: z.number().int().nonnegative(),
  networkErrors: z.number().int().nonnegative(),
  cancellations: z.number().int().nonnegative(),
})

export type ListenTogetherMetrics = z.infer<typeof listenTogetherMetricsSchema>

let metrics: ListenTogetherMetrics = {
  roomsCreated: 0,
  roomsJoined: 0,
  roomsLeft: 0,
  syncHeartbeats: 0,
  syncStateUpdates: 0,
  deduplications: 0,
  coalescedActions: 0,
  networkErrors: 0,
  cancellations: 0,
}

export function getListenTogetherMetrics(): ListenTogetherMetrics {
  return { ...metrics }
}

export function resetListenTogetherMetrics(): void {
  metrics = {
    roomsCreated: 0,
    roomsJoined: 0,
    roomsLeft: 0,
    syncHeartbeats: 0,
    syncStateUpdates: 0,
    deduplications: 0,
    coalescedActions: 0,
    networkErrors: 0,
    cancellations: 0,
  }
}

export function recordListenTogetherMetric(metric: keyof ListenTogetherMetrics): void {
  metrics[metric]++
}
