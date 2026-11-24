import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  errorSeveritySchema,
  errorLogEntrySchema,
  observabilityMetricsSchema,
} from '../src/services/observability/errorTypes.ts'
import {
  ErrorLogger,
  sanitizeErrorMessage,
  getObservabilityMetrics,
  resetObservabilityMetrics,
  recordObservabilityMetric,
} from '../src/services/observability/errorLogger.ts'

describe('Error Handling & Observability [SMALL-51]', () => {
  beforeEach(() => {
    resetObservabilityMetrics()
  })

  it('validates errorSeveritySchema', () => {
    assert.equal(errorSeveritySchema.parse('info'), 'info')
    assert.equal(errorSeveritySchema.parse('warn'), 'warn')
    assert.equal(errorSeveritySchema.parse('error'), 'error')
    assert.equal(errorSeveritySchema.parse('fatal'), 'fatal')
    assert.throws(() => errorSeveritySchema.parse('critical'))
  })

  it('validates errorLogEntrySchema and rejects malformed records', () => {
    const valid = {
      id: 'err-123',
      timestamp: Date.now(),
      severity: 'error' as const,
      message: 'Network timed out',
      stack: 'Error: Network timed out\n  at fetch',
      context: { retries: 3, url: '/api/stream' },
      handled: true,
    }
    const parsed = errorLogEntrySchema.parse(valid)
    assert.equal(parsed.id, 'err-123')
    assert.equal(parsed.handled, true)

    assert.throws(() => errorLogEntrySchema.parse({ id: '' }))
  })

  it('redacts sensitive credentials, tokens, and passwords in error messages', () => {
    const sensitive = 'Failed request: Bearer secret-token-xyz123 with password=supersecret'
    const sanitized = sanitizeErrorMessage(sensitive)
    assert.ok(!sanitized.includes('secret-token-xyz123'))
    assert.ok(!sanitized.includes('supersecret'))
    assert.ok(sanitized.includes('[REDACTED_CREDENTIAL]'))

    const metrics = getObservabilityMetrics()
    assert.ok(metrics.sanitizedSecretsCount >= 1)
  })

  it('buffers errors up to max capacity and drops oldest', () => {
    const logger = ErrorLogger.getInstance()
    logger.clearErrors()

    for (let i = 0; i < 60; i++) {
      logger.log(`Error number ${i}`, 'warn')
    }

    const errors = logger.getRecentErrors()
    assert.equal(errors.length, 50)
    assert.ok(errors[errors.length - 1].message.includes('Error number 59'))
    assert.ok(!errors.some((e) => e.message.includes('Error number 0')))
  })

  it('notifies subscribers and supports clean unsubscription', () => {
    const logger = ErrorLogger.getInstance()
    let receivedCount = 0

    const unsubscribe = logger.subscribe((_entry) => {
      receivedCount++
    })

    logger.log('Subscriber test 1', 'info')
    assert.equal(receivedCount, 1)

    unsubscribe()
    logger.log('Subscriber test 2', 'info')
    assert.equal(receivedCount, 1)
  })

  it('tracks metrics accurately for logged errors and fatal crashes', () => {
    const logger = ErrorLogger.getInstance()
    logger.log('Normal error', 'error')
    logger.log('Fatal crash', 'fatal')
    recordObservabilityMetric('unhandledRejections')

    const metrics = getObservabilityMetrics()
    assert.equal(metrics.errorsLogged, 2)
    assert.equal(metrics.fatalCrashes, 1)
    assert.equal(metrics.unhandledRejections, 1)

    const parsed = observabilityMetricsSchema.parse(metrics)
    assert.equal(parsed.errorsLogged, 2)
  })

  it('initializes and cleans up global handlers safely', () => {
    const logger = ErrorLogger.getInstance()
    const cleanup = logger.initGlobalHandlers()
    assert.equal(typeof cleanup, 'function')
    cleanup()
  })
})
