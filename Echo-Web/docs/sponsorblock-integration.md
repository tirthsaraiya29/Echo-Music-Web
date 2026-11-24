# SponsorBlock Integration Architecture and Lifecycle

## Overview
Echo Music Web incorporates SponsorBlock to detect and automatically skip non-music segments, intros, outros, and promotional segments:
- **AudioEngine Wiring:** The `SponsorBlock` engine instance attaches to the player's playback loop via `attachPlayer(getCurrentTime, onSeek)`.
- **Skip Mechanics:** When current playback enters a detected segment range $[start, end - 0.05)$, the player seeks forward to $end + 0.05\text{s}$ (with a +0.05s buffer to prevent oscillation/stutter loops) and emits a `segmentSkip` event.
- **Deduplication & Polling:** Polling runs at 250ms intervals while playing. Once skipped, a segment's UUID is marked as skipped to prevent repeated seeks if the user manually scrubs back.

## API Contracts
### `GET /api/sponsorblock/:videoId`
- **Parameter:** `videoId` (validated as 11 alphanumeric characters `^[a-zA-Z0-9_-]{11}$`).
- **Response:**
  ```json
  [
    {
      "category": "music_offtopic",
      "start": 0.0,
      "end": 14.5,
      "uuid": "segment-uuid-1"
    }
  ]
  ```
- **Upstream Handling:** Queries Ajay's public SponsorBlock API (`https://sponsor.ajay.app`) with a 4000ms timeout. If upstream returns 404 or fails, returns an empty array `[]` cleanly without breaking playback.

## Client Guarantees & Lifecycle
1. **LRU Caching & In-Flight Coalescing:** Segments are cached in an LRU map (up to 100 entries). Multiple simultaneous requests for the same `videoId` coalesce to a single in-flight Promise.
2. **Cancellation & Lifecycle:** When switching tracks, in-flight HTTP requests for previous tracks are aborted via `AbortController`. `destroy()` clears all intervals, in-flight promises, and cached references.
3. **Telemetry:** Monitored metrics track `segmentsLoaded`, `segmentsSkipped`, `cacheHits`, `cacheMisses`, `fetchErrors`, and `cancellations`.
