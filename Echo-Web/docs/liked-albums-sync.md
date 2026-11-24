# Liked Albums Synchronization & Anti-Wipe Protection

## Overview
Echo Music Web implements upstream Android Echo Music parity (`SyncUtils.kt` and `AccountViewModel.kt`) for saved/liked albums.

Albums are treated as first-class library entities, preserving their rich metadata (`id`, `title`, `artistName`, `artistId`, `year`, `coverUrl`, `trackCount`, `likedAt`, `source`), rather than bare identifier strings.

## Features & Architecture

### 1. First-Class Liked Album Entities
- `LikedAlbumEntity` schema defined in `src/services/sync/likedAlbumsSyncService.ts`.
- Validated with Zod for robust runtime validation and type-safety.
- Stored and persisted in Zustand store (`useEchoStore.ts`) via `likedAlbums` and `likedAlbumIds`.

### 2. Anti-Wipe Protection
Transient network failures, authentication timeouts, or empty browse responses from InnerTube `FEmusic_liked_albums` must never wipe a user's locally liked albums.
- When `remoteAlbums.length === 0` and `localAlbums.length > 0`, reconciliation yields `wipe_prevented`.
- Local collection is preserved intact and `wipesPreventedCount` metric is recorded.
- Only an explicit `allowEmptyRemote: true` allows clearing the collection.

### 3. Additive-Only Merge
When a user has locally liked albums that do not appear in the cloud response (e.g., local-only or pending synchronization), the reconciliation algorithm preserves the local items and appends newly discovered cloud albums (`additive_merge`).

### 4. Library UI Integration
- A dedicated **Albums** tab is added to the Library page (`/library?tab=albums`).
- Shows saved albums in responsive grid or list layout.
- One-click cloud synchronization button (`Sync Cloud`) with live feedback.
- Quick remove/unlike button and hover interactions.
- Displayed under "Saved albums" shelf on the "All" library overview.
