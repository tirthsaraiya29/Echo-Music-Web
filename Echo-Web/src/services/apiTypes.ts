/**
 * API Fetch Layer schemas, options, and telemetry metrics.
 */

import { z } from 'zod'

export const apiFetchOptionsSchema = z.object({
  timeoutMs: z.number().int().min(100).max(60000).optional().default(10000),
  retries: z.number().int().min(0).max(3).optional().default(0),
  retryDelayMs: z.number().int().min(50).max(5000).optional().default(200),
  dedup: z.boolean().optional().default(false),
})

export type ApiFetchOptions = z.infer<typeof apiFetchOptionsSchema>

export const apiMetricsSchema = z.object({
  requestsTotal: z.number().int().nonnegative(),
  requestsSuccessful: z.number().int().nonnegative(),
  requestsFailed: z.number().int().nonnegative(),
  retriesAttempted: z.number().int().nonnegative(),
  timeoutsTriggered: z.number().int().nonnegative(),
  dedupCoalesced: z.number().int().nonnegative(),
})

export type ApiMetrics = z.infer<typeof apiMetricsSchema>

let metrics: ApiMetrics = {
  requestsTotal: 0,
  requestsSuccessful: 0,
  requestsFailed: 0,
  retriesAttempted: 0,
  timeoutsTriggered: 0,
  dedupCoalesced: 0,
}

export function getApiMetrics(): ApiMetrics {
  return { ...metrics }
}

export function resetApiMetrics(): void {
  metrics = {
    requestsTotal: 0,
    requestsSuccessful: 0,
    requestsFailed: 0,
    retriesAttempted: 0,
    timeoutsTriggered: 0,
    dedupCoalesced: 0,
  }
}

export function recordApiMetric(metric: keyof ApiMetrics): void {
  metrics[metric]++
}
