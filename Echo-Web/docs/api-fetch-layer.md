# API Fetch Layer Architecture [SMALL-48]

## Overview
Echo Music Web provides a hardened HTTP client (`apiFetch`) for interacting with local server routes, metadata aggregators, and companion backends.

## Features & Resilience
1. **Bounded Timeouts**: All requests default to 10s timeout, configurable per request and enforced via `AbortController`.
2. **Exponential Backoff & Jitter**: Automatically retries transient network interruptions and `5xx` server responses up to 3 times with exponential backoff and randomized jitter to prevent thundering herd problems.
3. **In-Flight Deduplication**: When `dedup: true` is set on idempotent `GET` requests, concurrent identical calls share a single underlying fetch promise.
4. **Structured Error Handling**: Returns structured `ApiError` with HTTP status code and parsed JSON error payloads.
5. **Caller Cancellation**: Fully integrates with caller-supplied `AbortSignal` for unmount and component cancellation.

## Telemetry
`getApiMetrics()` instruments:
- `requestsTotal`
- `requestsSuccessful`
- `requestsFailed`
- `retriesAttempted`
- `timeoutsTriggered`
- `dedupCoalesced`

## Verification
- Unit & integration tests in `Echo-Web/test/api-fetch.test.ts`.
