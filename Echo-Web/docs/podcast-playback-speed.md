# Podcast Playback Speed [FEATURE-035]

## Overview
Echo Music Web implements independent playback speed control for podcast episodes and spoken audio matching upstream Echo Music's `PodcastProgress.kt`. Users can adjust podcast playback speed (0.75x to 2.0x) with bit-perfect pitch preservation without impacting their music listening experience.

## Architecture

```
Playback Controller / User Interaction (Cycle Speed)
                         │
                         ▼
┌──────────────────────────────────────────────┐
│          podcastSpeedService.ts              │
│  - cyclePodcastSpeed()                       │
│    [0.75, 1.0, 1.25, 1.5, 1.75, 2.0]         │
│  - formatPodcastSpeed() ("1.25x")            │
│  - resolveEffectivePlaybackRate()            │
│  - Telemetry & speed metrics tracker         │
└────────────────┬─────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│           AudioEngine.ts                     │
│  - deckAElement & deckBElement playbackRate  │
│  - preservesPitch: true                      │
│  - Automatically resets rate when            │
│    transitioning from podcast to music       │
└──────────────────────────────────────────────┘
```

## Key Invariants
1. **Separation of Spoken and Musical Audio**: Changing the podcast playback rate does not alter the playback rate for music tracks. When an episode ends and the queue transitions to a music track, the playback rate automatically reverts to 1.0x.
2. **Pitch Preservation**: Unlike musical varispeed (which links pitch to speed), podcast rate changes strictly preserve voice pitch (`preservesPitch = true`), avoiding "chipmunk" or deep distortion.
3. **Control Surfaces**:
   - Desktop Player view: One-click speed chip that cycles through `[0.75x, 1x, 1.25x, 1.5x, 1.75x, 2x]`.
   - Settings page: Dedicated dropdown under Audio Settings to set default podcast speed.
   - Persistence: Saved in `UserPreferences.podcastPlaybackRate`.

## Verification
- Test Suite: `Echo-Web/test/podcast-speed.test.ts`
- Metrics: `speedChanges`, `speedsCycled`
