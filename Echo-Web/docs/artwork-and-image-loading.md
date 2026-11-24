# Artwork & Image Loading Architecture [SMALL-47]

## Overview
Echo Music Web implements a resilient, zero-broken-image artwork rendering architecture. When album covers, artist avatars, or playlist thumbnails fail to load or are absent, deterministic, self-contained SVG artwork is generated instantly on-device without external dependencies.

## Key Capabilities
1. **Deterministic SVG Fallback (`artwork.ts`)**:
   - Generates consistent, unique geometric compositions from input strings using Mulberry32 PRNG and coherent color palettes.
   - Zero media caching: SVG data URIs require no network requests.
2. **Accessible Image Component (`EchoImage.tsx`)**:
   - Automatic error detection with seamless fallback to generated SVG.
   - Lazy loading (`loading="lazy"`), asynchronous decoding (`decoding="async"`), and strict `referrerPolicy="no-referrer"`.
   - Accessible ARIA attributes: decorative mode (`aria-hidden="true"`, empty `alt`) or explicit descriptive text.
3. **Preload Coalescing & Cancellation (`artworkLoader.ts`)**:
   - In-flight request deduplication prevents redundant preloads for identical URLs.
   - Bounded timeouts (default 5000ms) with `AbortSignal` cancellation support.
   - Automatic revocation of local blob object URLs.

## Telemetry
`getArtworkMetrics()` instruments:
- `artworkGenerated`
- `imagesLoaded`
- `imageLoadErrors`
- `imageFallbacksTriggered`
- `preloadsCoalesced`

## Verification
- Unit & integration tests in `Echo-Web/test/artwork-loading.test.ts`.
