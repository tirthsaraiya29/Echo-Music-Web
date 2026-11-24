# Settings & Preferences Architecture [SMALL-44]

## Overview
Echo Music Web implements a type-safe, schema-validated preferences architecture. User preferences control playback quality, UI themes, accent colors, content filtering, crossfade durations, lyrics preferences, and external integrations (Last.fm, Discord RPC, Google Cast).

## Validation & Sanitization
All preferences are validated with Zod schemas in `src/services/settings/settingsTypes.ts`:
- `userPreferencesSchema`: Enforces valid enum values (themes, accents, audio qualities, lyrics providers, tabs) and finite numeric bounds (volume `0-100`, crossfade `0-12s`).
- `validatePreferenceUpdate`: Synchronously verifies key/value pairs before mutating the store or triggering engine side-effects.
- `sanitizeUserPreferences`: Automatically sanitizes persisted storage payloads on rehydration, repairing corrupted keys with schema defaults without throwing runtime exceptions.
- `resetPreferences`: Atomically restores all user preferences to default values.

## Telemetry
`getSettingsMetrics()` tracks:
- `preferenceUpdates`
- `preferenceValidationFailures`
- `preferencesResetToDefault`
- `preferencesImported`
- `preferencesExported`

## Verification
- Unit test suite: `Echo-Web/test/settings-plumbing.test.ts`.
