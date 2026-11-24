# YouTube Shorts Filtering Architecture

## Overview
**YouTube Shorts Filtering** (`FEATURE-028`) brings upstream Echo Music Android's `HideYoutubeShortsKey` parity to Echo Music Web. It allows users to filter, hide, and exclude vertical short-form video reels and YouTube Shorts from search results, discovery shelves, trending charts, and recommendation feeds.

In music streaming applications, short-form clips often lack full-fidelity audio, contain low-bitrate voiceovers, or fragment continuous listening sessions. Shorts filtering provides a clean, catalog-focused listening experience by detecting and discarding Shorts while preserving legitimate songs, EPs, albums, and full-length podcasts.

---

## Architecture & Detection Heuristics

The detection engine (`shortsFilterService.ts`) analyzes incoming items, shelves, and search catalogs across multiple criteria:

1. **Upstream ID & Browse Prefixes**:
   - YouTube Shorts playlists and shelves use IDs prefixed with `SS` (e.g., `SS...`). These are recognized and excluded immediately.
2. **Endpoint & Renderer Metadata**:
   - Items carrying `reelWatchEndpoint`, `shortsLockupViewModel`, or `reelItemRenderer` are identified as Shorts.
3. **Stream URLs**:
   - Stream paths containing `/shorts/` are flagged as short-form content.
4. **Title & Hashtag Heuristics**:
   - Titles matching `#shorts`, `(shorts)`, `[shorts]`, or beginning/ending with `shorts` are inspected.
5. **Duration Constraints**:
   - Videos with duration $\le 60$ seconds that lack official album releases (`MPREb_` IDs) and carry short-video markers or hashtag patterns are filtered out.
   - Legitimate podcast episodes (`isPodcast: true`) are explicitly protected from false-positive exclusions.
6. **Shelf Pruning & Empty Shelf Elimination**:
   - Discovery and Home shelves dedicated to Shorts (e.g. titles matching `Shorts`, `YouTube Shorts`, or `Trending Shorts`) are dropped.
   - Shelves that become empty after stripping individual Shorts items are excluded from the rendered feed (matching upstream `items.filterYoutubeShorts(true).ifEmpty { return null }`).

---

## Service API & Components

### `shortsFilterService.ts`
- `isYouTubeShort(item: unknown): boolean`: Evaluates whether a track, playlist, or renderer object is a YouTube Short.
- `filterShortsFromTracks(tracks: Track[], enabled?: boolean): Track[]`: Purges Shorts from a list of tracks.
- `filterShortsFromPlaylists(playlists: PlaylistSummary[], enabled?: boolean): PlaylistSummary[]`: Purges Shorts shelves and playlists.
- `filterShortsFromShelves(shelves: HomeShelf[], enabled?: boolean): HomeShelf[]`: Cleans shelves, stripping individual Shorts items and discarding empty shelves.
- `filterShortsFromSearchResults(catalog: SearchResultCatalog, enabled?: boolean): SearchResultCatalog`: Cleans all components of a search result set.
- `isShortsFilterEnabled(preferences?: Partial<UserPreferences>): boolean`: Reads user preferences (defaulting to `true` for a clean out-of-the-box experience).

### Integration Points
- **InnerTube Client (`client.ts`)**:
  - `fetchHomeFeed`: Automatically filters all home shelves before returning to the UI.
  - `fetchCharts`: Automatically filters all regional and global chart shelves.
  - `search`: Automatically filters tracks and playlists from search results.
  - Cache partitioning: Cache keys include a `:noShorts` vs `:withShorts` segment to prevent stale hits when toggling preferences.
- **InnerTube Parser (`parser.ts`)**:
  - Sets `isShort: true` on tracks and `isShorts: true` on playlists during parsing of responsive list items and two-row items.
- **Settings Page (`SettingsPage.tsx`)**:
  - Toggle located in **Content & Regional Catalog** section (`#settings-content`):
    - Label: `Hide YouTube Shorts`
    - Description: `Exclude YouTube Shorts and short video reels from search results, discovery shelves, and feeds.`
- **Search UI (`BrowsePages.tsx`)**:
  - Displays a visual badge (`Shorts hidden`) when shorts filtering is active in search results.

---

## Telemetry & Metrics
`getShortsFilterMetrics()` tracks performance and filtering activity:
- `totalEvaluated`: Count of candidate items evaluated by the heuristics engine.
- `shortsDetected`: Number of Shorts identified.
- `itemsFiltered`: Total count of individual items stripped from feeds.
- `shelvesFiltered`: Number of Shorts shelves pruned or discarded.

---

## Upstream Parity Matrix

| Feature / Behavior | Upstream Android (`EchoMusic`) | Echo Web Implementation | Status |
| :--- | :--- | :--- | :--- |
| Preference Key | `HideYoutubeShortsKey` (ContentSettings.kt) | `hideYoutubeShorts` / `filterShorts` | **Parity** |
| `SS` ID Prefix Filtering | `it.id.startsWith("SS")` | `id.startsWith("SS")` in `shortsFilterService` | **Parity** |
| Search Result Filtering | `SearchSummaryPage.filterYoutubeShorts()` | `filterShortsFromSearchResults()` in `client.ts` | **Parity** |
| Browse/Shelf Filtering | `BrowseResult.filterYoutubeShorts()` | `filterShortsFromShelves()` in `client.ts` | **Parity** |
| Empty Shelf Pruning | `items.filterYoutubeShorts().ifEmpty { null }` | Dropped from returned shelf array | **Parity** |
| Default State | Configurable toggle in Content settings | Default enabled (`true`), toggleable in Settings | **Parity** |
