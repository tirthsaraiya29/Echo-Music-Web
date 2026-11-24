# Episode Ordering [FEATURE-034]

## Overview
Echo Music Web implements episode ordering and filtering for podcast shows and feeds matching upstream Echo Music's `EpisodeDates.kt`. Listeners can sort episodes chronologically or reverse-chronologically, or filter by played/unplayed status.

## Architecture

```
User Sort / Filter Selection
            │
            ▼
┌──────────────────────────────────────────────┐
│        podcastOrderingService.ts             │
│  - parseEpisodeDate()                        │
│    (relative: "2 days ago", absolute: dates) │
│  - sortPodcastEpisodes()                     │
│    (newest, oldest, shortest, longest, title)│
│  - filterPodcastEpisodes()                   │
│    (all, unplayed, in-progress)              │
│  - Telemetry & metrics tracker               │
└────────────────┬─────────────────────────────┘
                 │
       ┌─────────┴─────────┐
       ▼                   ▼
┌──────────────┐    ┌──────────────┐
│ PodcastsPage │    │ PlaylistPage │
│ (Feed Sort)  │    │ (Show Sort)  │
└──────────────┘    └──────────────┘
```

## Supported Sort Modes
1. **Newest First (Default)**: Reverse chronological sorting. Ideal for news, talk shows, and daily podcasts.
2. **Oldest First**: Chronological sorting. Essential for serialized true-crime investigations, audiobooks, and historical docuseries starting from Episode 1.
3. **Longest First**: Deep-dive episodes ordered by total run duration.
4. **Shortest First**: Quick bites and mini-episodes.
5. **Title (A-Z)**: Alphabetical ordering by episode name.

## Filtering
- **All**: Displays all available episodes.
- **Unplayed**: Filters out completed episodes and episodes with recorded progress.
- **In Progress**: Displays episodes that have been started but not finished.

## Verification
- Test Suite: `Echo-Web/test/podcast-ordering.test.ts`
- Metrics: `sortOperations`, `filterOperations`
