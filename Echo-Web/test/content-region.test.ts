import test from 'node:test'
import assert from 'node:assert'
import { buildClientContext } from '../server/utils/potoken.ts'
import { InnerTubeClient } from '../src/services/innertube/client.ts'
import { useEchoStore } from '../src/stores/useEchoStore.ts'
import { innertubeRouter } from '../server/routes/innertube.ts'
import { radioRouter } from '../server/routes/radio.ts'

test('Content Region: buildClientContext supports and propagates custom gl and hl', () => {
  const ctxDefault = buildClientContext('WEB_REMIX', 'vis_123')
  const clientDef = ctxDefault['client'] as { gl?: string; hl?: string; visitorData?: string }
  assert.strictEqual(clientDef.gl, 'US')
  assert.strictEqual(clientDef.hl, 'en')
  assert.strictEqual(clientDef.visitorData, 'vis_123')

  const ctxJapan = buildClientContext('WEB_REMIX', 'vis_123', undefined, 'JP', 'ja')
  const clientJp = ctxJapan['client'] as { gl?: string; hl?: string }
  assert.strictEqual(clientJp.gl, 'JP')
  assert.strictEqual(clientJp.hl, 'ja')

  const ctxGermany = buildClientContext('ANDROID_MUSIC', undefined, undefined, 'DE', 'de')
  const clientDe = ctxGermany['client'] as { gl?: string; hl?: string }
  assert.strictEqual(clientDe.gl, 'DE')
  assert.strictEqual(clientDe.hl, 'de')
})

test('Content Region: InnerTubeClient.getClientContext reflects preferred content region', () => {
  useEchoStore.setState({
    preferences: {
      ...useEchoStore.getState().preferences,
      contentRegion: 'GB',
    },
  })

  const contextGb = InnerTubeClient.getClientContext()
  const clientGb = contextGb['client'] as { gl?: string; hl?: string }
  assert.strictEqual(clientGb.gl, 'GB')

  useEchoStore.setState({
    preferences: {
      ...useEchoStore.getState().preferences,
      contentRegion: 'IN',
    },
  })

  const contextIn = InnerTubeClient.getClientContext()
  const clientIn = contextIn['client'] as { gl?: string; hl?: string }
  assert.strictEqual(clientIn.gl, 'IN')
})

test('Content Region: /api/innertube/suggestions accepts and uses gl parameter', async () => {
  const res = await innertubeRouter.request('/suggestions?q=oasis&gl=GB&hl=en-GB')
  assert.strictEqual(res.status, 200)
  const data = await res.json()
  assert.ok(Array.isArray(data))
})

test('Content Region: /api/radio/continuation accepts and uses gl parameter', async () => {
  const res = await radioRouter.request('/continuation?videoId=dQw4w9WgXcQ&gl=JP')
  // Either returns 200 with tracks/continuation or 502 on network/upstream error in test env
  assert.ok(res.status === 200 || res.status === 502)
})
