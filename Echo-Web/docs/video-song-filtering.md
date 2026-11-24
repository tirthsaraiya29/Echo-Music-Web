# Video-Song Filtering Architecture

## Overview
**Video-Song Filtering** (`FEATURE-029`) brings upstream Echo Music Android's `HideVideoSongsKey` parity to Echo Music Web. It allows users to filter, hide, and exclude video-only content, official music videos, and user video uploads from search results, discovery shelves, and recommendation queues—ensuring the application serves official high-fidelity audio tracks.

In music streaming applications, video-only content often contains extraneous audio (dialogues, long intros, video sound effects) or lower-bitrate audio encodings. Video-song filtering guarantees pure, uninterrupted audio streaming while keeping full-length podcast episodes intact.

---

## Architecture & Detection Rules

The detection engine (`videoSongFilterService.ts`) inspects candidate tracks and browse shelves:

1. **InnerTube `musicVideoType` Semantics (Upstream Parity)**:
   - In YouTube Music InnerTube, tracks carry `watchEndpointMusicConfig.musicVideoType`.
   - `MUSIC_VIDEO_TYPE_ATV` denotes an **Audio Track Video** (official album track with album artwork). These are pure audio tracks and are retained.
   - Any video type other than `MUSIC_VIDEO_TYPE_ATV` (such as `MUSIC_VIDEO_TYPE_OMV` for official music videos, `MUSIC_VIDEO_TYPE_UGC` for user-generated content) is classified as a video song.
2. **Podcast Episode Protection**:
   - Podcast episodes (`MUSIC_VIDEO_TYPE_PODCAST_EPISODE` or `isPodcast: true`) are explicitly protected from video filtering because podcast shows are legitimate listening content.
3. **Title & Album Heuristics**:
   - Items carrying video keywords (e.g. `official video`, `music video`, `lyric video`, `visualizer`) that are not backed by an official album browse ID (`MPREb_`) are detected as video songs.
4. **Data Saver Interoperability**:
   - Consistent with upstream Echo Music, when `dataSaver` is enabled, video-song filtering is automatically applied to reduce bandwidth consumption.
5. **Shelf Pruning & Empty Shelf Elimination**:
   - Shelves titled `Music Videos`, `Trending Videos`, or `Official Videos` are omitted when video-song filtering is enabled.
   - Shelves that become empty after stripping video songs are dropped from the feed.

---

## Service API & Components

### `videoSongFilterService.ts`
- `isVideoSong(item: unknown): boolean`: Evaluates whether a track is a video song.
- `filterVideoSongsFromTracks(tracks: Track[], enabled?: boolean): Track[]`: Purges video songs from a track array.
- `filterVideoSongsFromShelves(shelves: HomeShelf[], enabled?: boolean): HomeShelf[]`: Filters video songs from shelves and drops empty shelves.
- `filterVideoSongsFromSearchResults(catalog: SearchResultCatalog, enabled?: boolean): SearchResultCatalog`: Sanitizes search results.
- `isVideoSongFilterEnabled(preferences?: Partial<UserPreferences>): boolean`: Determines whether filtering is active based on `hideVideoSongs` or `dataSaver`.

### Integration Points
- **InnerTube Client (`client.ts`)**:
  - `fetchHomeFeed`: Applies `filterVideoSongsFromShelves`.
  - `fetchCharts`: Applies `filterVideoSongsFromShelves`.
  - `search`: Applies `filterVideoSongsFromSearchResults`.
  - Cache partitioning: Cache keys include `:noVideos` vs `:withVideos` to prevent stale cache entries upon preference changes.
- **InnerTube Parser (`parser.ts`)**:
  - Parses `musicVideoType` from `watchEndpointMusicConfig` and sets `isVideo: true` and `isVideoSong: true` on candidate tracks.
- **Settings Page (`SettingsPage.tsx`)**:
  - Toggle in **Content & Regional Catalog** section (`#settings-content`):
    - Label: `Hide video songs`
    - Description: `Exclude music videos and user video uploads from search and discovery, preferring official audio tracks.`
- **Search UI (`BrowsePages.tsx`)**:
  - Displays a visual badge (`Videos hidden`) when video filtering is active.

---

## Telemetry & Metrics
`getVideoSongFilterMetrics()` tracks performance and filtering activity:
- `totalEvaluated`: Count of candidate tracks evaluated.
- `videoSongsDetected`: Number of video songs identified.
- `itemsFiltered`: Total count of video songs stripped from feeds.
- `shelvesFiltered`: Number of video shelves pruned or discarded.

---

## Upstream Parity Matrix

| Feature / Behavior | Upstream Android (`EchoMusic`) | Echo Web Implementation | Status |
| :--- | :--- | :--- | :--- |
| Preference Key | `HideVideoSongsKey` (ContentSettings.kt) | `hideVideoSongs` | **Parity** |
| Audio Track Video (ATV) Retention | `musicVideoType == MUSIC_VIDEO_TYPE_ATV` | Retained as official audio | **Parity** |
| Podcast Episode Protection | `it.isPodcastEpisode` kept | Kept via `isPodcast: true` / podcast type | **Parity** |
| Data Saver Coupling | `hideVideos \|\| dataSaverEnabled` | `hideVideoSongs === true \|\| dataSaver === true` | **Parity** |
| Empty Shelf Elimination | `it.items.filterVideoSongs().ifEmpty { null }` | Dropped from returned shelf array | **Parity** |
| Search Result Filtering | `SearchSummaryPage.filterVideoSongs()` | `filterVideoSongsFromSearchResults()` | **Parity** |
