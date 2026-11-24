import { z } from 'zod'
import type { QueueSnapshot, Track } from './audio.ts'

export const musicFlowTelemetrySchema = z.object({
  swipesCount: z.number().int().nonnegative(),
  tracksListenedCount: z.number().int().nonnegative(),
  likesCount: z.number().int().nonnegative(),
  skipsCount: z.number().int().nonnegative(),
  feedsGeneratedCount: z.number().int().nonnegative(),
  restoresSucceededCount: z.number().int().nonnegative(),
  restoresBlockedCount: z.number().int().nonnegative(),
  mixesKeptCount: z.number().int().nonnegative(),
  lastSwipeDirection: z.enum(['up', 'down']).nullable(),
  lastSwipeTimestamp: z.number().nullable(),
})

export type MusicFlowTelemetry = z.infer<typeof musicFlowTelemetrySchema>

export type FlowHandoffStatus = 'idle' | 'active' | 'restored' | 'kept' | 'revoked'

export interface MusicFlowState {
  isActive: boolean
  isLoading: boolean
  handoffStatus: FlowHandoffStatus
  ownershipToken: string | null
  savedSnapshot: QueueSnapshot | null
  feed: Track[]
  currentIndex: number
  telemetry: MusicFlowTelemetry
}
