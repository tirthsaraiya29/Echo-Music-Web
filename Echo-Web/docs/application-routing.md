# Application Routing Architecture [SMALL-41]

## Overview
Echo Music Web implements declarative, accessible, and resilient client-side routing using `react-router-dom` v7 with strict Zod parameter validation, error boundaries, navigation coalescing, and assistive technology announcements.

## Route Structure & Parameters
The application defines clean, declarative routes for browse pages, media collections, and detail entities:
- Top-level routes: `/`, `/discover`, `/search`, `/library`, `/liked`, `/recently-played`, `/queue`, `/podcasts`, `/flow`, `/settings`
- Dynamic routes: `/playlists/:playlistId`, `/albums/:albumId`, `/artists/:artistId`
- All route parameters are validated using `routeParamSchema` which rejects path traversal attempts, script tags, control characters, and excess lengths (>128 chars).

## Resiliency & Error Recovery
1. **Route Error Boundary**: Catches component render failures during transitions, displaying an accessible recovery card with a direct retry button.
2. **Dedicated 404 Not Found Page**: Unknown routes render `NotFoundPage` with return-to-home and music-search actions instead of silent redirects.
3. **Redundant Navigation Coalescing**: `NavigationManager` tracks navigation history and suppresses redundant transitions to identical paths.
4. **Accessible Route Announcements**: `RouteAnnouncer` updates an `aria-live="polite"` element on every route change, setting document titles and focusing `#main-content`.

## Telemetry
`getRoutingMetrics()` provides real-time counts for:
- `navigations`
- `redundantNavigationsSkipped`
- `paramValidationFailures`
- `notFoundNavigations`
- `routeErrors`

## Testing
Unit and integration tests are verified in `Echo-Web/test/router.test.ts`.
