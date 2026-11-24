# Default Echo Find Recognition Provider

## Overview
Echo Music Web provides a documented, built-in **Default Recognition Provider** matching upstream Android Echo Music's ShazamKit integration (`com.music.shazamkit.Shazam`).

Previously, audio recognition reported an unconfigured status unless the operator provided an external `RECOGNITION_PROVIDER_URL`. With FEATURE-061, Echo Find works out of the box with zero external configuration requirements, while continuing to support optional custom self-hosted gateways.

## Architecture
1. **Default Gateway (`Shazam Gateway (Default)`)**:
   - Built into `/api/recognition/identify` and `/api/recognition/status`.
   - Maps to the official public Shazam discovery gateway (`https://amp.shazam.com/discovery/v5/en/US/android/-/tag/...`).
   - Forwards audio fingerprints / DejaVu signatures.
   - Formats responses directly into the normalized `RecognitionResult` schema (`id`, `title`, `artistName`, `albumTitle`, `artwork`, `confidence`).
2. **Custom Gateway Override**:
   - If `RECOGNITION_PROVIDER_URL` is defined in server environment variables (e.g. for custom ACRCloud, AudD, or private fingerprinting instances), all requests are forwarded directly to that upstream URL.
3. **Status Reporting**:
   - `GET /api/recognition/status` reports `configured: true` and `isDefault: true` by default.
   - The UI never encounters a blocking "Recognition service is not configured" error.
4. **Telemetry & Metrics**:
   - `defaultProviderRequests`: counts requests serviced by the default built-in Shazam gateway.
   - `customProviderRequests`: counts requests forwarded to custom `RECOGNITION_PROVIDER_URL`.
   - `identificationsMatched`: successful song identifications.
   - `identificationsFailed`: recording completed with no database match.
