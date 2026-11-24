# Continue Listening [FEATURE-033]

## Overview
Echo Music Web implements full feature parity with upstream Echo Music's `PodcastProgress.kt`, automatically persisting episode listening progress to IndexedDB, calculating remaining time and played fractions, and seamlessly resuming playback from the last-listened position across sessions and devices.

## Architecture

```
Playback Time Update (Dual Deck AudioEngine)
                 │
                 ▼ (Throttled 5s)
┌─────────────────────────────────┐
│     AudioEngine.ts              │
│  - isPodcast evaluation         │
│  - isNearEnd calculation        │
│  - recordPodcastProgressMetric  │
└────────────────┬────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│       echoDatabase (IndexedDB)               │
│  - Table: podcastProgress                    │
│  - Fields: episodeId, positionMs, durationMs,│
│    completed, dismissed, updatedAt           │
└────────────────┬─────────────────────────────┘
                 │
      ┌──────────┴──────────┐
      ▼                     ▼
┌─────────────────┐   ┌───────────────────────────┐
│ PodcastsPage    │   │ LibraryPage (PodcastsTab) │
│ - Continue      │   │ - Continue Listening Row  │
│   Listening     │   │ - Progress % Bar          │
│   Shelf         │   │ - Time Left Formatting    │
│ - Dismiss X     │   │ - One-click Resume Play   │
└─────────────────┘   └───────────────────────────┘
```

## Key Invariants
1. **Resume Threshold**: Positions under 5 seconds start from the beginning.
2. **Completion Window (`isNearEnd`)**: Closer than 5% of duration or within 1 to 3 minutes of the end is treated as finished, clearing progress so subsequent replays begin from 0.
3. **Dismissal**: Dismissing an episode hides it from Continue Listening carousels while preserving history.
4. **Resilience**: IndexedDB persistence ensures playback resume points survive full page refreshes, tab closures, and browser restarts.

## Verification
- Test Suite: `Echo-Web/test/continue-listening.test.ts`
- Metrics: `resumesTriggered`, `progressSaved`, `episodesCompleted`, `episodesDismissed`
