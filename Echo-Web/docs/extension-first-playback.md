# Extension-First Playback Architecture

## Overview
Echo Music Web implements configurable audio source resolution priorities, enabling users to prioritize custom extension providers over default YouTube streams.

## Resolution Semantics
1. **Extension-First Mode (`extensionSourcePriority: 'extension-first'`)**:
   - `AudioEngine.resolveStreamInfo` checks for enabled extension endpoints.
   - If enabled extensions exist, `extensionManager.resolveTrackExtension` matches the track and requests stream resolution across registered extensions in priority order.
   - If an extension resolves a valid stream URL, it is cached and immediately used for playback.
   - If all extensions fail to match or resolve, resolution falls back smoothly and without interruption to the YouTube proxy stream resolver.

2. **YouTube-First Mode (`extensionSourcePriority: 'youtube-first'`)**:
   - YouTube audio stream is resolved as primary.
   - If YouTube resolution encounters an upstream error or network failure, the engine attempts extension resolution as a resilient fallback before raising a user-visible error.

3. **Data Saver Interception**:
   - When Data Saver mode is active (`dataSaver: true`), external high-bitrate extension streams are bypassed in favor of compact low-bitrate streams to respect user bandwidth constraints.

## Telemetry
Monitored via `extensionManager.getTelemetry()`:
- `totalAttempts`: Stream resolution queries initiated.
- `matchesFound`: Extensions that found a candidate track.
- `resolutionSuccesses`: Successful stream URL generations.
- `fallbackCount`: Times when playback fell back across providers.
