# Music Flow Vertical Reel

## Overview
**Music Flow** is a full-screen, vertical discovery reel inspired by modern discovery feeds (e.g. TikTok, YouTube Shorts, Reels) specifically tailored for music exploration.

## Core Capabilities
1. **Vertical Reel Presentation:**
   - Fullscreen takeover layout with blurred ambient backdrop reflecting active track artwork.
   - Vertically swipeable and scrollable card carousel with previous and next track peeks.
   - Interactive progress bar, play/pause controls, like action, and mute toggle.
   - All interactive touch targets are strictly $\ge 44$px by $44$px for desktop accessibility.
2. **Gesture & Keyboard Controls:**
   - **Swipe / Wheel:** Mouse wheel and touch swipe up/down navigates between tracks with debouncing to prevent audio deck thrashing.
   - **Keyboard Shortcuts:**
     - `ArrowDown` / `j`: Next track in reel.
     - `ArrowUp` / `k`: Previous track in reel.
     - `Space`: Toggle play / pause.
     - `l` / `L`: Toggle like for currently focused track.
     - `m` / `M`: Toggle mute.
     - `Escape`: Exit Flow takeover and return.
3. **Shared Audio Player Integration:**
   - Unlike separate video feeds, Music Flow shares the core `AudioEngine` and Zustand playback pipeline.
   - Leaving Flow provides two clean exit paths:
     - **Keep this mix:** Persists the current Flow discovery queue and continues listening.
     - **Exit Flow:** Reverts to the queue snapshot captured prior to entering Flow.
4. **Infinite Feed & Telemetry:**
   - Proactive prebuffering when reaching within 3 tracks of the feed end.
   - Telemetry tracks `swipesCount`, `tracksListenedCount`, `likesCount`, `skipsCount`, and `feedsGeneratedCount` validated with Zod.
