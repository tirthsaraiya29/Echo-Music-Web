# Daily Taste Mix Architecture

## Overview
The **Daily Taste Mix** provides an on-device, algorithmically curated daily playlist tailored to each user's listening habits. Operating entirely on-device through the Local Taste Engine and Dexie database, it respects user privacy while delivering high-quality personalization without tracking accounts or third-party servers.

## Key Capabilities

1. **Daily Refresh Cycle**:
   - Each day's mix is keyed to a calendar date (`YYYY-MM-DD`).
   - Deterministic pseudo-random generation based on the date key ensures the playlist remains consistent across multiple visits during the same day.
   - Explicit user refresh (`forceRefresh`) generates a fresh permutation on demand.

2. **Multi-Factor Scoring**:
   - **Play completions**: +2.0 score boost for tracks played to completion.
   - **Skip penalties**: -1.5 penalty for quick skips (<30 seconds); -0.75 for later skips.
   - **Recency bonus**: +1.5 boost for tracks played within the last 7 days.
   - **Time of day alignment**: +1.0 boost when current listening time matches the track's historical playback time of day (morning, afternoon, evening, night).
   - **Liked track bonus**: +3.0 boost for tracks explicitly added to the user's liked library.

3. **Curatorial Balance & Artist Diversity**:
   - **High-affinity pool**: 60–70% of tracks are drawn from top-scored listening history and liked tracks.
   - **Discovery pool**: 30–40% of tracks are introduced as fresh recommendations from catalog seeds.
   - **Artist diversity limit**: By default, at most 2 tracks per artist are included in the mix to prevent repetitive clustering.
   - **Exclusions enforcement**: Any track present in `db.recommendationExclusions` is strictly excluded from both pools.

4. **Tiered Caching**:
   - **Memory cache**: Instant zero-latency access during active browser sessions.
   - **IndexedDB metadataCache**: Persistent storage in `EchoMusicWebDB.metadataCache` with key `taste_mix_{dateKey}`.
   - Automatic cache expiration after 24 hours.

5. **User Interface & Accessibility**:
   - Featured Daily Taste Mix card prominently displayed on the Home page.
   - One-click **Play Mix** action that loads the entire mix into the audio queue.
   - **Save to Library** action creating a persistent playlist in the user's collection.
   - **Refresh** action with visual spinning state to recalculate recommendations.
   - Full keyboard accessibility and minimum 44px touch targets.

## Telemetry Metrics

The Taste Mix service tracks operational telemetry:
- `mixesGenerated`: Total number of mixes computed.
- `cacheHits`: Hits served from memory or IndexedDB cache.
- `refreshesTriggered`: Manual user refreshes executed.
- `lastGeneratedDateKey`: Most recent date key processed.
- `lastError`: Error message if any operation encountered an issue.
