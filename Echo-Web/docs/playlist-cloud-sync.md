# Playlist Cloud Synchronization (FEATURE-044)

## Overview
Echo Music Web implements reliable playlist cloud synchronization and anti-wipe protections matching upstream Android Echo Music (`SyncUtils.kt`). It synchronizes playlist edits with YouTube Music / cloud providers while strictly safeguarding local user edits and preventing transient empty API responses from clearing data.

## Upstream Parity & Architecture
- **Upstream Pattern:** `SyncUtils.kt` lines 1038–1094:
  - **Anti-Wipe Guard:** When a remote endpoint returns an empty track array while local tracks exist, the sync engine treats the empty payload as a transient network/API hiccup, ignores the wipe request, preserves 100% of local tracks, and records a `wipesPreventedCount` metric.
  - **Additive-Only Sync:** When local tracks exist that the remote does not have (`localOnly = localIds - remoteIds`), the engine recognizes local unpropagated edits and performs an additive-only merge, keeping all local songs and appending missing remote tracks.
  - **Full Update:** When the remote has a fully populated list containing all local tracks or reordered tracks, the remote ordering is cleanly adopted.
  - **No-Op Invariant:** When local and remote track IDs match identically in order and count, no unnecessary database or store mutations occur.
- **User Interface (`DetailPages.tsx`):**
  - Interactive "Sync with Cloud" action button in the playlist hero toolbar.
  - Informative toast feedback detailing sync actions and wipe prevention notices.
- **Domain Extensions (`domain.ts`):**
  - Optional `browseId`, `isAutoSync`, `lastSyncedAt`, and `syncError` properties on `Playlist`.

## Telemetry
- `syncAttemptsCount`: Total sync operations initiated.
- `syncSuccessCount`: Successful synchronizations.
- `syncErrorsCount`: Network or API sync errors.
- `wipesPreventedCount`: Instances where empty remote responses were prevented from wiping local playlists.
- `tracksAddedCount`: Cumulative tracks added to playlists via sync.
- `additiveSyncsCount`: Additive-only merges performed.
