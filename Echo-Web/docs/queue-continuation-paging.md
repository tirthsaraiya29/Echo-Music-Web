# Queue Continuation Paging (FEATURE-015)

## Architectural Design

Echo Web implements structured, persistent pagination for auto-radio continuation queues across `QueueManager` and `AudioEngine`.

### Background
When a user listens to music with auto-radio enabled, Echo dynamically resolves upcoming recommendation seeds from InnerTube's radio service (`/api/radio/continuation`).
Previously, the engine discarded pagination metadata and only performed an initial request using `videoId`. As playback progressed, continuation state was lost, preventing deep radio paging and causing context loss across session snapshots.

### Continuation Paging Lifecycle

1. **Paging State (`ContinuationPagingState`)**:
   Tracks the active continuation cursor:
   ```ts
   export interface ContinuationPagingState {
     continuationToken: string | null
     pageIndex: number
     hasMore: boolean
     lastFetchedAt: number | null
   }
   ```

2. **Sequential Multi-Page Ingestion (`addRadioTracks`)**:
   - Page 1 is initiated using `videoId` or catalog seed ID.
   - The response delivers recommendation tracks along with a `continuationToken`.
   - `QueueManager.addRadioTracks(tracks, nextToken)`:
     - Deduplicates tracks against active track, `upNext`, `sourceQueue`, and existing `radioQueue`.
     - Appends unique tracks to `radioQueue`.
     - Advances `pageIndex` and stores the next `continuationToken`.
     - Updates `hasMore = Boolean(nextToken)`.

3. **Autonomous Deep Paging (`checkAutoRadio`)**:
   - When `upNext` is empty and `radioQueue` drops below 3 tracks, `checkAutoRadio` evaluates `continuationState.hasMore`.
   - If a `continuationToken` exists, the subsequent fetch query utilizes:
     `/api/radio/continuation?continuation=${token}&gl=${region}&explicit=${explicit}`
   - If no continuation token exists or continuation ends, paging terminates gracefully.

4. **Snapshot & State Preservation**:
   - `QueueSnapshot` includes `continuationState`.
   - Temporary takeovers (such as Music Flow) and session restores preserve the exact radio pagination page and tokens.
   - Starting a new playlist or album (`setSourceQueue`) or clearing the radio queue cleanly resets continuation state to initial defaults.
