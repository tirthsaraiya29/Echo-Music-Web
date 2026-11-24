# Followed Podcast Library [FEATURE-032]

## Overview
Echo Music Web provides complete parity with upstream Echo Music's followed podcasts library (`PodcastShowStore` and `LibraryPodcastsScreen`), allowing users to follow their favorite podcast shows and keep them segregated from musical playlists.

## Architecture

```
User Action (Follow / Unfollow Show)
            │
            ▼
┌─────────────────────────────────┐
│       useEchoStore.ts           │
│  - followedPodcasts: Show[]     │
│  - followPodcast(show)          │
│  - unfollowPodcast(showId)      │
│  - isPodcastFollowed(showId)    │
│  - Persisted in localStorage    │
└────────────────┬────────────────┘
                 │
                 ├──► PodcastsPage ("Your Followed Shows" Carousel)
                 │
                 ├──► LibraryPage (Dedicated "Podcasts" Tab)
                 │
                 └──► PlaylistPage ("Follow Show" / "Following" Button)
```

## Features
1. **Podcast Segregation**: Followed podcast shows are kept completely separate from ordinary music playlists.
2. **Dedicated Library Tab**: The Library view includes a "Podcasts" category tab displaying all subscribed shows, episode counts, artwork, and an unfollow action.
3. **Show Detail Integration**: When viewing a podcast show (`MPSP...` or `isPodcast`), a prominent "Follow Show" / "Following" button lets users subscribe/unsubscribe in one click.
4. **Podcasts Page Integration**: "Your Followed Shows" appears at the top of `/podcasts`, matching upstream Android's `podcastHome(followed)`.
5. **Persistence & Resilience**: Subscribed shows are persisted in local storage and IndexedDB with state merging on startup.
6. **Telemetry & Metrics**: Tracks total followed shows, follow actions, and unfollow operations.

## Invariants & Compliance
- Strictly avoids song downloads or offline caching of catalog episodes.
- Complies with desktop web layout guidelines with accessible touch/click targets and clear contrast.
