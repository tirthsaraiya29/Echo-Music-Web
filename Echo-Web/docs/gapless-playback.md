# Gapless Playback Implementation (FEATURE-012)

## Architectural Design

Echo Web achieves continuous, zero-silence gapless audio playback across sequential catalog tracks using its hardware Web Audio dual-deck architecture (`DeckController`, `AudioEngine`, `QueueManager`).

### Problem Statement
Standard single-element audio players incur a 300ms to 1200ms silence gap between tracks due to:
1. `ended` event propagation.
2. Network metadata resolution and URL extraction.
3. Media resource allocation and HTTP Range buffering.
4. Audio output device reinitialization and pipeline latency.

### Dual-Deck Zero-Latency Handoff
Echo Web resolves this by maintaining two synchronized HTML5 audio elements (`deckA` and `deckB`) routed through independent Web Audio `GainNode` channels:

1. **Prebuffering Standby Deck**:
   - The secondary deck (`standbyDeck`) resolves the upcoming track URL and initiates buffering in advance (`prebufferWindowMs`, default 15s before track completion).
   - The element enters `HAVE_CURRENT_DATA` / `HAVE_ENOUGH_DATA` (readyState >= 2) while Deck A is still playing.

2. **Atomic Gapless Transition (`transitionGapless`)**:
   - When the active track reaches completion or `crossfadeDuration == 0`, `DeckController` detects if `gaplessPlaybackEnabled` is active and standby track is ready.
   - `standbyEl.currentTime = 0; await standbyEl.play()` fires synchronously.
   - To prevent audible DC offset pops or speaker clicks caused by sudden digital step functions, a 5 millisecond micro-ramp is scheduled in the Web Audio context:
     ```ts
     fromGain.gain.setValueAtTime(1.0, now)
     fromGain.gain.linearRampToValueAtTime(0.0, now + 0.005)
     toGain.gain.setValueAtTime(0.0, now)
     toGain.gain.linearRampToValueAtTime(1.0, now + 0.005)
     ```
   - Previous media element is released to reclaim decoder resources.

3. **Queue Promotion and State Commitment**:
   - `AudioEngine.onGaplessTransition` commits the queue cursor atomically:
     ```ts
     this.queueManager.promoteStandbyTrack(standbyTrack)
     this.queueManager.commitPromotion()
     this.queueManager.setActiveDeck(toDeck)
     ```
   - Media Session metadata and UI state update synchronously without triggering a re-render blink.
   - Prebuffering for the subsequent track in the queue is scheduled immediately.

4. **Telemetry & Diagnostics**:
   - `DeckController.getMetrics().gaplessTransitions` tracks total successful gapless transitions.
   - User configuration in `SettingsPage` allows toggling gapless playback (`gaplessPlayback` preference, default: `true`).
