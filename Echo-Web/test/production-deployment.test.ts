import test from 'node:test'
import assert from 'node:assert'
import { app } from '../server/index.ts'
import { getApiBaseUrl, buildApiUrl } from '../src/services/api.ts'

test('Production Deployment: /api/health returns 200 with service metadata [BUG-04]', async () => {
  const res = await app.request('/api/health')
  assert.strictEqual(res.status, 200)

  const body = (await res.json()) as { status: string; service: string; timestamp: number }
  assert.strictEqual(body.status, 'ok')
  assert.strictEqual(body.service, 'echo-audio-proxy')
  assert.ok(typeof body.timestamp === 'number')
})

test('Production Deployment: CORS headers allow configured origin [BUG-04]', async () => {
  const req = new Request('http://localhost:3000/api/health', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'GET',
    },
  })
  const res = await app.request(req)
  assert.strictEqual(res.headers.get('access-control-allow-origin'), 'http://localhost:5173')
})

test('Production Deployment: getApiBaseUrl and buildApiUrl handle base URLs correctly [BUG-04]', () => {
  // In Node environment without window
  const defaultBase = getApiBaseUrl()
  assert.ok(defaultBase.startsWith('http://') || defaultBase === '')

  const urlWithQuery = buildApiUrl('/api/stream/resolve?videoId=12345')
  assert.ok(urlWithQuery.includes('/api/stream/resolve?videoId=12345'))
})
