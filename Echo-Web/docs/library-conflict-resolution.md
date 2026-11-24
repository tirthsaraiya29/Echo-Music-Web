# Library Conflict Resolution

## Overview
Echo Music Web implements deterministic, CRDT-inspired conflict resolution for concurrent playlist edits, additions, and deletions across browser sessions, devices, and cloud sync providers.

## Conflict Resolution Rules

### 1. Additive Track-List Reconciliation
When concurrent additions happen on different devices without having synchronized (e.g., Device A adds Track 2 while Device B adds Track 3 to the same playlist):
- A standard last-write-wins algorithm would silently overwrite and discard additions made on one of the devices.
- Echo Music Web performs a deterministic track union merge, preserving all added tracks and maintaining track order.
- Action: `merge_tracks`.

### 2. Last-Write-Wins (LWW) for Metadata
When playlist metadata (title, description) is edited concurrently:
- Vector revisions (`revision`) and timestamps (`updatedAt`) are evaluated.
- The higher revision or later timestamp wins deterministically.
- Action: `accept_remote` or `keep_local`.

### 3. Tombstone-Based Deletion Tracking
- Deleting a playlist writes a tombstone entry into `playlistTombstones` with `Date.now()`.
- If a remote device broadcasts an older snapshot containing the deleted playlist (`localTombstone >= remote.updatedAt`), the deletion wins and the playlist is purged from the incoming state (`delete_tombstone`).
- If an edit occurred *after* the deletion (`remote.updatedAt > localTombstone + clockSkew`), the playlist is resurrected (`resurrect`) to prevent accidental loss of user work.

### 4. Automatic Tombstone Garbage Collection
- Tombstones older than 30 days (`TOMBSTONE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000`) are automatically pruned during reconciliation to keep persistent storage minimal.
