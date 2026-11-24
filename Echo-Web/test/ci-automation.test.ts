import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  ciStepSchema,
  ciPipelineResultSchema,
  ciTelemetryMetricsSchema,
  getCiTelemetryMetrics,
  resetCiTelemetryMetrics,
  recordCiMetric,
} from '../src/services/ci/ciTypes.ts'
import { CiPipelineRunner } from '../src/services/ci/ciRunner.ts'

describe('CI and Automated Tests [SMALL-52]', () => {
  beforeEach(() => {
    resetCiTelemetryMetrics()
  })

  it('validates ciStepSchema with valid and default properties', () => {
    const step = ciStepSchema.parse({
      name: 'Lint',
      command: 'npm run lint',
      status: 'pending',
    })
    assert.equal(step.name, 'Lint')
    assert.equal(step.durationMs, 0)
    assert.equal(step.status, 'pending')
  })

  it('rejects invalid CI step status or empty commands', () => {
    assert.throws(() => ciStepSchema.parse({ name: 'Test', command: '', status: 'running' }))
    assert.throws(() => ciStepSchema.parse({ name: 'Test', command: 'npm test', status: 'unknown' }))
  })

  it('executes pipeline successfully and returns passed status', async () => {
    const runner = new CiPipelineRunner()
    const result = await runner.run({
      'Lint': async () => {},
      'Unit Tests': async () => {},
      'Type Check': async () => {},
      'Production Build': async () => {},
    })

    const parsed = ciPipelineResultSchema.parse(result)
    assert.equal(parsed.status, 'passed')
    assert.equal(parsed.steps.length, 4)
    assert.ok(parsed.steps.every((s) => s.status === 'success'))

    const metrics = getCiTelemetryMetrics()
    assert.equal(metrics.runsTriggered, 1)
    assert.equal(metrics.runsCompleted, 1)
    assert.equal(metrics.runsFailed, 0)
    assert.equal(metrics.totalStepExecutions, 4)
  })

  it('halts pipeline immediately on step failure and marks pipeline as failed', async () => {
    const runner = new CiPipelineRunner()
    const result = await runner.run({
      'Lint': async () => {},
      'Unit Tests': async () => {
        throw new Error('Test suite assertion failed')
      },
      'Type Check': async () => {},
    })

    assert.equal(result.status, 'failed')
    assert.equal(result.steps.length, 2)
    assert.equal(result.steps[0].status, 'success')
    assert.equal(result.steps[1].status, 'failure')
    assert.ok(result.steps[1].error?.includes('assertion failed'))

    const metrics = getCiTelemetryMetrics()
    assert.equal(metrics.runsFailed, 1)
    assert.equal(metrics.runsCompleted, 0)
  })

  it('aborts pipeline when AbortSignal is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()

    const runner = new CiPipelineRunner()
    const result = await runner.run(undefined, { signal: controller.signal })

    assert.equal(result.status, 'cancelled')
    assert.equal(result.steps[0].status, 'cancelled')

    const metrics = getCiTelemetryMetrics()
    assert.equal(metrics.runsCancelled, 1)
  })

  it('records and resets telemetry metrics', () => {
    recordCiMetric('runsTriggered')
    recordCiMetric('runsCompleted')
    const metrics = getCiTelemetryMetrics()
    assert.equal(metrics.runsTriggered, 1)
    assert.equal(metrics.runsCompleted, 1)

    resetCiTelemetryMetrics()
    const reset = getCiTelemetryMetrics()
    assert.equal(reset.runsTriggered, 0)
    assert.equal(reset.runsCompleted, 0)
    assert.ok(ciTelemetryMetricsSchema.parse(reset))
  })
})
