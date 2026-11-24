# FEATURE-036: Podcast Skip Controls

## Overview

Echo Music Web provides dedicated, configurable skip controls for spoken-word audio (podcasts), matching the upstream Echo Music Android architecture (`PodcastProgress.kt`, `MediaLibrarySessionCallback.kt`, and `Thumbnail.kt`).

Upstream Echo Music designates distinct seek behavior for podcasts:
- `SKIP_BACK_MS = 15_000L` (-15 seconds rewind)
- `SKIP_FORWARD_MS = 30_000L` (+30 seconds fast-forward)
- `MediaSessionConstants.ACTION_EPISODE_SKIP_BACK` and `ACTION_EPISODE_SKIP_FORWARD`

Echo Music Web extends this upstream parity with user-configurable seek durations, automatic intro skip, outro skip, MediaSession integration, and keyboard shortcuts.

---

## Architectural Parity with Upstream Echo Music

| Upstream Echo Music (Android) | Echo Music Web Implementation | Parity Status |
|--------------------------------|-------------------------------|---------------|
| `PodcastProgress.SKIP_BACK_MS = 15_000L` | `UPSTREAM_SKIP_BACK_MS = 15_000` (Default 15s) | Full Parity |
| `PodcastProgress.SKIP_FORWARD_MS = 30_000L` | `UPSTREAM_SKIP_FORWARD_MS = 30_000` (Default 30s) | Full Parity |
| `ACTION_EPISODE_SKIP_BACK` | `MediaSession` `seekbackward` callback + `skipPodcastBackward()` | Full Parity |
| `ACTION_EPISODE_SKIP_FORWARD` | `MediaSession` `seekforward` callback + `skipPodcastForward()` | Full Parity |
| Hardcoded seek increments | Configurable presets: 5s, 10s, 15s, 30s, 45s, 60s, 90s | Extended Feature |
| Manual intro/sponsor skipping | Configurable Intro Skip (0s to 120s) at episode start | Extended Feature |
| Manual outro/credits skipping | Configurable Outro Skip (0s to 90s) advancing to next episode | Extended Feature |
| Hardcoded touch targets | Responsive desktop player & mini player with badge icons | Full Parity |
| System media controls | MediaSession `seekbackward` & `seekforward` action handlers | Full Parity |

---

## Service Architecture (`src/services/podcast/podcastSkipService.ts`)

### Configuration Schema (`PodcastSkipConfig`)
```typescript
export const podcastSkipConfigSchema = z.object({
  skipBackwardSeconds: z.number().int().min(5).max(120).default(15),
  skipForwardSeconds: z.number().int().min(5).max(120).default(30),
  introSkipSeconds: z.number().int().min(0).max(300).default(0),
  outroSkipSeconds: z.number().int().min(0).max(300).default(0),
})
```

### Mathematical Utilities
- `calculateSkipBackward(currentPosition, skipSeconds)`: Computes backward seek position clamped to zero.
- `calculateSkipForward(currentPosition, duration, skipSeconds)`: Computes forward seek position clamped to track duration.
- `shouldApplyIntroSkip(position, introSkipSeconds, duration)`: Identifies cold-start playback and jumps past introductory theme/sponsorships.
- `shouldApplyOutroSkip(position, duration, outroSkipSeconds)`: Identifies when episode is inside the outro window to transition to next episode.

### Telemetry Tracking (`PodcastSkipMetrics`)
- `skipBackwardCount`: Total user backward skip events.
- `skipForwardCount`: Total user forward skip events.
- `introSkipCount`: Total automated intro skip executions.
- `outroSkipCount`: Total automated outro skip transitions.
- `totalSecondsSkipped`: Cumulative playback seconds skipped.

---

## User Interface Integration

1. **Desktop Player (`DesktopPlayerView.tsx`)**:
   - When playing a podcast (`currentTrack?.isPodcast`), the transport controls display dedicated `-15s` (`RotateCcw`) and `+30s` (`RotateCw`) buttons with duration badges.
   - Hotkeys: `J` / `Left Arrow` rewinds by configured interval; `L` / `Right Arrow` advances by configured interval.
2. **Mini Player (`Layout.tsx`)**:
   - The persistent bottom player bar displays `-15s` and `+30s` jump controls when podcast audio is active.
3. **Settings (`SettingsPage.tsx`)**:
   - Under `Playback & Audio DSP`, four preferences are exposed:
     - *Podcast skip backward interval*: `5s`, `10s`, `15s` (Default), `30s`, `45s`, `60s`.
     - *Podcast skip forward interval*: `10s`, `15s`, `30s` (Default), `45s`, `60s`, `90s`.
     - *Podcast intro skip*: `Off` (Default), `15s`, `30s`, `45s`, `60s`, `90s`, `120s`.
     - *Podcast outro skip*: `Off` (Default), `15s`, `30s`, `45s`, `60s`, `90s`.
4. **MediaSession (`MediaSession.ts` & `AudioEngine.ts`)**:
   - Intercepts system media key seek events to skip using the user-defined backward and forward intervals.
