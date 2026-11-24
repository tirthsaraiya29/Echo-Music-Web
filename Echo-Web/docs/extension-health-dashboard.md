# Extension Health Dashboard

## Overview
The Extension Health Dashboard provides real-time observability, status polling, latency diagnostics, and resolution tracking for all configured audio extension endpoints in Echo Music Web.

## Core Capabilities

### 1. Endpoint Health Lifecycle
Each configured extension endpoint tracks its live operational state:
- `online`: The endpoint answered health probing with an `ok: true` response and valid manifest.
- `error`: The endpoint returned an HTTP error code or non-success payload.
- `offline`: The endpoint is unreachable, timed out, or rejected by network safety checks.
- `unknown`: Initial state before first check or evaluation.

### 2. Real-Time Latency Metrics
- Each health probe records round-trip latency (`latencyMs`) in milliseconds.
- Displayed directly on endpoint cards for easy comparison across mirrors and sources.

### 3. Resolution Success Tracking
- Whenever an audio track resolution successfully delivers an audio stream via an extension, `lastSuccessAt` is recorded and persisted.
- Displays the active status and timestamp of the latest successful resolution in the settings dashboard.

### 4. On-Demand Diagnostic Pings
- Single-endpoint ping button to immediately re-test an individual extension.
- "Ping All" action to probe all configured extensions concurrently with non-blocking error handling (`Promise.allSettled`).
