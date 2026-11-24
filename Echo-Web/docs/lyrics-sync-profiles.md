# Lyrics Synchronization & Calibration Profiles

## Overview
Echo Music Web implements a robust, multi-layer lyrics synchronization engine matching upstream Android Echo Music behavior (`lyricsOffset`, provider timing adjustments, and audio output calibration).

Because different audio devices (wired DACs, Bluetooth headphones, smart AirPlay/Cast receivers) and lyrics providers (LRCLIB, BetterLyrics, YouTube Subtitles, KuGou) exhibit systematic timing offsets, Echo Music Web separates timing into three composable layers:

```
Effective Offset = Track Offset + Profile Global Offset + Provider Calibration
```

Every millisecond adjustment is clamped within safety bounds (`[-60000ms, +60000ms]`) and persisted locally.

## Architecture & Layers
1. **Track-Specific Offset (`trackOffset`)**:
   - Persisted per track (`db.syncOffsets`) with optional provider scoping (`${trackId}:${provider}`).
   - User fine-tuning directly from the Lyrics Stage (`-0.5s`, `-0.1s`, `+0.1s`, `+0.5s`, or reset).
2. **Sync Profiles (`globalOffset`)**:
   - Named hardware audio profiles stored in `db.syncProfiles`:
     - **Default (Direct / Low Latency)**: `0ms` (for wired headphones, studio monitors, ASIO DACs).
     - **Bluetooth A2DP (+180ms)**: `+180ms` (compensates for wireless Bluetooth encoding and OS buffer latency).
     - **AirPlay & Cast (+350ms)**: `+350ms` (compensates for network audio streaming buffer delays).
     - **Anticipated Lead (-200ms)**: `-200ms` (anticipatory timing for karaoke rehearsal).
   - Switching active profile automatically recalibrates all lyric playback in real-time.
3. **Provider Calibration (`providerCalibration`)**:
   - Provider-specific offsets stored inside sync profiles:
     - `LRCLIB`: default `0ms`.
     - `BETTER_LYRICS`: default `0ms`.
     - `YOUTUBE` / `YOUTUBE_SUBTITLES`: default `-200ms` (compensates for YouTube timed text leading vocal delivery).
     - `KUGOU`: default `0ms`.
   - Accessible via the **Sync Calibration Modal** on the Lyrics Stage and in **Settings > Lyrics & Providers**.

## Schema & Validation
All profiles, offsets, and calibration summaries are strictly validated at runtime with Zod:
- `lyricsSyncProfileSchema`: validates profile ID, name, description, global offset, and provider dictionary.
- `trackSyncRecordSchema`: validates track key, offset, provider, and timestamp.
- `syncCalibrationSummarySchema`: validates the real-time breakdown of all three timing components.
- `lyricsSyncMetricsSchema`: telemetry tracking profile switches, calibrations set, and effective lookups.
