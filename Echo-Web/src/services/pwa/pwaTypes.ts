/**
 * PWA and Service Worker schemas, types, and telemetry metrics.
 */

import { z } from 'zod'

export const pwaIconSchema = z.object({
  src: z.string().min(1),
  sizes: z.string().min(1),
  type: z.string().min(1),
  purpose: z.string().optional(),
})

export type PwaIcon = z.infer<typeof pwaIconSchema>

export const pwaManifestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  short_name: z.string().trim().min(1).max(50),
  description: z.string().max(500).optional(),
  theme_color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/, 'Valid hex color required'),
  background_color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/, 'Valid hex color required'),
  display: z.enum(['standalone', 'minimal-ui', 'fullscreen', 'browser']).default('standalone'),
  start_url: z.string().min(1),
  scope: z.string().min(1),
  icons: z.array(pwaIconSchema).min(1),
})

export type PwaManifest = z.infer<typeof pwaManifestSchema>

export const swStatusSchema = z.object({
  supported: z.boolean(),
  registered: z.boolean(),
  active: z.boolean(),
  waitingUpdate: z.boolean(),
  scope: z.string().optional(),
  isOnline: z.boolean(),
  lastChecked: z.number().int().nonnegative(),
})

export type SwStatus = z.infer<typeof swStatusSchema>

export const pwaMetricsSchema = z.object({
  registrations: z.number().int().nonnegative(),
  updatesFound: z.number().int().nonnegative(),
  updatesApplied: z.number().int().nonnegative(),
  cacheInvalidations: z.number().int().nonnegative(),
  offlineTransitions: z.number().int().nonnegative(),
  onlineTransitions: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
})

export type PwaMetrics = z.infer<typeof pwaMetricsSchema>

let metrics: PwaMetrics = {
  registrations: 0,
  updatesFound: 0,
  updatesApplied: 0,
  cacheInvalidations: 0,
  offlineTransitions: 0,
  onlineTransitions: 0,
  errors: 0,
}

export function getPwaMetrics(): PwaMetrics {
  return { ...metrics }
}

export function resetPwaMetrics(): void {
  metrics = {
    registrations: 0,
    updatesFound: 0,
    updatesApplied: 0,
    cacheInvalidations: 0,
    offlineTransitions: 0,
    onlineTransitions: 0,
    errors: 0,
  }
}

export function recordPwaMetric(metric: keyof PwaMetrics): void {
  metrics[metric]++
}
