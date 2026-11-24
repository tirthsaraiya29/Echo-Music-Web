# Lyrics+ / YouLyPlus Provider Integration [FEATURE-051]

## Overview
This feature integrates the upstream Echo Music Lyrics+ / YouLyPlus provider into Echo Music Web, establishing full feature parity with upstream Android implementations (`echo.music.iad1tya.lyrics.YouLyPlusLyricsProvider` and `com.music.youlyplus.YouLyPlus`).

## Architecture & Mirror Strategy

### Community-Hosted Mirror Network
To guarantee high availability and bypass regional or provider-specific blocks, the provider queries open-source community mirrors of the LyricsPlus backend:
- `https://lyricsplus.prjktla.my.id` (YouLy primary instance)
- `https://lyricsplus.atomix.one` (Meow mirror)
- `https://lyricsplus.binimum.org` (Binimum mirror)
- `https://lyricsplus.prjktla.workers.dev` (Cloudflare Worker edge instance)
- `https://lyricsplus-seven.vercel.app` (Jigen mirror)
- `https://lyrics-plus-backend.vercel.app` (Vercel serverless instance)

### Fast-Path Winning Mirror Promotion
When a mirror successfully returns synchronized lyrics for a query, it is stored as `lastWorkingServer`. Subsequent queries prioritize this winning mirror, avoiding unnecessary failover round-trips while falling back transparently if the winning mirror becomes unresponsive.

## Provider-Specific Parsing

1. **KPoe Syllable Timing (`lyrics: LyricsPlusItem[]`)**:
   - Parses `syllabus` arrays containing exact millisecond timestamps (`time`), durations (`duration`), and background markers (`isBackground`).
   - Maps syllables into `LyricWord[]` to provide precise karaoke-style word-by-word timing (`isWordSynced = true`).
   - Flags vocal background harmonies (`isBackground = true`) for secondary visual styling on stage.

2. **Synchronized LRC String (`syncedLyrics`)**:
   - Parses standard timestamp tags `[mm:ss.xxx]`.
   - Supports extended embedded syllable timestamp tags `<mm:ss.xxx>word`.
   - Recognizes `{bg}` background vocal annotations.

3. **Plain Text (`plainLyrics`)**:
   - Fallback for non-synchronized catalog songs with evenly spaced progression intervals.

## Integration & Telemetry
- **Orchestrator Cascade**: Fully registered in `LyricsOrchestrator`, with support as a user preference in `SettingsPage`.
- **Validation**: Strict Zod schemas (`lyricsPlusResponseSchema`, `lyricsPlusItemSchema`, `lyricsPlusSyllableSchema`, `lyricsPlusMetricsSchema`).
- **Telemetry**: Measures request totals, winning mirrors, failovers, syllable hits, and average latency.
