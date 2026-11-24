# Correct Crossfade Promotion

## Overview
Echo Music Web provides robust dual-deck crossfade promotion matching upstream Echo Music audio engine architecture. When transitioning between tracks via equal-power crossfades, the incoming standby track is promoted atomically, and only permanently committed to the logical queue once the crossfade succeeds.

## Promotion Lifecycle & Invariants

### 1. Atomic Cursor Promotion
- When `crossfadeToStandby()` initiates playback on the standby deck, `QueueManager.promoteStandbyTrack(standbyTrack)` prepares an atomic snapshot containing full queue state and a dedicated rollback closure.
- Queue manager marks `hasPendingPromotion() = true`.
- If the standby track came from user-queued items (`upNext`), it is shifted out of `upNext` and the outgoing active track is appended to `historyList` without duplicate insertions.

### 2. Success Commitment
- When the crossfade completes (`onCrossfadeComplete`), `QueueManager.commitPromotion()` finalizes the promotion.
- `DeckController.metrics.crossfadeSuccesses` is incremented.
- The rollback snapshot is cleanly discarded (`crossfadeRollback = null`).

### 3. Fault & Cancellation Rollback
- If the incoming deck fails to start (`onCrossfadeFailed`), the rollback closure executes immediately, restoring original queue position, current track, and history.
- If user interactions interrupt an in-flight crossfade (`pause()`, `seek()`, `next()`, `previous()`, or `loadTrack()`), `cancelCrossfade()` halts deck volume ramps, releases the standby element, invokes `onCrossfadeCancelled`, and triggers safe rollback to avoid double-advancement or orphaned track cursors.
