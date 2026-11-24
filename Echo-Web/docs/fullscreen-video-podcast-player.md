# FEATURE-037: Fullscreen Video Podcast Player

## Overview

Echo Music Web provides a dedicated, responsive fullscreen video player for podcast episodes and video music tracks, matching upstream Echo Music architecture (`PodcastVideoProvider.kt` and `PodcastVideoScreen.kt`).

Upstream Echo Music provides seamless audio-to-video handoff, allowing users to switch between listening to a spoken podcast episode in the audio engine and watching the full landscape video presentation without losing their playback position.

---

## Architectural Parity with Upstream Echo Music

| Upstream Echo Music (Android) | Echo Music Web Implementation | Parity Status |
|--------------------------------|-------------------------------|---------------|
| `PodcastVideoProvider.kt` | `src/services/podcast/podcastVideoService.ts` | Full Parity |
| `PodcastVideoScreen.kt` | `src/components/podcast/PodcastVideoModal.tsx` | Full Parity |
| `VideoTrackOption` (1080p, 720p, 480p, 360p) | `videoTrackOptionSchema` with multi-quality stream resolution | Full Parity |
| Seamless audio-to-video timestamp handoff | Transfers position from `AudioEngine` to video on open | Full Parity |
| Video-to-audio return sync | Resumes `AudioEngine` at video timestamp and updates `db.podcastProgress` | Full Parity |
| Fullscreen orientation / landscape layout | HTML5 Fullscreen API (`requestFullscreen` / `exitFullscreen`) | Full Parity |
| Auto-hiding overlay controls (3.5s timeout) | 3.5s timer with smooth fade out on user inactivity | Full Parity |
| Quality selection menu | Stream resolution picker (1080p HD, 720p, 480p, 360p) | Full Parity |
| Seeking controls (-10s / +10s) | Configurable Skip Backward (-15s) and Forward (+30s) | Extended Parity |
| Desktop & responsive web controls | Transport overlay with volume slider, scrubber, hotkeys | Full Parity |

---

## Stream Resolution & Provider (`src/services/podcast/podcastVideoService.ts`)

- **Track Quality Options (`VideoTrackOption`)**:
  - `1080p HD` (Height: 1080)
  - `720p` (Height: 720)
  - `480p` (Height: 480)
  - `360p` (Height: 360)
- **Title and Host Sanitization**:
  - `cleanSongTitle(raw)`: Cleans official music video labels, remaster tags, and sponsor tags.
  - `cleanArtistName(raw)`: Isolates primary show hosts from guest lists and featuring credits.
- **LRU In-Memory Caching**:
  - Caches stream manifests by `videoId` to eliminate duplicate network resolution passes.
- **Telemetry Instrumentation**:
  - `videoLoadsStarted`, `videoLoadsSucceeded`, `videoLoadsFailed`
  - `fullscreenToggles`, `qualityChanges`, `audioVideoSwitches`

---

## User Interface & Player Overlay (`src/components/podcast/PodcastVideoModal.tsx`)

- **Top Overlay Bar**:
  - Back / Close button (`ArrowLeft`)
  - Episode title and podcast show name
  - Quality selector dropdown (`Settings`)
  - Fullscreen toggle button (`Maximize2` / `Minimize2`)
- **Center Transport Controls**:
  - Skip backward 15s (`RotateCcw`)
  - Play / Pause button with buffering loader (`Play` / `Pause` / `Loader2`)
  - Skip forward 30s (`RotateCw`)
- **Bottom Timeline Bar**:
  - Interactive slider scrubber
  - Time elapsed and total duration indicators
  - Audio mode switcher button (`Headphones`)
  - Volume slider and mute toggle (`Volume2` / `VolumeX`)
- **Keyboard Shortcuts**:
  - `Space`: Toggle play / pause
  - `F`: Toggle HTML5 fullscreen
  - `Escape`: Exit fullscreen or close video modal
  - `Left Arrow` / `J`: Seek backward 15 seconds
  - `Right Arrow` / `L`: Seek forward 30 seconds
