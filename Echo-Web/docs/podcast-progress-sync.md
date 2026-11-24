# FEATURE-039: Podcast Progress Sync

## Overview

Echo Music Web provides real-time cross-tab and cross-device synchronization of podcast episode listening progress, matching upstream Echo Music architecture (`PodcastProgress.kt`).

Upstream Echo Music synchronizes listening state across local and remote sources:
- `REMOTE_PLAYED_PERCENT = 95`: Progress equal to or above 95% permanently counts an episode as completed.
- `REMOTE_AHEAD_MARGIN_MS = 60_000L`: Remote listening progress is coarse; only a clear lead of over 60 seconds supersedes local positions.
- Local completed episodes are protected and never reverted by stale remote states.

Echo Music Web extends this architecture with browser-native real-time `BroadcastChannel` synchronization, IndexedDB multi-tab coordination, and cross-device export/import capabilities.

---

## Architectural Parity with Upstream Echo Music

| Upstream Echo Music (Android) | Echo Music Web Implementation | Parity Status |
|--------------------------------|-------------------------------|---------------|
| `PodcastProgress.kt` | `src/services/podcast/podcastProgressSyncService.ts` | Full Parity |
| `REMOTE_PLAYED_PERCENT = 95` | `REMOTE_PLAYED_PERCENT = 95` (95% completion threshold) | Full Parity |
| `REMOTE_AHEAD_MARGIN_MS = 60_000L` | `REMOTE_AHEAD_MARGIN_MS = 60_000` (60s lead required) | Full Parity |
| `mergeRemote(episode: SongItem)` | `mergeRemoteProgress(existing, remote)` | Full Parity |
| DataStore / SQLite sync | IndexedDB (`db.podcastProgress`) + Dexie transactions | Full Parity |
| Multi-process sync | `BroadcastChannel('echo_podcast_progress_sync')` | Full Parity |
| Stale state fallback | Storage event cross-tab synchronization | Full Parity |
| Cross-device backup | JSON export & import with conflict resolution | Extended Feature |

---

## Service Architecture (`src/services/podcast/podcastProgressSyncService.ts`)

### Real-Time Cross-Tab Synchronizer (`PodcastProgressSynchronizer`)
- Initializes a dedicated `BroadcastChannel('echo_podcast_progress_sync')` with `localStorage` storage-event fallback.
- Dispatches `PROGRESS_UPDATE` events whenever `AudioEngine` commits throttled progress.
- Peer tabs update their local IndexedDB database and trigger subscriber callbacks to refresh UI shelves without manual page reloads.

### Remote YouTube Progress Merging (`mergeRemoteProgress`)
1. **Fresh Episodes**: Initializes a local progress record if remote progress exists.
2. **Completed Guard**: If local is already `completed: true`, remote progress will never un-complete it.
3. **Lead Requirement**: Requires `positionMs > existing.positionMs + 60_000` to prevent jitter or coarse percentages from rewinding high-precision local playback timestamps.

### Cross-Device Data Portability
- **`exportPodcastProgress()`**: Exports versioned schema payload of all progress records.
- **`importPodcastProgress(payload, strategy)`**: Imports progress records with `'newest'` timestamp or `'remote_ahead'` conflict resolution.

### Telemetry Tracking (`ProgressSyncMetrics`)
- `broadcastsSent`: Outgoing tab synchronization events.
- `broadcastsReceived`: Incoming peer synchronization events.
- `remoteProgressMerged`: Remote YouTube progress merges.
- `conflictsResolved`: Discrepancies resolved via lead margins.
- `exportsGenerated`: Progress export payloads generated.
- `importsProcessed`: Cross-device records successfully imported.
