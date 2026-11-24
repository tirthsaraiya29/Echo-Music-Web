# Podcast Metadata Pages & Show Notes (FEATURE-040)

## Overview
Echo Music Web implements comprehensive podcast episode metadata display, formatted show notes, author/creator information, publication timestamp, and timestamped chapter parsing matching upstream Android Echo Music (`EpisodeDetails.kt`).

## Upstream Parity & Architecture
- **Upstream Pattern:** `EpisodeDetails.kt` extracts chapter markers from episode descriptions using regular expressions:
  ```regex
  ^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–—:.]?\s+(.+)$
  ```
- **Monotonicity Rule:** At least 2 chapters must exist in strictly increasing chronological sequence to form a valid chapter playlist.
- **Interactive Chapter Seeking:** Clicking any chapter seeks the audio playback engine directly to `chapter.startMs / 1000` seconds and begins playback.
- **Show Notes:** Preserves formatted line breaks, links, and detailed notes provided in podcast episode descriptions.
- **Episode Details Modal (`EpisodeDetailsModal.tsx`):**
  - High-resolution episode artwork hero.
  - Published date and formatted duration.
  - Interactive playback control (Play/Pause current episode).
  - Chapters timeline with clickable seek stamps.
  - Native share action via `shareTrack`.

## Telemetry
- `metadataLoadsCount`: Count of episode metadata requests.
- `chaptersParsedCount`: Count of chapter markers parsed from descriptions.
- `chapterJumpsCount`: Count of user jumps to chapter timestamps.
