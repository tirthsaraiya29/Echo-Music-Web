# Spotify Playlist Detail Pages (FEATURE-042)

## Overview
Echo Music Web implements dedicated Spotify playlist detail pages matching upstream Android Echo Music (`SpotifyPlaylistDetailScreen.kt` and `SpotifyPlaylistDetailViewModel.kt`). Users can view full playlist metadata, play all tracks, shuffle, view track resolution and playback states, search within the playlist, and page through large track collections.

## Upstream Parity & Architecture
- **Upstream Pattern:** `SpotifyPlaylistDetailScreen.kt` provides:
  - Hero banner with high-resolution artwork, title, owner, total track count, and estimated playlist duration.
  - Interactive "Play All", "Shuffle", "Import to Library", and "Share" action buttons.
  - Per-track playback state indicating when a track is resolving (`resolvingTrackId`) with an inline spinner, or currently playing with active audio animations.
  - On-the-fly track resolution to playable YouTube audio streams via fuzzy matching (`matchSingleTrack`).
  - Paging controls displaying remaining tracks and a "Load More Tracks" action.
  - Local library import: copies resolved tracks into an Echo Music playlist.
- **Routing Support:**
  - `/playlists/spotify_:id`
  - `/playlist/:id`
  - `/spotify/playlist/:id`
  - `/playlists/spotify_liked`: Dedicated view for user's Spotify Liked Songs collection.

## Telemetry
- `detailLoadsCount`: Number of Spotify playlist views opened.
- `tracksFetchedCount`: Cumulative Spotify tracks fetched.
- `tracksResolvedCount`: Successful track resolutions to playable streams.
- `playAllTriggersCount`: "Play All" button invocations.
- `shuffleTriggersCount`: "Shuffle" button invocations.
- `importsCount`: Playlist imports into local user library.
