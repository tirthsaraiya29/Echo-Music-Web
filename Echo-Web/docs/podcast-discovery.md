# Podcast Discovery [FEATURE-031]

## Overview
Echo Music Web provides complete podcast discovery parity with upstream Echo Music, allowing desktop users to explore, search, and stream podcasts and spoken-word episodes from YouTube Music without needing a native mobile client.

## Architecture

```
User Query / Category Select
            │
            ▼
┌─────────────────────────────────┐
│     PodcastsPage View           │
│  - Category Filter Chips        │
│  - Real-time Search Input       │
│  - Filter Tabs (All/Ep/Shows)   │
│  - Resume Listening Carousel    │
│  - Trending Shows Shelf         │
│  - Episode Play Cards           │
└────────────────┬────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│       podcastDiscoveryService.ts             │
│  - Category definitions (12 categories)      │
│  - LRU query caching (TTL 10 min)            │
│  - extractPodcastShowsAndEpisodes()          │
│  - discoverPodcasts() & searchPodcasts()     │
│  - Telemetry & metrics tracker               │
└────────────────┬─────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│            InnerTubeClient                   │
│  - Filter: 'podcasts'                        │
│  - parser.ts: MPSP... & EPISODE detection   │
└──────────────────────────────────────────────┘
```

## Features
1. **Curated Categories**: 12 curated topics matching YouTube Music (All, Technology, True Crime, Comedy, News & Politics, Science & Nature, Business & Finance, Society & Culture, Sports, Health & Wellness, Music & Arts, History & Education).
2. **Dedicated Search**: Interactive search input targeting podcasts, shows, and episodes directly.
3. **Trending & Featured Shows**: Displays popular shows (Huberman Lab, The Daily, Lex Fridman, Radiolab, SmartLess, Darknet Diaries) with hosts and episode counts.
4. **Shows and Episodes View Switching**: Toggle between "All", "Episodes", and "Shows" view modes.
5. **InnerTube Integration**: Automatic parsing of `MPSP...` playlist browse IDs and `MUSIC_VIDEO_TYPE_PODCAST_EPISODE` into structured `PodcastShow` and `Track` (with `isPodcast: true`).
6. **Telemetry & Caching**: Cache queries for fast back/forward navigation and track query metrics.

## Invariants & Compliance
- Complies strictly with the desktop web mandate: audio and video podcast streaming is web-native.
- No offline catalog downloads: playback uses streaming via the dual-deck Web Audio / HTML5 audio engine.
