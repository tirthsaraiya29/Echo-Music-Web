import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseAndValidateAllowedOrigins,
  isOriginAllowed,
  getSecurityHeaders,
  corsConfigSchema,
  corsMetricsSchema,
  recordCorsMetric,
  resetCorsMetrics,
  getCorsMetrics,
} from '../server/utils/corsTypes.ts'
import { app } from '../server/index.ts'

describe('CORS and HTTP Headers [SMALL-50]', () => {
  beforeEach(() => {
    resetCorsMetrics()
  })

  it('validates default CORS configuration schema', () => {
    const config = corsConfigSchema.parse({})
    assert.deepEqual(config.allowedOrigins, ['http://localhost:5173'])
    assert.ok(config.allowMethods.includes('GET'))
    assert.ok(config.allowHeaders.includes('Content-Type'))
    assert.ok(config.exposeHeaders.includes('Content-Range'))
    assert.equal(config.maxAge, 86400)
  })

  it('parses and sanitizes comma-separated allowed origins', () => {
    const raw = 'https://echo.music.app, http://localhost:5173/extra/path, not-a-valid-url, https://staging.echo.app:8443'
    const origins = parseAndValidateAllowedOrigins(raw)
    assert.ok(origins.includes('https://echo.music.app'))
    assert.ok(origins.includes('http://localhost:5173'))
    assert.ok(origins.includes('https://staging.echo.app:8443'))
    assert.ok(!origins.includes('not-a-valid-url'))
  })

  it('verifies origin allowance correctly and records metrics', () => {
    const allowed = ['https://echo.music.app', 'http://localhost:5173']
    
    assert.equal(isOriginAllowed('https://echo.music.app', allowed), true)
    assert.equal(isOriginAllowed('http://localhost:5173', allowed), true)
    assert.equal(isOriginAllowed('https://malicious.example.com', allowed), false)
    assert.equal(isOriginAllowed(undefined, allowed), false)
    assert.equal(isOriginAllowed('not-url', allowed), false)

    const metrics = getCorsMetrics()
    assert.equal(metrics.allowedOriginsChecked, 5)
    assert.equal(metrics.rejectedOrigins, 3)
  })

  it('returns valid defensive security headers', () => {
    const headers = getSecurityHeaders()
    assert.equal(headers['X-Content-Type-Options'], 'nosniff')
    assert.equal(headers['X-Frame-Options'], 'DENY')
    assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin')
    assert.ok(headers['Permissions-Policy'].includes('camera=()'))
  })

  it('applies security headers to HTTP responses in server', async () => {
    const res = await app.request('/api/health')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff')
    assert.equal(res.headers.get('X-Frame-Options'), 'DENY')
    assert.equal(res.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin')
  })

  it('handles CORS headers in request response for allowed origin', async () => {
    const res = await app.request('/api/health', {
      headers: {
        Origin: 'http://localhost:5173',
      },
    })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173')
  })

  it('does not reflect disallowed origin in CORS header', async () => {
    const res = await app.request('/api/health', {
      headers: {
        Origin: 'https://evil.site.com',
      },
    })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null)
  })

  it('exposes telemetry endpoint for CORS metrics', async () => {
    recordCorsMetric('preflightRequests')
    const res = await app.request('/api/cors/telemetry')
    assert.equal(res.status, 200)
    const json = await res.json()
    const parsed = corsMetricsSchema.parse(json)
    assert.ok(parsed.securityHeadersApplied >= 1)
  })
})
