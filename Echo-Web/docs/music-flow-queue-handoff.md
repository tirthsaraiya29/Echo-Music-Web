# Music Flow Queue Handoff & Ownership Protection

## Overview
When entering **Music Flow**, playback is handed off to the continuous discovery feed. Upstream Music Flow provides two essential guarantees:
1. The user's active playback queue prior to entering Flow is preserved in a cryptographic ownership snapshot.
2. When exiting Flow, previous queue restoration occurs **only if ownership remains valid**. If the user or an external process modified the queue in the meantime, the current queue is safely retained without destructive overwrites.

## Handoff Lifecycle
1. **Entering Flow (`enterFlow`):**
   - Generates an ownership lease token: `flow_<timestamp>_<random>`.
   - Snapshots current playback state and queues (source queue, upNext, playback position) stamped with the token.
   - Takes queue ownership: `engine.takeQueueOwnership('music-flow', token)`.
   - Sets `handoffStatus = 'active'`.
2. **During Flow:**
   - Any manual user intervention (e.g., adding to queue, playing a song via search, or reordering) automatically revokes the ownership lease in `QueueManager` with reason `'USER_OVERRIDE'`.
3. **Exiting Flow (`exitFlow`):**
   - **Keep this mix (`restoreQueue = false`):**
     - Retains the Flow discovery queue.
     - Sets `handoffStatus = 'kept'`.
     - Revokes ownership with reason `'USER_KEPT_MIX'`.
   - **Restore previous queue (`restoreQueue = true`):**
     - Checks `engine.isQueueOwnershipValid(ownershipToken)`.
     - **If valid:** Restores previous queue snapshot, resumes playback, sets `handoffStatus = 'restored'`, and increments `restoresSucceededCount`.
     - **If revoked:** Aborts restore, preserves current queue, sets `handoffStatus = 'revoked'`, and increments `restoresBlockedCount`.
