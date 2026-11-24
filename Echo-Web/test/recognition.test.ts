import test from 'node:test'
import assert from 'node:assert'
import { recognitionRouter } from '../server/routes/recognition.ts'
import { echoFind } from '../src/services/recognition/echoFindService.ts'

test('Recognition: /api/recognition/status reports configuration state and guidance', async () => {
  const res = await recognitionRouter.request('/status')
  assert.strictEqual(res.status, 200)
  const data = (await res.json()) as {
    configured: boolean
    provider: string
    demoAvailable: boolean
    guidance: string
  }
  assert.strictEqual(typeof data.configured, 'boolean')
  assert.ok(data.provider.length > 0)
  assert.ok(data.guidance.includes('RECOGNITION_PROVIDER_URL'))
})

test('Recognition: /api/recognition/identify returns informative unconfigured response when no provider set', async () => {
  const res = await recognitionRouter.request('/identify', {
    method: 'POST',
  })
  assert.strictEqual(res.status, 200)
  const data = (await res.json()) as {
    matched: boolean
    configured: boolean
    message: string
    guidance: string
  }
  assert.strictEqual(data.matched, false)
  assert.strictEqual(data.configured, false)
  assert.ok(data.message.includes('not configured'))
  assert.ok(data.guidance.includes('RECOGNITION_PROVIDER_URL'))
})

test('Recognition: /api/recognition/identify supports demo mode for testing UI and track display', async () => {
  const res = await recognitionRouter.request('/identify?demo=true', {
    method: 'POST',
  })
  assert.strictEqual(res.status, 200)
  const data = (await res.json()) as {
    matched: boolean
    configured: boolean
    confidence: number
    track: {
      id: string
      title: string
      artistName: string
      albumTitle: string
      durationSeconds: number
    }
  }
  assert.strictEqual(data.matched, true)
  assert.strictEqual(data.configured, true)
  assert.ok(data.confidence >= 90)
  assert.strictEqual(data.track.title, 'Never Gonna Give You Up')
  assert.strictEqual(data.track.artistName, 'Rick Astley')
})

test('Recognition Service: echoFind service exposes checkStatus helper', async () => {
  assert.strictEqual(typeof echoFind.checkStatus, 'function')
})
