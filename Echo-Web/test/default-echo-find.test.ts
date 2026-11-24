import test from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'

import { recognitionRouter } from '../server/routes/recognition.ts'
import {
  recognitionStatusSchema,
  recognitionResultSchema,
  getEchoFindMetrics,
  resetEchoFindMetrics,
  recordEchoFindMetric,
} from '../src/services/recognition/echoFindTypes.ts'
import { echoFind } from '../src/services/recognition/echoFindService.ts'

test('Default Echo Find: /status reports configured and default Shazam provider [FEATURE-061]', async () => {
  const origEnv = process.env['RECOGNITION_PROVIDER_URL']
  delete process.env['RECOGNITION_PROVIDER_URL']

  try {
    const res = await recognitionRouter.request('/status')
    assert.strictEqual(res.status, 200)

    const data = await res.json()
    const parsed = recognitionStatusSchema.safeParse(data)
    assert.strictEqual(parsed.success, true)
    assert.strictEqual(data.configured, true)
    assert.strictEqual(data.isDefault, true)
    assert.ok(data.provider.includes('Shazam'))
  } finally {
    if (origEnv) process.env['RECOGNITION_PROVIDER_URL'] = origEnv
  }
})

test('Default Echo Find: /status reflects custom provider override when set [FEATURE-061]', async () => {
  const origEnv = process.env['RECOGNITION_PROVIDER_URL']
  process.env['RECOGNITION_PROVIDER_URL'] = 'https://custom-acrcloud.example.com/identify'

  try {
    const res = await recognitionRouter.request('/status')
    assert.strictEqual(res.status, 200)

    const data = await res.json()
    assert.strictEqual(data.configured, true)
    assert.strictEqual(data.isDefault, false)
    assert.strictEqual(data.provider, 'Custom Recognition Gateway')
  } finally {
    if (origEnv) {
      process.env['RECOGNITION_PROVIDER_URL'] = origEnv
    } else {
      delete process.env['RECOGNITION_PROVIDER_URL']
    }
  }
})

test('Default Echo Find: /identify handles default requests without unconfigured error [FEATURE-061]', async () => {
  const origEnv = process.env['RECOGNITION_PROVIDER_URL']
  delete process.env['RECOGNITION_PROVIDER_URL']

  try {
    const res = await recognitionRouter.request('/identify', {
      method: 'POST',
    })
    assert.strictEqual(res.status, 200)

    const data = await res.json()
    const parsed = recognitionResultSchema.safeParse(data)
    assert.strictEqual(parsed.success, true)
    assert.strictEqual(data.configured, true)
    assert.strictEqual(data.matched, false)
    assert.ok(data.provider?.includes('Shazam'))
    assert.ok(data.message?.includes('No matching track'))
  } finally {
    if (origEnv) process.env['RECOGNITION_PROVIDER_URL'] = origEnv
  }
})

test('Default Echo Find: /identify returns verified track in demo/test mode [FEATURE-061]', async () => {
  const res = await recognitionRouter.request('/identify?demo=true', {
    method: 'POST',
  })
  assert.strictEqual(res.status, 200)

  const data = await res.json()
  const parsed = recognitionResultSchema.safeParse(data)
  assert.strictEqual(parsed.success, true)
  assert.strictEqual(data.matched, true)
  assert.strictEqual(data.configured, true)
  assert.ok((data.confidence ?? 0) >= 90)
  assert.strictEqual(data.track?.title, 'Never Gonna Give You Up')
  assert.strictEqual(data.track?.artistName, 'Rick Astley')
})

test('Default Echo Find: telemetry records default and custom provider requests [FEATURE-061]', () => {
  resetEchoFindMetrics()

  recordEchoFindMetric('defaultProviderRequests')
  recordEchoFindMetric('defaultProviderRequests')
  recordEchoFindMetric('customProviderRequests')

  const metrics = getEchoFindMetrics()
  assert.strictEqual(metrics.defaultProviderRequests, 2)
  assert.strictEqual(metrics.customProviderRequests, 1)
})
