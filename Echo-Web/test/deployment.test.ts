import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  deploymentConfigSchema,
  healthResponseSchema,
  deploymentMetricsSchema,
  validateDeploymentConfig,
  recordDeploymentMetric,
  resetDeploymentMetrics,
  getDeploymentMetrics,
  buildHealthPayload,
} from '../server/utils/deploymentTypes.ts'
import { app } from '../server/index.ts'

describe('Production Deployment & Telemetry', () => {
  beforeEach(() => {
    resetDeploymentMetrics()
  })

  it('validates default deployment config', () => {
    const config = validateDeploymentConfig({})
    assert.equal(config.port, 3000)
    assert.equal(config.nodeEnv, 'development')
    assert.equal(config.staticDir, './dist')
    assert.deepEqual(config.corsOrigins, ['http://localhost:5173'])
  })

  it('validates custom valid deployment config', () => {
    const custom = {
      port: 8080,
      nodeEnv: 'production' as const,
      staticDir: '/var/www/echo',
      corsOrigins: ['https://echo.music.app', 'https://staging.echo.music.app'],
      rateLimitMax: 500,
      serviceName: 'custom-proxy',
      version: '2.0.0',
    }
    const validated = validateDeploymentConfig(custom)
    assert.equal(validated.port, 8080)
    assert.equal(validated.nodeEnv, 'production')
    assert.equal(validated.serviceName, 'custom-proxy')
  })

  it('rejects invalid ports and configurations', () => {
    assert.throws(() => validateDeploymentConfig({ port: -1 }))
    assert.throws(() => validateDeploymentConfig({ port: 70000 }))
    assert.throws(() => validateDeploymentConfig({ nodeEnv: 'invalid-env' }))
  })

  it('generates schema-compliant health payload', () => {
    const payload = buildHealthPayload('ok')
    const parsed = healthResponseSchema.parse(payload)
    assert.equal(parsed.status, 'ok')
    assert.equal(parsed.service, 'echo-audio-proxy')
    assert.ok(parsed.uptime >= 0)
    assert.ok(parsed.memory.heapUsed >= 0)
  })

  it('tracks deployment metrics accurately', () => {
    recordDeploymentMetric('requestsHandled')
    recordDeploymentMetric('requestsHandled')
    recordDeploymentMetric('healthChecks')
    recordDeploymentMetric('serverErrors')

    const metrics = getDeploymentMetrics()
    assert.equal(metrics.requestsHandled, 2)
    assert.equal(metrics.healthChecks, 1)
    assert.equal(metrics.serverErrors, 1)
    assert.equal(metrics.staticAssetsServed, 0)
  })

  it('responds to /api/health with 200 and valid schema', async () => {
    const res = await app.request('/api/health')
    assert.equal(res.status, 200)
    const json = await res.json()
    const parsed = healthResponseSchema.parse(json)
    assert.equal(parsed.status, 'ok')
    assert.equal(parsed.service, 'echo-audio-proxy')
  })

  it('responds to /api/deployment/telemetry with 200 and valid schema', async () => {
    const res = await app.request('/api/deployment/telemetry')
    assert.equal(res.status, 200)
    const json = await res.json()
    const parsed = deploymentMetricsSchema.parse(json)
    assert.ok(parsed.telemetryRequests >= 1)
    assert.ok(parsed.requestsHandled >= 1)
  })
})
