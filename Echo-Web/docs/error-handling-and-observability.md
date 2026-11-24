# Error Handling and Observability Architecture

## Overview
Echo Music Web implements structured error capture, client-side logging, credential redaction, and accessible fallback experiences.

## Core Features
1. **Zod Runtime Schemas (`errorTypes.ts`)**:
   - `errorSeveritySchema`: Enforces standard severity tiers (`info`, `warn`, `error`, `fatal`).
   - `errorLogEntrySchema`: Enforces structured logging records with unique ID, timestamp, sanitized message, optional stack, and contextual metadata.
   - `observabilityMetricsSchema`: Tracks error volumes, unhandled promise rejections, fatal crashes, and secret redactions.

2. **Error Logger & Redaction (`ErrorLogger`)**:
   - **Secret Sanitization**: Redacts sensitive authorization tokens (`Bearer ...`), passwords, and secret query parameters before persisting or buffering.
   - **Bounded Memory Buffer**: Retains up to 50 recent events to prevent unbounded client memory consumption.
   - **Reactive Subscriptions**: Allows UI notifications or telemetry collectors to subscribe with guaranteed clean unsubscription.
   - **Global Handlers**: Provides `initGlobalHandlers` for catching unhandled promise rejections and uncaught window errors.

3. **Accessible UI Error Boundary (`GlobalErrorFallback`)**:
   - Accessible ARIA attributes (`role="alert"`, `aria-live="assertive"`).
   - High-contrast, keyboard-focusable controls with minimum 44px touch targets.
   - Actionable recovery options: immediate reload, clipboard copy of sanitized error payload, and cache reset.
