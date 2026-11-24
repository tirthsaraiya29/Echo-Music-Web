# Blocked Artists Architecture

## Overview
**Blocked Artists** (`FEATURE-030`) brings upstream Echo Music Android's `BlockedArtistsKey` parity to Echo Music Web. It provides users with global, pervasive artist exclusion across all surfaces:
- **Home feeds & discovery shelves**
- **Search results (artists, tracks, albums, playlists)**
- **Radio queues and continuation streams**
- **Active player queue & playback**
- **Music Flow feeds**

Blocking an artist prevents unwanted content from polluting recommendations, charts, searches, and automated playback queues.

---

## Architecture & Storage Format

Upstream Echo Music stores blocked artists in persistent settings as a set of delimited strings:
```
"${artistId}||${artistName}"
```
This format guarantees that:
1. Fast, exact match indexing is possible via `artistId` (e.g. `UC...` YouTube channel IDs).
2. Fallback matching functions via normalized `artistName` for catalog items lacking explicit channel IDs.
3. User interfaces can immediately render human-readable artist names without requiring background network lookups.

### Components in `blockedArtistsService.ts`:
- `formatBlockedArtistEntry(id, name)`: Formats ID and Name into `id||name`.
- `parseBlockedArtistEntry(entry)`: Extracts `{ id, name }`.
- `extractBlockedSets(blockedArtists)`: Produces `blockedIds: Set<string>` and `blockedNames: Set<string>` for $O(1)$ membership checks.
- `isArtistBlocked(artistId, artistName, blockedArtists)`: Evaluates an artist.
- `isTrackBlocked(track, blockedArtists)`: Checks primary artist and any collaborative/featured artists in `track.artists`.
- `isAlbumBlocked(album, blockedArtists)`: Checks album artists.
- `isPlaylistBlocked(playlist, blockedArtists)`: Checks playlist author.
- `filterBlockedArtistsFromTracks(tracks, blockedArtists)`: Strips blocked tracks.
- `filterBlockedArtistsFromShelves(shelves, blockedArtists)`: Strips items and removes shelves that become empty.
- `filterBlockedArtistsFromSearchResults(catalog, blockedArtists)`: Cleans all four search catalog categories.
- `filterBlockedArtistsFromQueue(queue, blockedArtists)`: Filters active or upcoming queues.

---

## Integration Surfaces

1. **InnerTube Client (`client.ts`)**:
   - `fetchHomeFeed`: Strips items by blocked artists from home shelves.
   - `fetchCharts`: Strips items by blocked artists from regional and trending charts.
   - `search`: Removes blocked artists, tracks, albums, and playlists from search results.
2. **Audio Queue Engine (`QueueManager.ts` & `useEchoStore.ts`)**:
   - `addRadioTracks`: Automatically filters incoming radio tracks against `blockedArtists`.
   - `purgeBlockedArtists`: Called when a user blocks an artist to immediately remove their songs from the upcoming queue and advance playback if the current track belongs to the blocked artist.
3. **Artist Detail Page (`DetailPages.tsx`)**:
   - Prominent **Block** / **Blocked** action button in the artist hero banner alongside Play and Follow.
4. **Settings Page (`SettingsPage.tsx`)**:
   - Dedicated management card in **Content & Regional Catalog** section (`#settings-content`).
   - Displays artist count badge, artist list with ID, and individual **Unblock** buttons.

---

## Telemetry & Metrics
`getBlockedArtistsMetrics()` tracks filtering activity:
- `totalEvaluated`: Count of candidate items evaluated.
- `blockedDetected`: Number of blocked artists/items identified.
- `itemsFiltered`: Total items stripped from feeds, search, and queues.
- `shelvesFiltered`: Count of shelves pruned or discarded.

---

## Upstream Parity Matrix

| Feature / Surface | Upstream Android (`EchoMusic`) | Echo Web Implementation | Status |
| :--- | :--- | :--- | :--- |
| Storage Key | `BlockedArtistsKey` | `blockedArtists: string[]` in Zustand persist store | **Parity** |
| Delimited Format | `id\|\|name` | `id\|\|name` with parsing and formatting helpers | **Parity** |
| Artist Screen Action | `R.string.block_artist` / `unblock_artist` | Interactive toggle button in Artist hero | **Parity** |
| Settings Management | `BlockedArtistsScreen.kt` | Blocked artists card in Content settings | **Parity** |
| Home & Charts | `BrowseResult.filterBlockedArtists()` | `filterBlockedArtistsFromShelves()` in `client.ts` | **Parity** |
| Search Results | `SearchSummaryPage.filterBlockedArtists()` | `filterBlockedArtistsFromSearchResults()` in `client.ts` | **Parity** |
| Queue & Radio | `filterBlockedArtists()` in playback queues | `QueueManager.purgeBlockedArtists()` & `addRadioTracks` | **Parity** |
