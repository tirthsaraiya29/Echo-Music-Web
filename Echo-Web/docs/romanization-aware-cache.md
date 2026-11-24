# Romanization-Aware Cache Identity & Multi-Script Settings [FEATURE-055]

## Overview
This feature establishes upstream feature parity with Echo Music Android's multi-script romanization preferences (`LyricsRomanizeJapaneseKey`, `LyricsRomanizeKoreanKey`, `LyricsRomanizeChineseKey`, `LyricsRomanizeCyrillicByLineKey`, `LyricsRomanizeAsMainKey`).

It implements a romanization-aware cache identity mechanism across in-memory LRU and persistent IndexedDB layers in Echo Music Web, ensuring that romanized and original lyrics can coexist cleanly without collision or cache thrashing.

## Upstream Parity & Architecture

### 1. Distinct Cache Identities
In previous implementations, lyrics were keyed simply by track ID or title/artist, leading to collisions where enabling romanization would overwrite or be shadowed by non-romanized cached results.

The romanization-aware cache key composes:
```
${trackId}:${title}:${artist}:${preferred}:${romTag}
```
Where `romTag` evaluates to:
- `orig`: When romanization is disabled.
- `rom_${sortedLanguages.join('_')}`: When romanization is enabled for selected scripts (e.g. `ja`, `ko`, `zh`, `ru`, `uk`, `sr`, `bg`, `pa`).
- `rom_${sortedLanguages.join('_')}_main`: When romanized phonetics are rendered as the primary text instead of secondary subtitle text.

### 2. Multi-Variant Coexistence in Persistent Storage
- In IndexedDB (`db.cachedLyrics`), the primary key is keyed by the full cache identity (`query`).
- When looking up lyrics, `LyricsOrchestrator` checks for the variant key first, with fallback to legacy `trackId` only if matching query parameters.
- Both the original non-romanized version and any active romanization variants remain stored side by side. Toggling romanization on/off or changing languages yields instantaneous sub-millisecond cache hits rather than redundant network roundtrips.

### 3. Granular Script & Language Configuration
In `SettingsPage.tsx`, users can select specific language scripts to romanize:
- Japanese (Romaji)
- Korean (Romaja)
- Chinese (Pinyin)
- Russian / Cyrillic
- Ukrainian
- Serbian
- Bulgarian
- Punjabi

Users can also toggle **"Romanize as main text"**, which switches the display hierarchy between original ideograms and phonetic transliterations.

### 4. Metrics & Telemetry
`LyricsOrchestratorMetrics` tracks cache performance across variants:
- `romanizedCacheHits`: Total cache hits serving romanized lyrics variants.
- `originalCacheHits`: Total cache hits serving original untransliterated lyrics.
- `variantCacheCollisionsPrevented`: Incremented when multi-variant records coexist and are correctly retrieved without overwriting each other.
