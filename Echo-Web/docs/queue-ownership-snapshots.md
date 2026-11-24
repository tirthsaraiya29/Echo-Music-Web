# Queue Ownership Snapshots (FEATURE-014)

## Architectural Design

Echo Web implements guarded queue ownership snapshots across its audio engine (`QueueManager`, `AudioEngine`, `musicFlowService`).

### Problem Statement
When ephemeral playback experiences (such as Music Flow vertical discovery, audio preview dialogs, or guest listening takeovers) temporarily commandeer the audio player, they capture a `QueueSnapshot` to restore prior state upon exit.

However, in multi-route single-page applications, users may interact with search, artist discographies, or album collections during the takeover session. Without strict queue ownership validation:
- When the temporary feature exits, it blindly restores the stale snapshot, overwriting the user's newly selected album or playlist.
- Uncoordinated components cause queue racing and unexpected playback context rewinds.

### Ownership Model & Guarantees

1. **Tokenized Ownership Registration (`takeOwnership`)**:
   - When a feature initiates playback takeover, it registers an ownership lease:
     ```ts
     const token = engine.takeQueueOwnership('music-flow')
     const snapshot = engine.snapshotQueue('music-flow', token)
     ```
   - The queue registers `currentOwner` and `currentOwnerToken`.

2. **Snapshot Stamping (`snapshotQueue`)**:
   - The generated `QueueSnapshot` contains:
     - `owner`: Identifier of the claiming feature (e.g. `'music-flow'`).
     - `ownerToken`: Unique cryptographic/temporal lease string.
     - Complete queue projection: `history`, `currentTrack`, `upNext`, `sourceQueue`, `radioQueue`, `currentTime`, `currentSourceIndex`, etc.

3. **Autonomous Invalidation on User Override**:
   - Any external queue mutation (`setSourceQueue`, `playQueue`, `playTrack`) automatically invokes `revokeOwnership(reason)` on `QueueManager`.
   - The current token is invalidated, marking the ownership lease as expired.

4. **Guarded Restoration (`restoreQueue`)**:
   - When the feature exits and requests restoration:
     ```ts
     const restored = await engine.restoreQueue(snapshot, true, { ownerToken })
     ```
   - `QueueManager` evaluates `isOwnershipValid(ownerToken)`.
   - **If Ownership is Valid**: The pre-takeover queue is restored with exact cursors, time offsets, and decks.
   - **If Ownership was Revoked**: Restoration is safely blocked (`ownershipViolationsBlocked` metric incremented), returning `false` / `null`, ensuring the user's active playback is preserved undisturbed.
   - **Forced Override**: An explicit `{ force: true }` option permits administrative or emergency restorations when necessary.
