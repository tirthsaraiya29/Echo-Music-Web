# Pause on Mute

## Overview
Echo Music Web includes **Pause on Mute**, an upstream-aligned feature that automatically halts active audio playback whenever the audio output is muted or the master volume is pulled to zero.

## Rationale
When listening to music or podcasts, muting audio or turning volume all the way down typically indicates the listener must divert their attention (e.g., attending a meeting, taking a call, or answering an in-person conversation). Without Pause on Mute, playback would continue silently, causing the user to lose their place in tracks or podcast episodes.

## Architectural Behavior
- **User Preference:** Configured via `pauseOnMute` in `UserPreferences`, validated via Zod (`userPreferencesSchema`), persisted in Zustand, and exposed as a toggle in **Settings > Playback & Audio DSP**. Default: `false`.
- **Trigger Conditions:**
  1. `setMuted(true)` called via UI mute button, keyboard shortcut, or operating system media controls while `playbackState === 'PLAYING'`.
  2. `setVolume(0)` called via volume slider or volume down shortcut while `playbackState === 'PLAYING'`.
  3. `volumechange` event fired on the active HTMLAudioElement with `el.muted === true` or `el.volume === 0` while `playbackState === 'PLAYING'`.
- **State Preservation:**
  - Invokes `AudioEngine.pause()`.
  - Increments `metrics.pauseOnMuteCount` in `AudioEngineMetrics`.
  - Unmuting or restoring volume does NOT automatically force resume, preserving user control and avoiding unexpected bursts of audio.
