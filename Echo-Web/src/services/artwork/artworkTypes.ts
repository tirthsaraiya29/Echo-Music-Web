/**
 * Artwork and Image Loading schemas, validation, and telemetry metrics.
 */

import { z } from 'zod'

export const artworkSeedSchema = z.string().trim().min(1).max(500)
export const artworkSizeSchema = z.number().int().min(16).max(2048).default(240)

export const imageUrlSchema = z
  .string()
  .trim()
  .refine(
    (url) =>
      url.startsWith('http://') ||
      url.startsWith('https://') ||
      url.startsWith('data:image/') ||
      url.startsWith('blob:'),
    { message: 'Invalid image URL protocol' },
  )

export const echoImagePropsSchema = z.object({
  src: z.string().optional(),
  alt: z.string().default(''),
  seed: z.string().optional().default('echo-artwork'),
  size: artworkSizeSchema.optional().default(240),
  className: z.string().optional(),
  decorative: z.boolean().optional().default(false),
})

export type EchoImageProps = z.infer<typeof echoImagePropsSchema>

export const artworkMetricsSchema = z.object({
  artworkGenerated: z.number().int().nonnegative(),
  imagesLoaded: z.number().int().nonnegative(),
  imageLoadErrors: z.number().int().nonnegative(),
  imageFallbacksTriggered: z.number().int().nonnegative(),
  preloadsCoalesced: z.number().int().nonnegative(),
})

export type ArtworkMetrics = z.infer<typeof artworkMetricsSchema>

let metrics: ArtworkMetrics = {
  artworkGenerated: 0,
  imagesLoaded: 0,
  imageLoadErrors: 0,
  imageFallbacksTriggered: 0,
  preloadsCoalesced: 0,
}

export function getArtworkMetrics(): ArtworkMetrics {
  return { ...metrics }
}

export function resetArtworkMetrics(): void {
  metrics = {
    artworkGenerated: 0,
    imagesLoaded: 0,
    imageLoadErrors: 0,
    imageFallbacksTriggered: 0,
    preloadsCoalesced: 0,
  }
}

export function recordArtworkMetric(metric: keyof ArtworkMetrics): void {
  metrics[metric]++
}
