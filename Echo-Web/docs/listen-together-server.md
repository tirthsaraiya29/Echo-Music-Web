# Listen Together Server Architecture and Lifecycle

## Overview
The Listen Together server (`server/routes/listenTogether.ts`) provides ephemeral real-time room coordination for group playback:
- **Room Storage:** Managed through a modular `RoomStore` interface. By default, the in-memory `MemoryRoomStore` tracks active rooms, host metadata, participant rosters, and room event activity logs.
- **Authentication & Authorization:** Every participant receives a cryptographically random UUID token upon `/create` or `/join`. All subsequent state updates and heartbeat queries (`/sync`) must supply their assigned `userId` and `token`. Only the room host is authorized to push playback updates (`update_state`).
- **Telemetry & Monitoring:** Metrics are exposed via `GET /api/listen-together/telemetry` without exposing member identities, tokens, or personal content.

## API Contracts
### `GET /api/listen-together/telemetry`
- **Response:**
  ```json
  {
    "ok": true,
    "activeRooms": 1,
    "metrics": {
      "roomsCreated": 5,
      "roomsJoined": 12,
      "roomsPruned": 2,
      "syncRequests": 150,
      "heartbeatRequests": 120,
      "stateUpdates": 30,
      "leaveRequests": 4,
      "authFailures": 1,
      "rateLimitedCreations": 0,
      "rateLimitedJoins": 0,
      "validationErrors": 0
    }
  }
  ```

### `POST /api/listen-together/create`
- Input: `{ hostName?: string }` validated against `createRoomServerInputSchema` (max 32 chars).
- Output: `{ code: string, userId: string, token: string, room: PublicRoomView }`.
- Returns `429` on rate-limit violation (> 10 per 10m window per IP), `503` when capacity (`MAX_GLOBAL_ROOMS = 1000`) is reached.

### `POST /api/listen-together/join`
- Input: `{ code: string, userName?: string }` validated against `joinRoomServerInputSchema` (valid 6-8 alphanumeric code, max 32 chars userName).
- Output: `{ code: string, userId: string, isHost: false, token: string, room: PublicRoomView }`.
- Returns `400` on malformed code, `404` on non-existent room, `409` on full room (`MAX_ROOM_MEMBERS = 50`), `429` on rate limit.

### `POST /api/listen-together/sync`
- Input: `{ code, userId, token, action: 'update_state' | 'heartbeat' | 'leave', track, isPlaying, playbackPositionSeconds, isBuffering }` validated against `syncRoomServerInputSchema`.
- Output: `PublicRoomView` or `{ status: "left" }`.
- Returns `400` on validation failure, `403` on unauthenticated/mismatched token, `404` if room does not exist.

## Server Guarantees & Cleanup
1. **Heartbeat Pruning:** Guest members without a sync request for > 45 seconds are pruned from the roster.
2. **Room Expiration:** Rooms without an active host heartbeat or active playback within 30 minutes are reclaimed by the periodic cleanup worker. Rooms with an actively heartbeating host are preserved indefinitely even if playback is paused.
3. **Payload Sanitization:** Track payloads, titles, artist names, artwork URLs, and playback positions are strictly sanitized and clamped (max position 86400s / 24h).
4. **Lifecycle Teardown:** The server exports `stopRoomCleanupTimer()` to ensure background timers are cleanly halted during server shutdown or test execution.
