import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'

import {
  recognitionResultSchema,
  recognitionStatusSchema,
  echoFindRecordingOptionsSchema,
  echoFindMetricsSchema,
  getEchoFindMetrics,
  resetEchoFindMetrics,
  recordEchoFindMetric,
  isReducedMotionPreferred,
} from '../src/services/recognition/echoFindTypes.ts'

import { echoFind } from '../src/services/recognition/echoFindService.ts'

test('EchoFind: recognitionResultSchema validates match structures and handles failure payloads [SMALL-31]', () => {
  const matched = {
    matched: true,
    configured: true,
    confidence: 94,
    track: {
      id: 'song-rec-1',
      title: 'Blinding Lights',
      artistName: 'The Weeknd',
      artwork: 'https://example.com/art.jpg',
    },
  }
  assert.strictEqual(recognitionResultSchema.safeParse(matched).success, true)

  const unconfigured = {
    matched: false,
    configured: false,
    message: 'Music recognition service is not configured.',
    guidance: 'Set RECOGNITION_PROVIDER_URL in server environment variables.',
  }
  assert.strictEqual(recognitionResultSchema.safeParse(unconfigured).success, true)

  // Invalid payload rejected
  assert.strictEqual(recognitionResultSchema.safeParse({ notAField: 123 }).success, false)
})

test('EchoFind: recognitionStatusSchema validates server status responses [SMALL-31]', () => {
  const status = {
    configured: true,
    provider: 'ACRCloud',
    demoAvailable: true,
    guidance: 'Service ready.',
  }
  assert.strictEqual(recognitionStatusSchema.safeParse(status).success, true)

  assert.strictEqual(recognitionStatusSchema.safeParse({ configured: 'not-bool' }).success, false)
})

test('EchoFind: echoFindRecordingOptionsSchema clamps and defaults duration & timeout [SMALL-31]', () => {
  const defaultOpts = echoFindRecordingOptionsSchema.parse({})
  assert.strictEqual(defaultOpts.durationMs, 6000)
  assert.strictEqual(defaultOpts.timeoutMs, 12000)

  const customOpts = echoFindRecordingOptionsSchema.parse({ durationMs: 10000, timeoutMs: 20000 })
  assert.strictEqual(customOpts.durationMs, 10000)
  assert.strictEqual(customOpts.timeoutMs, 20000)

  // Out of bounds duration rejected
  assert.strictEqual(echoFindRecordingOptionsSchema.safeParse({ durationMs: 500 }).success, false)
  assert.strictEqual(echoFindRecordingOptionsSchema.safeParse({ durationMs: 50000 }).success, false)
})

test('EchoFind: telemetry metrics record activity and reset cleanly [SMALL-31]', () => {
  resetEchoFindMetrics()
  const initial = getEchoFindMetrics()

  assert.strictEqual(initial.recordingsStarted, 0)
  assert.strictEqual(initial.recordingsCompleted, 0)
  assert.strictEqual(initial.recordingsAborted, 0)
  assert.strictEqual(initial.identificationsMatched, 0)
  assert.strictEqual(initial.identificationsFailed, 0)
  assert.strictEqual(initial.unconfiguredAttempts, 0)
  assert.strictEqual(initial.errors, 0)
  assert.strictEqual(echoFindMetricsSchema.safeParse(initial).success, true)

  recordEchoFindMetric('recordingsStarted')
  recordEchoFindMetric('recordingsCompleted')
  recordEchoFindMetric('identificationsMatched')

  const updated = getEchoFindMetrics()
  assert.strictEqual(updated.recordingsStarted, 1)
  assert.strictEqual(updated.recordingsCompleted, 1)
  assert.strictEqual(updated.identificationsMatched, 1)

  resetEchoFindMetrics()
  assert.strictEqual(getEchoFindMetrics().recordingsStarted, 0)
})

test('EchoFind: isReducedMotionPreferred defaults safely in Node environment [SMALL-31]', () => {
  assert.strictEqual(isReducedMotionPreferred(), false)
})

test('EchoFind: stopListening cleans up resources cleanly [SMALL-31]', () => {
  echoFind.stopListening()
  assert.doesNotThrow(() => echoFind.stopListening())
})

test('EchoFind: component source enforces focus trap, ARIA, touch targets, and reduced motion [SMALL-31]', () => {
  const code = fs.readFileSync('src/components/modals/EchoFindModal.tsx', 'utf8')

  // Focus trap integration
  assert.ok(code.includes('useModalFocusTrap'), 'Must use useModalFocusTrap for accessibility')

  // Accessible dialog role and title
  assert.ok(code.includes('role="dialog"'), 'Must have role="dialog"')
  assert.ok(code.includes('aria-modal="true"'), 'Must have aria-modal="true"')
  assert.ok(code.includes('aria-labelledby="echo-find-modal-title"'), 'Must have aria-labelledby')

  // Minimum touch target sizing (44x44px)
  assert.ok(code.includes('min-h-[44px]'), 'Must support accessible min 44px touch targets')
  assert.ok(code.includes('min-w-[44px]'), 'Must support accessible min 44px touch targets')

  // Reduced motion compliance
  assert.ok(code.includes('prefersReducedMotion'), 'Must respect prefersReducedMotion')

  // Offline status tracking & alert
  assert.ok(code.includes('isOffline'), 'Must track offline state')
  assert.ok(code.includes('role="alert"'), 'Must announce errors via role="alert"')

  // Cancellation via AbortController
  assert.ok(code.includes('abortControllerRef'), 'Must maintain abortControllerRef for lifecycle cleanup')
})
