# FEATURE-038: Podcast Queue & Segregation

## Overview

Echo Music Web provides segregated podcast episode queueing and next-episode show sequencing, matching the upstream Echo Music Android architecture (`YouTubeQueue.kt` and `MediaLibrarySessionCallback.kt`).

Upstream Echo Music enforces a strict design principle for spoken-word audio:
> *"Started from an episode: YouTube's radio mixes in music, which must not follow it."*
> `val songs = if (isEpisodeRadio) filtered.filter { it.isPodcastEpisode } else filtered`
> *"Its show is known: the service queues the show's next episode instead of a radio."*

Echo Music Web implements this exact policy, ensuring that when an episode is playing, auto-continuation and radio queues never mix music tracks into the podcast listening session, and that episodes of the same show sequence naturally in uninterrupted order.

---

## Architectural Parity with Upstream Echo Music

| Upstream Echo Music (Android) | Echo Music Web Implementation | Parity Status |
|--------------------------------|-------------------------------|---------------|
| `isEpisodeRadio = currentItem?.isPodcastEpisode == true` | `isPodcastTrack(activeTrack)` in `QueueManager` & `AudioEngine` | Full Parity |
| `val songs = if (isEpisodeRadio) filtered.filter { it.isPodcastEpisode } else filtered` | `filterSpokenAudioTracks()` purges non-podcast items from `addRadioTracks` | Full Parity |
| Show group queueing (`MediaLibrarySessionCallback.kt`) | `buildPodcastEpisodeQueue()` & `findNextShowEpisode()` | Full Parity |
| Disallow music radio mixed into spoken audio | Strict spoken-audio queue segregation policy | Full Parity |
| Up next queue display | Dedicated banner in `QueuePage` informing user of active podcast segregation | Full Parity |
| Audio engine action | `queuePodcastEpisodes(episodes, playFirst)` | Extended Feature |

---

## Queue Management Architecture (`src/services/podcast/podcastQueueService.ts`)

### Configuration Schema (`PodcastQueuePolicy`)
```typescript
export const podcastQueuePolicySchema = z.object({
  segregateSpokenAudio: z.boolean().default(true),
  autoQueueNextEpisode: z.boolean().default(true),
  disallowMusicRadioContinuation: z.boolean().default(true),
})
```

### Core Logic
1. **`isPodcastTrack(track)`**: Detects whether a track is spoken audio via `isPodcast`, `showTitle`, or podcast album categorization.
2. **`filterSpokenAudioTracks(tracks, activeIsPodcast)`**:
   - If active track is music, retains all items.
   - If active track is podcast, separates podcast episodes from music tracks, rejecting music from entering the radio continuation queue.
3. **`findNextShowEpisode(currentEpisode, availableEpisodes)`**:
   - Sequences to the next episode in chronological or publication order.
4. **`buildPodcastEpisodeQueue(currentEpisode, showEpisodes, startIndex)`**:
   - Pre-queues the remaining episodes of a show.

### Telemetry Tracking (`PodcastQueueMetrics`)
- `episodesQueuedCount`: Total podcast episodes queued.
- `musicTracksFilteredCount`: Cumulative count of music tracks prevented from polluting the podcast queue.
- `nextEpisodesAutoQueued`: Number of sequential show episodes auto-queued.
- `queueSegregationEnforcements`: Total times spoken audio segregation was enforced.

---

## UI Integration

- **`QueuePage` (`src/pages/CollectionPages.tsx`)**:
  - Displays a high-visibility badge when `currentTrack?.isPodcast`:
    *"Podcast Episode Queue Active — Spoken audio episodes are strictly segregated from music radio continuation to ensure uninterrupted listening."*
- **`AudioEngine` & `useAudioEngine`**:
  - Provides `queuePodcastEpisodes(episodes, playFirst)` for show detail pages and podcast libraries.
