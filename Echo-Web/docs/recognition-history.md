# Echo Find Music Recognition History

## Overview
Echo Music Web implements a persistent recognition history layer matching upstream Android Echo Music (`RecognitionHistoryScreen.kt` and `RecognitionHistory.kt`).

Whenever a track is successfully identified through Echo Find, the match details—including metadata, provider origin, confidence score, and timestamps—are recorded into IndexedDB (`db.recognitionHistory`) and made accessible directly within the Echo Find interface.

## Capabilities & Architecture
1. **Automatic Persistence (`RecognitionHistoryService`)**:
   - `addMatch(track, confidence, provider)`: creates a validated record conforming to `recognitionHistoryItemSchema`.
   - IndexedDB backing via Dexie `db.recognitionHistory` with primary key `id` and compound indexes (`trackId`, `recognizedAt`, `title`, `artist`).
   - Fallback in-memory map for SSR or constrained test environments.
2. **In-Modal Navigation & View**:
   - Integrated directly into `EchoFindModal`: seamless toggle between Recognizer stage and Recognition History view.
   - Shows badge count of identified tracks.
   - Real-time search filter querying song titles, artists, and album names.
3. **Playback & Queue Actions**:
   - Direct play action launching playback immediately (`useEchoStore.getState().playQueue([track], 0)`).
   - Marks item as `played: true` when launched from history.
4. **Item & Collection Management**:
   - Individual item deletion (`deleteItem`).
   - Complete history purge (`clearHistory`) with confirmation safety barrier.
5. **Runtime Validation & Metrics**:
   - Validated with Zod schemas: `recognitionHistoryItemSchema` and `recognitionHistoryMetricsSchema`.
   - Telemetry tracks: `itemsAdded`, `itemsDeleted`, `historyCleared`, `historyPlays`.
