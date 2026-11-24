# Listening History Controls & Device Attribution

## Overview
Echo Music Web implements upstream Android Echo Music parity for listening history controls, adding comprehensive querying, date ranges, exports, deletions, and device/source attribution.

## Features & Architecture

### 1. Device & Source Attribution
Each listening record tracks:
- `source`: `'youtube' | 'local' | 'spotify' | 'cloud' | 'podcast'`
- `deviceId`: Persistent device identifier from multi-device session sync.
- `deviceName`: User-friendly client name (e.g., Windows PC, Mac, Mobile Browser).
- `timeOfDay`: `'morning' | 'afternoon' | 'evening' | 'night'` based on local clock.

### 2. Multi-Criteria Filtering
- **Date Ranges**: Pre-computed ranges (`All Time`, `Today`, `Last 7 Days`, `Last 30 Days`) and custom timestamp windows (`startDateMs`, `endDateMs`).
- **Source Filtering**: Filter by specific provider (YouTube Music, Local Audio Files, Spotify, Cloud Media, Podcasts).
- **Search Query**: Real-time substring matching on track title, artist name, and album title.

### 3. Deletion Controls
- **Individual Record Deletion**: Delete single accidental listens without altering the rest of your history.
- **Date Range Purge**: Batch delete records within a specific time window.
- **Full Clear**: Wipe history from IndexedDB and reset recent sessions.

### 4. Portable Exports
- **JSON Export**: Full structured history dump preserving all metadata, durations, and flags.
- **CSV Export**: RFC 4180-compliant comma-separated format for analysis in spreadsheet applications.

### 5. UI Integration in Recently Played Page
- Toggle between **History Log** (full historical audit with playback controls) and **Visited Sessions** (grouped shelf summaries).
- Interactive filter pills and search bar with direct play action on each history card.
