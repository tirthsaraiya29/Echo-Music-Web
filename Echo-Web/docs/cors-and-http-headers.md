# CORS and HTTP Security Headers Architecture

## Overview
Echo Music Web implements strict Cross-Origin Resource Sharing (CORS) validation and HTTP security headers across all endpoints served by the backend proxy server.

## Allowed Origins Configuration
Origins are configured via the `CORS_ORIGINS` environment variable as a comma-separated list of valid web origins (e.g., `https://echo.music.app,http://localhost:5173`).
- Malformed URLs and trailing paths are parsed and sanitized via `parseAndValidateAllowedOrigins`.
- Origin checking (`isOriginAllowed`) enforces exact protocol, host, and port equality without wildcard vulnerabilities.
- Same-origin browser requests are natively exempt from CORS checks.

## Security Headers
Every HTTP response is enriched with standard defensive security headers:
- `X-Content-Type-Options: nosniff` — Prevents MIME-type confusion attacks.
- `X-Frame-Options: DENY` — Protects against clickjacking and frame-embedding.
- `Referrer-Policy: strict-origin-when-cross-origin` — Protects referrers on cross-origin navigation.
- `Permissions-Policy: geolocation=(), camera=(), microphone=()` — Disables unused hardware device permissions.

## Expose Headers
To support media streaming and byte-range seeking:
- `Content-Length`
- `Content-Range`
- `Accept-Ranges`

## Observability & Metrics
The server tracks telemetry metrics accessible via `GET /api/cors/telemetry`:
- `preflightRequests`: Number of OPTIONS preflight queries processed.
- `allowedOriginsChecked`: Total origin verification evaluations.
- `rejectedOrigins`: Number of requests with unapproved origin headers.
- `securityHeadersApplied`: Total responses decorated with security headers.
