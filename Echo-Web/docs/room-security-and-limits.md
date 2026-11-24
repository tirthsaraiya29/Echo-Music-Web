# Listen Together Room Security and Limits Architecture

## Overview
The room security subsystem enforces strict boundaries on inputs, rate limits, storage consumption, and authentication to prevent brute force attacks, resource starvation, and payload corruption.

## Threat Model & Mitigations
1. **Room Code Guessing & Entropy:**
   - Codes are 6 characters long sampled uniformly using `crypto.randomBytes` over an unambiguous 32-character alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).
   - Entropy: $6 \times \log_2(32) = 30\text{ bits}$ ($2^{30} \approx 1.07\times 10^9$ possibilities).
   - Rate limiting: Max 20 join attempts per 10-minute window per IP. An attacker cannot feasibly enumerate active rooms.
2. **Denial of Service & Memory Exhaustion:**
   - Server capacity: `MAX_GLOBAL_ROOMS = 1000`. Once reached, stale rooms are purged. If still full, `503 Service Unavailable` is returned.
   - Room size limit: `MAX_ROOM_MEMBERS = 50`. Additional join requests return `409 Room is full`.
   - Creation rate limiting: Max 10 creations per 10-minute window per IP.
   - Activity log ring buffer: `MAX_ROOM_LOGS = 50`.
3. **Payload Sanitization & Boundary Clamping:**
   - Track titles, artists, and albums are capped at 256 characters.
   - Artwork URLs are capped at 1024 characters and validated to permit only `http:` and `https:` schemes (preventing SSRF and javascript/data URI exploits).
   - Playback position is clamped between 0 and 86400 seconds (24 hours).
4. **Authentication & Session Secrecy:**
   - Per-member UUID secret tokens issued at room creation and join.
   - Sync endpoints require matching member tokens; invalid tokens are rejected with `403 Not a room member`.
   - Host privileges are enforced server-side: only the room's registered host can modify playback state (`update_state`).

## Security Audit Endpoint
- **`GET /api/listen-together/security-audit`**:
  Returns current system limits and aggregated security counters (`rateLimitedJoins`, `rateLimitedCreations`, `tokenAuthFailures`, `payloadClampedOperations`, `oversizedTrackSanitizations`).
