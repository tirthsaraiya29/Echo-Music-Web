# Listen Together Client Architecture and Lifecycle

## Overview
The Listen Together client (`listenTogetherClient.ts`) coordinates synchronized playback across web browsers:
- **Host Role:** When a user creates a room, their browser becomes the authoritative synchronization source. The host's playback events (track change, play/pause, seek) are throttled and dispatched to the server via `/api/listen-together/sync` with action `update_state`, and locally broadcast via `BroadcastChannel`.
- **Guest Role:** When a user joins via a 6-to-8 character room code, the client polls the server periodically (heartbeat interval of 1500ms) and adjusts the local audio engine (`AudioEngine`) to match track, playback state, and position (correcting drift > 2.5s).

## API Contracts
### `POST /api/listen-together/create`
- Input: `{ hostName: string }` validated against `createRoomInputSchema` (1-50 chars).
- Output: `{ code: string, userId: string, token: string, room: SynchronizedRoomState }`.

### `POST /api/listen-together/join`
- Input: `{ code: string, userName: string }` validated against `joinRoomInputSchema` (code regex `^[A-Z0-9]{6,8}$`, userName 1-50 chars).
- Output: `{ code: string, userId: string, isHost: boolean, token: string, room: SynchronizedRoomState }`.

### `POST /api/listen-together/sync`
- Input: `{ code, userId, token, action: 'update_state' | 'heartbeat' | 'leave', track, isPlaying, playbackPositionSeconds }`.
- Output: `{ isPlaying, playbackPositionSeconds, track, members, logs }`.

## Client Guarantees & Lifecycle
1. **State Immutability:** `getState()` returns deep-cloned arrays of `members` and `logs` to prevent external mutations from corrupting internal client state.
2. **Cancellation & Cleanup:** Calling `leaveRoom()` terminates all active heartbeat and throttle timers, aborts in-flight fetch requests via `AbortController`, notifies the server asynchronously, and resets subscribers with a clean empty state.
3. **Throttling & Coalescing:** Consecutive playback state changes are throttled to at most once per 1000ms. In-flight requests are not duplicated; pending actions coalesce into a single follow-up request.
4. **Deduplication:** State updates with identical track ID, playing state, and position (within 1.5s tolerance) are deduplicated before network dispatch.
5. **Accessibility & Observability:** The modal provides `aria-live="polite"` activity feeds, minimum 44px touch targets, `motion-reduce:animate-none` animations, offline awareness banners, and telemetry counters for all operations.
