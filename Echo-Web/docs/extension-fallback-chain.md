# Extension Fallback Chain Architecture

## Overview
Echo Music Web implements a resilient multi-tier fallback chain for audio source resolution:
1. Primary extension attempts matching and resolution.
2. If primary extension is unreachable, times out, rejects the track, or fails stream URL generation, the chain immediately proceeds to the next configured extension in ascending priority order.
3. If all enabled extensions in the cascade fail or reject the track, the engine seamlessly falls back to the default YouTube proxy stream resolver without disrupting playback or halting playback flow.

## Fault Tolerance & Bounded Timeouts
- Each extension resolution query applies an automatic 3.5s bounded timeout (`AbortController`).
- Hanging, unresponsive, or high-latency extension servers are aborted without blocking subsequent cascade providers or delaying overall playback initiation.
- HTTP 4xx/5xx responses or candidate match misses trigger an immediate cascade step.

## Telemetry
Monitored via `extensionManager.getTelemetry()`:
- `totalAttempts`: Total playback requests that entered the extension resolver.
- `matchesFound`: Extensions that located an eligible track candidate.
- `resolutionSuccesses`: Add-on queries that successfully produced a valid stream URL.
- `extensionCascadeFailures`: Per-addon failures across the priority chain.
- `fallbackToYouTubeCount`: Tracks that exhausted all extensions and fell back cleanly to YouTube.
- `fallbackCount`: Overall provider fallbacks executed.
