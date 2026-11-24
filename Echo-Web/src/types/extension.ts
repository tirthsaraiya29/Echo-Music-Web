import { z } from 'zod'

export const addonManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().default('1.0.0'),
  description: z.string().optional(),
})

export type AddonManifest = z.infer<typeof addonManifestSchema>

export const addonEndpointSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url().refine(
    (val) => val.startsWith('http://') || val.startsWith('https://'),
    { message: 'URL must start with http:// or https://' },
  ),
  enabled: z.boolean().default(true),
  priority: z.number().int().positive().default(1),
})

export type AddonEndpoint = z.infer<typeof addonEndpointSchema>

export const registerAddonInputSchema = z.object({
  url: z.string().url().refine(
    (val) => val.startsWith('http://') || val.startsWith('https://'),
    { message: 'URL must start with http:// or https://' },
  ),
  name: z.string().trim().optional(),
  enabled: z.boolean().optional(),
})

export type RegisterAddonInput = z.infer<typeof registerAddonInputSchema>

export const addonTrackSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  artist: z.string().default(''),
  duration: z.number().nonnegative().optional(),
  artworkURL: z.string().optional(),
  albumArtworkURL: z.string().optional(),
})

export type AddonTrack = z.infer<typeof addonTrackSchema>

export const addonStreamResponseSchema = z.object({
  url: z.string().url(),
  format: z.string().optional(),
  quality: z.string().optional(),
  streamQuality: z.string().optional(),
  audioQuality: z.string().optional(),
  codec: z.string().optional(),
})

export type AddonStreamResponse = z.infer<typeof addonStreamResponseSchema>

export const extensionHealthStatusSchema = z.object({
  status: z.enum(['online', 'offline', 'error']),
  latencyMs: z.number().nonnegative().optional(),
  manifest: addonManifestSchema.optional(),
  error: z.string().optional(),
})

export type ExtensionHealthStatus = z.infer<typeof extensionHealthStatusSchema>

export interface ExtensionMatchCandidate {
  track: AddonTrack
  score: number
}

export const extensionRegistryMetricsSchema = z.object({
  registrations: z.number().int().nonnegative(),
  removals: z.number().int().nonnegative(),
  toggles: z.number().int().nonnegative(),
  healthChecks: z.number().int().nonnegative(),
  healthCheckFailures: z.number().int().nonnegative(),
})

export type ExtensionRegistryMetrics = z.infer<typeof extensionRegistryMetricsSchema>

export interface ExtensionTelemetry {
  totalAttempts: number
  matchesFound: number
  resolutionSuccesses: number
  fallbackCount: number
  activeExtensionSource?: string | undefined
}

export interface ExtensionResolvedStream {
  streamUrl: string
  mimeType?: string | undefined
  codec?: string | undefined
  quality?: string | undefined
  bitrate?: number | undefined
  source: string
}
