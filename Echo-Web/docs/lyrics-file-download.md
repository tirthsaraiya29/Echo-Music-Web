# Lyrics File Download Architecture

## Overview
Echo Music Web supports downloading standardized lyrics files directly to the user's local filesystem across four industry-standard formats:
- **Enhanced LRC (`.lrc`)** (`application/x-subrip`)
- **Timed Text Markup Language (`.ttml`)** (`application/ttml+xml`)
- **Structured JSON (`.json`)** (`application/json`)
- **Plain Text (`.txt`)** (`text/plain`)

> [!NOTE]
> This feature strictly adheres to project boundaries: it enables local text/karaoke export for user media players (e.g., VLC, foobar2000, offline karaoke players). It does not download catalog song audio streams or violate audio stream caching policies.

## Features & Parity
1. **Filename Sanitization (`sanitizeFileName`)**:
   - Strips OS-forbidden characters across Windows, macOS, and Linux: `\ / : * ? " < > |`.
   - Strips non-printable ASCII and control characters (`[\x00-\x1f\x80-\x9f]`).
   - Normalizes whitespace and strips leading/trailing periods and spaces.
2. **Filename Generation (`buildLyricsFileName`)**:
   - Standard convention: `${Artist} - ${Title}.${ext}`.
   - Graceful fallback to `${Title}.${ext}` or `lyrics.${ext}` when tags are absent or unsanitizable.
3. **Blob & MIME Handling**:
   - Creates a browser `Blob` with explicit MIME type and `charset=utf-8`.
   - Injects UTF-8 Byte Order Mark (`\uFEFF`) when `UTF-8-BOM` encoding is configured.
4. **Trigger Flow**:
   - Invokes programmatic `URL.createObjectURL` and invisible anchor element `.click()` trigger with automatic cleanup via `URL.revokeObjectURL`.
   - Safe fallback in non-DOM/server environments calculating exact byte size.
5. **Telemetry & Validation**:
   - Runtime validation with `lyricsDownloadResultSchema` using Zod.
   - Tracks metrics: `totalDownloads` and `downloadsByFormat` dictionary in `getLyricsExportMetrics()`.
