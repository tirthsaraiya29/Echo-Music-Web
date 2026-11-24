import { z } from 'zod'
import { isValidTrack } from '../../engine/QueueManager.ts'
import type {
  RadioContinuationMetrics,
  RadioContinuationState,
  RadioContinuationStatus,
  Track,
} from '../../types/audio.ts'

export type { RadioContinuationMetrics, RadioContinuationState, RadioContinuationStatus }

export const radioContinuationInputSchema = z
  .object({
    videoId: z.string().optional(),
    continuationToken: z.string().optional(),
    region: z.string().regex(/^[A-Z]{2}$/).default('US'),
    explicit: z.boolean().default(true),
  })
  .refine((data) => Boolean(data.videoId || data.continuationToken), {
    message: 'videoId or continuationToken is required',
  })

export type RadioContinuationInput = z.infer<typeof radioContinuationInputSchema>

export const radioContinuationResponseSchema = z.object({
  tracks: z.array(z.custom<Track>((val) => isValidTrack(val))),
  continuationToken: z.string().optional(),
})

export type RadioContinuationResponse = {
  tracks: Track[]
  continuationToken?: string | undefined
}

export const radioRetryOptionsSchema = z.object({
  maxRetries: z.number().int().min(0).max(10).default(3),
  initialBackoffMs: z.number().min(10).max(10000).default(800),
  maxBackoffMs: z.number().min(50).max(30000).default(8000),
  timeoutMs: z.number().min(100).max(30000).default(8000),
})

export type RadioRetryOptions = z.infer<typeof radioRetryOptionsSchema>
