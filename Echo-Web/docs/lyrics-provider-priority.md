# Lyrics Provider Priority Settings [FEATURE-052]

## Overview
This feature introduces configurable provider priority ordering for the lyrics retrieval cascade in Echo Music Web, establishing full feature parity with upstream Echo Music's `LyricsProviderRegistry.kt`.

Previously, the cascade order was hardcoded across providers. With this update, users can order the provider chain according to their personal preference (e.g. prioritizing word-by-word karaoke, fast open-source databases, or international Asian catalogs).

## Architecture

### Configurable Provider Cascade
The cascade respects `preferences.lyricsProviderOrder`:
- Available providers:
  - `LRCLIB`: Fast, open-source community database.
  - `LYRICS_PLUS`: Multi-mirror edge network supporting KPoe syllables and background vocals.
  - `BETTER_LYRICS`: TTML word timing with millisecond timestamps.
  - `KUGOU`: Asian & international synchronized catalog.
- If a custom order is defined (e.g. `['BETTER_LYRICS', 'LYRICS_PLUS', 'LRCLIB', 'KUGOU']`), `LyricsOrchestrator` attempts queries in that exact sequential order before falling back to YouTube captions.
- Partial custom orders automatically append any missing active providers to the tail, ensuring robust fallback resilience without leaving catalog songs without lyrics.

### Persistence & Synchronization
- Provider orders are persisted in `UserPreferences.lyricsProviderOrder` and validated via Zod schema (`lyricsProviderOrderSchema`).
- Order changes synchronize with `preferredLyricsProvider` such that moving a provider to Priority #1 sets it as the primary database.
- Serialization and deserialization utilities (`serializeLyricsProviderOrder`, `deserializeLyricsProviderOrder`) allow export and import across devices.

### User Interface
- A dedicated **Provider Cascade Priority** card in Settings allows users to:
  - View numerical priority ranks (1, 2, 3, 4) with capability badges and descriptions.
  - Shift providers up or down with responsive buttons.
  - One-click reset to the default order (`LRCLIB` -> `LYRICS_PLUS` -> `BETTER_LYRICS` -> `KUGOU`).

### Telemetry
- `LyricsOrchestratorMetrics` tracks `customOrderUsedCount` and `orderReorderCount` for telemetry and operational diagnostics.
