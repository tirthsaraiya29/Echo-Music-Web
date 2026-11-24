# Lyrics Export with Complete Track Metadata & Encoding [FEATURE-058]

## Overview
This feature introduces standardized timed lyrics export with complete track metadata and explicit character encoding tags into Echo Music Web. It achieves parity with upstream desktop/Android export specifications, enabling users to export timed lyrics for external music players, karaoke systems, and archival preservation.

## Supported Formats & Specification

### 1. Enhanced LRC (.lrc)
The de facto standard for synchronized music lyrics.
- **Header Metadata Tags**:
  - `[ti:Song Title]`: Track title
  - `[ar:Artist Name]`: Primary and featured artists
  - `[al:Album Title]`: Album or EP name
  - `[length:mm:ss]`: Song duration
  - `[by:Echo Music Web Client]`: Author tag
  - `[re:Echo Music]`: Application identifier
  - `[ve:2.0.0]`: Specification version
  - `[encoding:UTF-8]`: Explicit text encoding
  - `[provider:LRCLIB]`: Upstream lyric provider
  - `[offset:+0]`: Calibrated synchronization offset in milliseconds
  - `[exportedAt:...]`: ISO 8601 export timestamp
- **Timed Lines**: `[mm:ss.xx] Lyric text`
- **Syllable/Word Timings**: Enhanced LRC token syntax `<mm:ss.xx> word <mm:ss.xx> word`
- **Background Harmonies**: Designated with `{bg} ...`
- **Dual-Language Translation**: Designated with `{trans} ...`

### 2. Timed Text Markup Language (.ttml)
W3C standard XML format used in broadcast and modern streaming media:
- **Header `<metadata>`**: Includes `ttm:title`, `ttm:agent`, `ttm:item` (album, provider, encoding, duration).
- **Paragraphs `<p>`**: Encapsulates begin and end boundary timestamps in `mm:ss.xxx`.
- **Word Spans `<span>`**: Preserves karaoke timings for animated lyric renderers.
- **Translation Roles**: Multi-lingual translations stored with `ttm:role="x-translation"`.

### 3. Structured JSON (.json)
Structured schema export adhering to `EchoLyricsExportPayload`:
- Machine-readable format with complete metadata, provider provenance, calibration offset, line items, and syllable tokens.

### 4. Cleaned Plain Text (.txt)
Unsynchronized plain text lyrics with metadata comments (`# Title: ...`).

## Encoding Information
- Standard **UTF-8** with optional **UTF-8-BOM** (`\uFEFF`) byte order mark for compatibility with legacy Windows media players and notepad tools.

## UI Integration
- **Header Bar Button**: "Export" button located directly on the Lyrics Stage header.
- **Export Modal**:
  - Live interactive preview showing line count, character count, and format switches.
  - Toggles for Metadata Header, AI Translation, Word-level Timings, and Character Encoding.
  - One-click "Copy to Clipboard" with instant visual confirmation.

## Telemetry & Metrics
- `totalExports`: Cumulative export operations performed.
- `exportsByFormat`: Breakdown across `lrc`, `ttml`, `json`, and `txt`.
- `metadataIncludedCount`: Exports including full track metadata.
- `translationsIncludedCount`: Exports incorporating dual-language AI translations.
- `wordTimingsIncludedCount`: Exports incorporating syllable/karaoke timing tokens.
