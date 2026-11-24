# Radio Retry and Recovery (FEATURE-016)

## Architectural Design

Echo Web implements resilient network retry, exponential backoff, jitter, and non-destructive queue recovery for radio continuation streams across `RadioContinuationService` and `AudioEngine`.

### Problem Statement
In single-page audio streaming clients, radio continuation requests are vulnerable to transient network failures (Wi-Fi transitions, cellular handoffs, HTTP 502/503 reverse proxy resets, and server timeouts).
Previously, failures were silently abandoned, prematurely halting auto-radio continuation and leading to queue starvation when sequential tracks completed.

### Robust Retry & Recovery Architecture

1. **Structured Input & Response Schemas**:
   - `radioContinuationInputSchema`: Validates query parameters (`videoId` or `continuationToken`, ISO country code `region`, explicit toggle).
   - `radioContinuationResponseSchema`: Validates `tracks` array and subsequent `continuationToken` prior to side effects.
   - `radioRetryOptionsSchema`: Clamps `maxRetries` (default 3), `initialBackoffMs` (default 800ms), `maxBackoffMs` (default 8000ms), and per-request `timeoutMs` (default 8000ms).

2. **Exponential Backoff with Full Jitter**:
   $$\text{delay} = \min\left(\text{maxBackoffMs}, \text{initialBackoffMs} \cdot 2^{\text{attempt}}\right) + \text{random}(0, 300\text{ms})$$
   Eliminates thundering herd spikes on backend endpoints.

3. **In-Flight Coalescing**:
   Concurrent requests targeting the exact same seed (`videoId:token:gl:explicit`) reuse the single in-flight Promise rather than multiplying network connections.

4. **Lifecycle Cancellation**:
   When the user initiates a manual track change, skips to an album, or clears the queue, the active `AbortController` triggers immediate cancellation, freeing network and worker threads.

5. **Queue Preservation & Non-Destructive Failure**:
   - During retries or on terminal exhaustion, existing playback, active cursors, and already loaded radio tracks remain untouched.
   - The user can trigger manual recovery anytime via `retryRadioContinuation()`.

6. **Observable Status & Telemetry**:
   Exposed via `AudioEngine.getRadioContinuationState()` and `useAudioEngine().radioContinuationState`:
   - `status`: `'idle' | 'fetching' | 'retrying' | 'error' | 'exhausted'`
   - Metrics: `totalAttempts`, `successCount`, `retryAttempts`, `successAfterRetryCount`, `failureCount`, `lastErrorReason`, `lastDurationMs`.
