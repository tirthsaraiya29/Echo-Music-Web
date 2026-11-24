import test from 'node:test'
import assert from 'node:assert'

import {
  artworkSeedSchema,
  artworkSizeSchema,
  imageUrlSchema,
  echoImagePropsSchema,
  artworkMetricsSchema,
  getArtworkMetrics,
  resetArtworkMetrics,
  recordArtworkMetric,
} from '../src/services/artwork/artworkTypes.ts'

import { ArtworkLoader, artworkLoader } from '../src/services/artwork/artworkLoader.ts'
import { artwork } from '../src/utils/artwork.ts'

test('Artwork: schemas validate seed, size, and URLs [SMALL-47]', () => {
  assert.strictEqual(artworkSeedSchema.safeParse('album-123').success, true)
  assert.strictEqual(artworkSeedSchema.safeParse('').success, false)

  assert.strictEqual(artworkSizeSchema.safeParse(300).success, true)
  assert.strictEqual(artworkSizeSchema.safeParse(10).success, false) // min 16
  assert.strictEqual(artworkSizeSchema.safeParse(5000).success, false) // max 2048

  assert.strictEqual(imageUrlSchema.safeParse('https://example.com/cover.jpg').success, true)
  assert.strictEqual(imageUrlSchema.safeParse('data:image/svg+xml,...').success, true)
  assert.strictEqual(imageUrlSchema.safeParse('blob:http://localhost/uuid').success, true)
  assert.strictEqual(imageUrlSchema.safeParse('ftp://example.com/cover.jpg').success, false)

  const props = echoImagePropsSchema.parse({ src: 'https://example.com/cover.jpg' })
  assert.strictEqual(props.size, 240)
  assert.strictEqual(props.decorative, false)
})

test('Artwork: deterministic SVG generator produces valid data URI [SMALL-47]', () => {
  const uri1 = artwork('album-seed-1')
  const uri2 = artwork('album-seed-1')
  const uri3 = artwork('album-seed-2')

  assert.strictEqual(uri1.startsWith('data:image/svg+xml,'), true)
  assert.strictEqual(uri1, uri2) // Determinism invariant
  assert.notStrictEqual(uri1, uri3) // Different seed yields different artwork
})

test('Artwork: telemetry metrics record activity and reset [SMALL-47]', () => {
  resetArtworkMetrics()
  const initial = getArtworkMetrics()
  assert.strictEqual(initial.artworkGenerated, 0)
  assert.strictEqual(initial.imageFallbacksTriggered, 0)

  recordArtworkMetric('artworkGenerated')
  recordArtworkMetric('imageFallbacksTriggered')
  recordArtworkMetric('imagesLoaded')

  const updated = getArtworkMetrics()
  assert.strictEqual(updated.artworkGenerated, 1)
  assert.strictEqual(updated.imageFallbacksTriggered, 1)
  assert.strictEqual(updated.imagesLoaded, 1)
  assert.strictEqual(artworkMetricsSchema.safeParse(updated).success, true)

  resetArtworkMetrics()
  assert.strictEqual(getArtworkMetrics().artworkGenerated, 0)
})

test('Artwork: ArtworkLoader handles preload coalescing and error rejection [SMALL-47]', async () => {
  resetArtworkMetrics()
  const loader = ArtworkLoader.getInstance()
  assert.strictEqual(loader, artworkLoader)

  // Rejects invalid URL scheme
  const invalid = await loader.preloadImage('ftp://invalid.url')
  assert.strictEqual(invalid, false)
  assert.strictEqual(getArtworkMetrics().imageLoadErrors, 1)

  // Concurrent preloads for same valid URL are coalesced
  const p1 = loader.preloadImage('https://example.com/image.png')
  const p2 = loader.preloadImage('https://example.com/image.png')
  const [r1, r2] = await Promise.all([p1, p2])

  assert.strictEqual(r1, true)
  assert.strictEqual(r2, true)
  assert.strictEqual(getArtworkMetrics().preloadsCoalesced, 1)

  loader.clear()
})
