# Progressive Web App (PWA) & Service Worker Architecture [SMALL-40]

## Overview
Echo Music Web implements a robust Progressive Web Application (PWA) framework designed for desktop browser environments. It ensures responsive user interactions, manifest integrity, online/offline status detection, and graceful application updates without disrupting active playback or caching media files.

## Architecture Principles
1. **Zero Media Caching**: In accordance with open licensing and legal requirements, audio streams and catalog tracks are never cached in persistent service worker caches.
2. **App Shell & Static Asset Caching**: Application code, styles, icons, and fonts are versioned and managed for quick loading.
3. **Explicit Update Lifecycle**: When a new service worker installation completes, `waitingUpdate` transitions to `true`. Users are presented with an accessible update banner to reload and activate the new version at their convenience.
4. **Online / Offline Awareness**: The application subscribes to window online/offline events, notifying reactive stores and components while tracking telemetry metrics.

## Schemas & Validation
All PWA structures are validated using strict Zod schemas in `src/services/pwa/pwaTypes.ts`:
- `pwaIconSchema`: Validates icon paths, dimensions, MIME types, and purpose.
- `pwaManifestSchema`: Validates name, short name, theme colors (strict hex format), scope, start URL, and icon sets.
- `swStatusSchema`: Enforces runtime type safety for registration state, waiting workers, scope, and network connectivity.
- `pwaMetricsSchema`: Telemetry tracking for registrations, detected updates, applied updates, cache invalidations, and network transitions.

## Verification
- Unit test suite: `Echo-Web/test/pwa.test.ts`
- Verifies manifest schema validation, runtime status reporting, observer subscriptions, and fallback behavior in non-browser environments.
