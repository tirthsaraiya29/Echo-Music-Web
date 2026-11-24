# Echo Brain Auto-Injection

## Overview
**Echo Brain Auto-Injection** continuously evaluates user listening momentum and dynamically injects tailored recommendation tracks into the upcoming radio queue during active playback.

## Non-Destructive Queue Guarantee
A paramount requirement of Echo Brain Auto-Injection is that it **NEVER overwrites, modifies, or truncates manually queued songs**:
1. **Queue Separation:**
   - **`upNext` (Manually Queued):** Songs explicitly added by the user via "Play next", "Add to queue", or drag-and-drop.
   - **`radioQueue` (Dynamically Injected):** Ambient continuation and momentum-generated recommendations.
2. **Playback Precedence:**
   - The playback engine strictly evaluates `upNext` first.
   - Auto-injected momentum tracks are inserted only into `radioQueue`.
   - Even if multiple batches of momentum tracks are injected, user-queued tracks remain at the front of the line and play in their exact user-specified order.
3. **De-duplication:**
   - When injecting momentum candidates, any track ID already present in `activeTrack`, `upNext`, `sourceQueue`, or `radioQueue` is filtered out.
4. **Trigger Conditions:**
   - Automatically evaluated when `radioQueue` has $\le 2$ tracks remaining, or upon track completion and skip events.
   - Rate-limited to prevent excessive background evaluations.
   - User preference `echoBrainAutoInject` (default: `true`, configurable in Settings).
