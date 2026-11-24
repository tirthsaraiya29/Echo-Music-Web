# Multi-Device & Cross-Tab Library Synchronization

## Overview
Echo Music Web implements real-time library synchronization across browser tabs, windows, and devices using the web-native `BroadcastChannel` API and secondary `StorageEvent` fallbacks.

This guarantees that library changes made in one session (such as liking a track, saving an album, creating a playlist, following an artist, or updating preferences) reflect immediately in all active sessions without requiring page reloads or losing playback state.

## Features & Architecture

### 1. Zero-Latency BroadcastChannel Synchronization
- Channel: `echo_multi_device_library_sync`.
- Peer-to-peer event mesh across browsing contexts in the same origin.
- Storage fallback handles tabs that enter low-power background throttling.

### 2. Monotonic Revisions & Anti-Stale Guards
- `LibrarySyncSnapshot` includes `version: number`, `deviceId: string`, and `timestamp: number`.
- Each mutation increments the local revision.
- Incoming snapshots originating from self (`deviceId === getOrCreateDeviceId()`) are ignored to avoid feedback loops.
- Outdated or duplicate timestamps from the same device are discarded.

### 3. Strict Playback Decoupling
- Library entities (`playlists`, `likedTrackIds`, `likedAlbums`, `followedArtists`, `recentlyPlayedIds`, `preferences`) are synchronized across sessions.
- Playback session state (`currentTrackId`, `isPlaying`, `progressMs`, `queueIds`) is intentionally decoupled so each tab or device maintains its own active audio engine and playback stream.

### 4. UI Controls & Diagnostics
- Storage & Backup section in Settings provides live sync status.
- "Broadcast to Peers" button allows manual push of the current library snapshot.
- "Request Sync" sends a `SYNC_REQUEST` asking active peers to provide their latest authoritative snapshot.
