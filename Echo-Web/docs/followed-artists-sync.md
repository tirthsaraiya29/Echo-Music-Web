# Followed Artists Synchronization & New Releases Discovery

## Overview
Echo Music Web implements upstream Android Echo Music parity (`SyncUtils.kt` and `AccountViewModel.kt`) for followed artists and subscriptions.

Followed artists are treated as first-class library entities, preserving their rich metadata (`id`, `name`, `thumbnailUrl`, `subscribers`, `followedAt`, `source`), rather than bare identifier strings.

## Features & Architecture

### 1. First-Class Followed Artist Entities
- `FollowedArtistEntity` schema defined in `src/services/sync/followedArtistsSyncService.ts`.
- Validated with Zod for robust runtime validation and type-safety.
- Stored and persisted in Zustand store (`useEchoStore.ts`) via `followedArtists` and `followedArtistIds`.

### 2. Anti-Wipe Protection
Transient network failures, authentication timeouts, or empty responses from InnerTube `FEmusic_library_corpus_artists` must never wipe a user's locally followed artists.
- When `remoteArtists.length === 0` and `localArtists.length > 0`, reconciliation yields `wipe_prevented`.
- Local collection is preserved intact and `wipesPreventedCount` metric is recorded.
- Only an explicit `allowEmptyRemote: true` allows clearing the collection.

### 3. Additive-Only Merge
When a user has locally followed artists that do not appear in the cloud response (e.g., local-only or pending synchronization), the reconciliation algorithm preserves the local items and appends newly discovered cloud artists (`additive_merge`).

### 4. New Releases Discovery
Followed artists' catalog is inspected (`fetchNewReleasesForFollowedArtists`) to automatically surface new albums, EPs, and singles directly within the library.

### 5. Library UI Integration
- A dedicated **Artists** tab is added to the Library page (`/library?tab=artists`).
- Circular avatar cards with artist name, subscriber counts, and quick follow/unfollow toggle.
- "New Releases from Followed Artists" carousel shelf.
- One-click cloud synchronization button (`Sync Cloud`) with live feedback.
- Displayed under "Followed artists" shelf on the "All" library overview.
