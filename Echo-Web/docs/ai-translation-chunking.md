# AI Lyrics Translation Chunking & Resilient Batching [FEATURE-056]

## Overview
This feature introduces intelligent batch chunking, line index preservation, and retry mechanisms with exponential backoff for AI lyrics translation in Echo Music Web. It brings parity with upstream Android Echo Music's resilient translation pipeline, solving prompt token exhaustion, JSON truncation, and total failure modes on long tracks (60–120+ lines).

## Architecture & Capabilities

### 1. Dynamic Text Chunking (`chunkTexts`)
Song lyrics vary significantly in length. Passing entire songs into LLMs in a single request frequently causes:
- LLM output token limits to be exceeded.
- Truncated or malformed JSON payloads.
- Dropped or skipped lines due to context dilution.

The translation client slices non-empty lyric lines into bounded chunks using `chunkTexts(texts, chunkSize)`:
- **Default Chunk Size**: 30 lines (configurable from 5 to 100 via Settings).
- Each chunk preserves `chunkIndex`, `startIndex`, and `endIndex`.

### 2. Strict Line Index Preservation
Each batch prompt explicitly retains the original line indices:
```json
{
  "30": "Translated line 30",
  "31": "Translated line 31"
}
```
`parseIndexedJson` handles both absolute keys (`startIndex + i`), relative 0-based keys (`i`), and fallback array responses. The output lines are strictly mapped back to `translatedStrings[chunk.startIndex + i]` and then aligned with the original song structure, guaranteeing that synchronized timestamp alignments are never skewed or offset.

### 3. Chunk-Level Retries & Exponential Backoff
Instead of failing the entire translation when an API request fails, individual chunks are retried independently:
- **Configurable Retries**: `maxChunkRetries` (default: 2 retries, total 3 attempts).
- **Exponential Backoff**: Jittered delay (`300ms * 2^attempt`, up to 2000ms), respecting cooperative cancellation via `AbortSignal`.
- **Transient Recovery**: If an API provider rate limits (429) or drops a connection, only the affected chunk is retried.

### 4. Resilient Partial Translation Delivery
If a chunk permanently fails after all retries while other chunks succeed in a multi-chunk track:
- Rather than aborting and showing a blank screen, the orchestrator delivers all successful chunks.
- The user can read translated lyrics for the majority of the song, with untranslated lines displaying their original source text.
- `partialTranslationsDelivered` telemetry metric is recorded.

### 5. UI Controls & Configuration
- **Settings Modal**: `AIConfigModal` provides a "Batch Chunk Size" setting with live validation (5–100 lines).
- **Default Config**: Initialized to 30 lines per batch, offering the optimal balance between speed and reliability across OpenRouter, DeepL, Mistral, Anthropic, Gemini, and OpenAI-compatible endpoints.

### 6. Telemetry & Metrics
`TranslationMetrics` tracks batch operations:
- `chunksProcessed`: Total number of chunks processed across requests.
- `chunkRetries`: Number of retries triggered due to transient failures.
- `chunkFailures`: Number of chunks that failed after exhausting retries.
- `partialTranslationsDelivered`: Number of times partial translations were successfully delivered.
