# Live Spotify Library (FEATURE-041)

## Overview
Echo Music Web implements live Spotify library integration matching upstream Echo Music (`LibrarySpotifyViewModel.kt` and `LibrarySpotifyScreen.kt`). Users can authenticate their Spotify session and browse their user profile, liked songs count, and saved playlists directly in the web client.

## Upstream Parity & Architecture
- **Upstream Pattern:** `LibrarySpotifyScreen.kt` provides a dedicated Spotify library tab with:
  - Profile header displaying account avatar, display name, and Spotify Premium/Free status badge.
  - Pinned "Liked Songs" item featuring the iconic gradient cover (`https://misc.scdn.co/liked-songs/liked-songs-640.png`) and exact track count.
  - Interactive sorting options (`DEFAULT`, `NAME`, `SONG_COUNT`) with ascending/descending toggles.
  - Playlist grid showing artwork, title, track count, and creator attribution.
  - Clean connect banner and modal for Spotify OAuth / user token authentication.
- **Backend Routing (`server/routes/spotify.ts`):**
  - `/api/spotify/me`: Fetches authenticated user profile, avatar, product type, and follower count.
  - `/api/spotify/me/playlists`: Paginated user playlists retrieval.
  - `/api/spotify/me/tracks`: Paginated liked songs retrieval.
- **Service (`spotifyLibraryService.ts`):**
  - Schema validation with Zod (`spotifyUserProfileSchema`, `spotifyLibraryPlaylistSchema`, `spotifyLibraryUiStateSchema`).
  - Session persistence in local storage (`echo_spotify_live_session`).
  - Automatic fallback between backend proxy and direct Spotify Web API endpoints.
  - Sorting algorithms matching Android upstream `SpotifyPlaylistSortType`.

## Telemetry
- `authSuccessCount`: Successful Spotify authentications.
- `authFailureCount`: Failed authentication attempts.
- `profileLoadsCount`: Profile metadata fetches.
- `playlistsLoadedCount`: Number of Spotify playlists retrieved.
- `likedSongsLoadedCount`: Liked songs count lookups.
- `syncOperationsCount`: Full library sync cycles.
