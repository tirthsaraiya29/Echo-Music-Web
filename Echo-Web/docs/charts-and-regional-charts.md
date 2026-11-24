# Charts & Regional Charts Architecture

## Overview
The **Charts and Regional Charts** feature brings upstream Echo Music's ranked discovery experience to the web client. Users can explore top streamed tracks, trending hits, music videos, and top artists across 12 worldwide regions, complete with visual ranking movement badges (`▲`, `▼`, `—`, `NEW`) and dedicated chart playback queues.

## Key Capabilities

1. **Regional Support**:
   - 12 major regions supported:
     - 🌐 Global (`GLOBAL`)
     - 🇺🇸 United States (`US`)
     - 🇬🇧 United Kingdom (`GB`)
     - 🇨🇦 Canada (`CA`)
     - 🇮🇳 India (`IN`)
     - 🇯🇵 Japan (`JP`)
     - 🇰🇷 South Korea (`KR`)
     - 🇩🇪 Germany (`DE`)
     - 🇫🇷 France (`FR`)
     - 🇧🇷 Brazil (`BR`)
     - 🇦🇺 Australia (`AU`)
     - 🇲🇽 Mexico (`MX`)
   - Region selection integrates with user locale and `preferences.contentRegion`.

2. **Chart Categories**:
   - **Top Songs**: Most played tracks right now.
   - **Top Videos**: Most viewed music videos.
   - **Trending**: Fastest rising tracks this week.
   - **Top Artists**: Leading artists by total streams.

3. **Ranking Changes & Movement Engine**:
   - Each entry in a chart is assigned a sequential rank (1..50).
   - Ranks are compared against cached snapshot positions in `db.metadataCache`:
     - **Up (`▲ delta`)**: Track moved up in rank (green indicator).
     - **Down (`▼ delta`)**: Track slipped in rank (red indicator).
     - **Same (`—`)**: Position unchanged (neutral indicator).
     - **New (`NEW`)**: Newly entered into the chart (purple pill).
   - Rank snapshots are persisted with a 7-day TTL.

4. **Chart-Specific Queues**:
   - Playing a chart initiates a dedicated queue titled `${category} • ${regionName}`.
   - **Play Chart**: Starts playback from rank #1 through the entire ranked roster.
   - **Shuffle**: Shuffles all ranked tracks within the chart while retaining chart context.

5. **User Interface & Accessibility**:
   - Responsive `RankedChartList` component with $\ge 44$px touch targets.
   - Rank numbers, badges, title, artist, album, and duration.
   - Clean category pills and accessible region `<select>` in the Discover view.

## Telemetry Metrics
- `chartsLoaded`: Total count of chart requests fulfilled.
- `chartQueuesPlayed`: Times a chart queue was started or shuffled.
- `regionSwitches`: Count of geographical region switches performed.
- `lastRegion`: Most recently viewed region code.
- `lastError`: Error description if any chart query encountered an issue.
