# Extension Preloading Architecture

## Overview
Echo Music Web implements non-blocking, asynchronous extension stream preloading for upcoming tracks in the playback queue to eliminate gaps and buffering delays when switching tracks.

## Deduplication & Caching
1. **Preload Stream Cache (`preloadedStreams`)**:
   - Bounded in-memory LRU cache storing resolved `ExtensionResolvedStream` records.
   - When the queue advances and `resolveTrackExtension` is called for the track, the preloaded stream is immediately retrieved and consumed with zero network roundtrips (`preloadCacheHits`).

2. **In-Flight Deduplication (`inFlightResolutions`)**:
   - If an extension resolution is already executing for a track (e.g. preloading while the user clicks Next or during queue changes), subsequent callers latch onto the existing Promise instead of issuing duplicate HTTP requests (`inFlightPreloadDeduplicated`).

3. **Background Prebuffering Handshake**:
   - In `AudioEngine.handlePrebuffer()`, when the current track approaches its end (`prebufferWindowMs`), the engine peeks the upcoming track in `QueueManager` and queues extension preloading while preparing the standby audio deck.

## Telemetry
Monitored via `extensionManager.getTelemetry()`:
- `preloadsTriggered`: Total preloading operations started.
- `preloadCacheHits`: Times a track resolved instantly from preloaded cache.
- `inFlightPreloadDeduplicated`: Times a concurrent call coalesced onto an active in-flight resolution.
