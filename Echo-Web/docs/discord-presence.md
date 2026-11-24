# Discord Rich Presence Architecture and Lifecycle

## Overview
Echo Music Web supports Discord Rich Presence (RPC) across three deployment models:
1. **Local Server (Backend Mode):** The local Node/Hono server communicates directly with the local Discord desktop application via the OS IPC named pipe (`\\?\pipe\discord-ipc-0` on Windows, `/tmp/discord-ipc-0` on POSIX).
2. **Remote Web Client (Companion Mode):** When running hosted in the cloud or external container, the web client cannot access the host machine's IPC pipe. It routes presence updates to a local client bridge running on `http://127.0.0.1:6463/presence`.
3. **Auto Mode (Default):** Attempts backend IPC first. If the backend reports remote deployment (`remoteDeployment: true`) or socket disconnection, it automatically falls back to the client companion bridge.

## API Contracts
### `POST /api/discord/presence`
- **Request Body:**
  ```json
  {
    "track": "Song Title",
    "artist": "Artist Name",
    "album": "Album Title",
    "durationMs": 240000,
    "positionMs": 15000,
    "isPlaying": true
  }
  ```
- **Validation:** Enforced via `discordPresencePayloadSchema` (Zod). Fields are clamped and sanitized (title/artist max 128 characters).
- **Responses:**
  - `200 OK`: `{ ok: true, active: true }`
  - `200 OK` (remote): `{ ok: true, active: false, remoteDeployment: true }`
  - `400 Bad Request`: `{ ok: false, error: "track and artist required: invalid payload" }`

### `POST /api/discord/clear`
- Clears the active Discord activity frame.

### `GET /api/discord/status`
- Returns environment telemetry (`isLocalDeployment`, `socketConnected`, `platform`, `hint`).

## Lifecycle & Guarantees
- **Deduplication:** State updates with identical track, artist, album, and play state within 3 seconds are coalesced without triggering duplicate network or IPC requests.
- **Cancellation & Coalescing:** Rapid track skips abort in-flight HTTP requests via `AbortController`, ensuring the latest user state takes immediate precedence.
- **Accessibility & Diagnostics:** The Settings UI provides a connection test button with live status reporting, accessible ARIA attributes, touch targets >= 44px, and support for reduced-motion.
- **Telemetry:** In-memory counters track queued updates, successes, failures, deduplications, and companion fallbacks.
