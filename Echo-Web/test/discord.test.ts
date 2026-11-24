import test from 'node:test'
import assert from 'node:assert'
import {
  discordRouter,
  isLocalDeployment,
  encodeFrame,
  getIpcPath,
} from '../server/routes/discord.ts'
import {
  updateDiscordPresence,
  clearDiscordPresence,
  checkDiscordStatus,
  clearDiscordPresenceState,
} from '../src/services/discord/discordService.ts'
import {
  discordPresencePayloadSchema,
  discordStatusResponseSchema,
  discordPreferenceSchema,
  discordMetricsSchema,
  getDiscordMetrics,
  resetDiscordMetrics,
  recordDiscordMetric,
} from '../src/services/discord/discordTypes.ts'
import { useEchoStore } from '../src/stores/useEchoStore.ts'
import type { Track } from '../src/types/domain.ts'

test('Discord: encodeFrame creates binary frame with opcode and 32-bit length header', () => {
  const payload = { test: 'echo' }
  const buf = encodeFrame(1, payload)
  assert.strictEqual(buf.readInt32LE(0), 1) // Opcode
  const len = buf.readInt32LE(4)
  assert.strictEqual(len, Buffer.byteLength(JSON.stringify(payload)))
  assert.strictEqual(buf.toString('utf8', 8), JSON.stringify(payload))
})

test('Discord: getIpcPath resolves appropriate OS socket path', () => {
  const path = getIpcPath(0)
  assert.ok(path.includes('discord-ipc-0'))
})

test('Discord: isLocalDeployment correctly identifies cloud/remote containers', () => {
  assert.strictEqual(typeof isLocalDeployment(), 'boolean')
  process.env['FORCE_REMOTE_DEPLOYMENT'] = 'true'
  assert.strictEqual(isLocalDeployment(), false)
  delete process.env['FORCE_REMOTE_DEPLOYMENT']
})

test('Discord Router: /api/discord/status returns environment and connectivity telemetry', async () => {
  const res = await discordRouter.request('/status')
  assert.strictEqual(res.status, 200)
  const data = (await res.json()) as { ok: boolean; isLocalDeployment: boolean; hint: string }
  assert.strictEqual(data.ok, true)
  assert.strictEqual(typeof data.isLocalDeployment, 'boolean')
  assert.ok(data.hint.length > 0)
})

test('Discord Router: /api/discord/presence validates required track/artist payload', async () => {
  const res = await discordRouter.request('/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.strictEqual(res.status, 400)
  const data = (await res.json()) as { ok: boolean; error: string }
  assert.strictEqual(data.ok, false)
  assert.ok(data.error.includes('required'))
})

test('Discord Router: /api/discord/presence flags remote deployment gracefully', async () => {
  process.env['FORCE_REMOTE_DEPLOYMENT'] = 'true'
  try {
    const res = await discordRouter.request('/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track: 'Starboy', artist: 'The Weeknd' }),
    })
    assert.strictEqual(res.status, 200)
    const data = (await res.json()) as { ok: boolean; active: boolean; remoteDeployment: boolean }
    assert.strictEqual(data.ok, true)
    assert.strictEqual(data.active, false)
    assert.strictEqual(data.remoteDeployment, true)
  } finally {
    delete process.env['FORCE_REMOTE_DEPLOYMENT']
  }
})

test('Discord Router: /api/discord/clear returns success', async () => {
  const res = await discordRouter.request('/clear', {
    method: 'POST',
  })
  assert.strictEqual(res.status, 200)
  const data = (await res.json()) as { ok: boolean }
  assert.strictEqual(data.ok, true)
})

test('Discord Types: schema validation validates inputs and rejects malformed data [SMALL-35]', () => {
  const valid = {
    track: 'Karma Police',
    artist: 'Radiohead',
    album: 'OK Computer',
    durationMs: 261000,
    positionMs: 45000,
    isPlaying: true,
  }
  assert.strictEqual(discordPresencePayloadSchema.safeParse(valid).success, true)

  // Empty strings or excessive lengths
  assert.strictEqual(discordPresencePayloadSchema.safeParse({ ...valid, track: '' }).success, false)
  assert.strictEqual(discordPresencePayloadSchema.safeParse({ ...valid, artist: '' }).success, false)
  assert.strictEqual(
    discordPresencePayloadSchema.safeParse({ ...valid, track: 'a'.repeat(150) }).success,
    false,
  )

  const prefValid = discordPreferenceSchema.safeParse({
    discordRpc: true,
    discordMode: 'auto',
    discordBridgeUrl: 'http://127.0.0.1:6463',
  })
  assert.strictEqual(prefValid.success, true)
})

test('Discord Metrics: records telemetry counters and resets cleanly [SMALL-35]', () => {
  resetDiscordMetrics()
  const initial = getDiscordMetrics()
  assert.strictEqual(initial.updatesQueued, 0)
  assert.strictEqual(initial.deduplications, 0)

  recordDiscordMetric('updatesQueued')
  recordDiscordMetric('updatesSucceeded')
  recordDiscordMetric('deduplications')
  recordDiscordMetric('companionFallbacks')

  const updated = getDiscordMetrics()
  assert.strictEqual(updated.updatesQueued, 1)
  assert.strictEqual(updated.updatesSucceeded, 1)
  assert.strictEqual(updated.deduplications, 1)
  assert.strictEqual(updated.companionFallbacks, 1)

  resetDiscordMetrics()
  assert.strictEqual(getDiscordMetrics().updatesQueued, 0)
})

test('Discord Service: updateDiscordPresence respects discordRpc preference [SMALL-35]', async () => {
  useEchoStore.setState({
    preferences: {
      ...useEchoStore.getState().preferences,
      discordRpc: false,
    },
  })

  const testTrack: Track = {
    id: 'trk_1',
    title: 'Test Song',
    artistName: 'Test Artist',
  }

  // Should no-op silently and return false when disabled
  const result = await updateDiscordPresence(testTrack, true, 10)
  assert.strictEqual(result, false)
  await clearDiscordPresence()
})

test('Discord Service: deduplicates repeated presence dispatches within 3s [SMALL-35]', async () => {
  useEchoStore.setState({
    preferences: {
      ...useEchoStore.getState().preferences,
      discordRpc: true,
      discordMode: 'backend',
    },
  })

  clearDiscordPresenceState()
  resetDiscordMetrics()

  let fetchCount = 0
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => {
      fetchCount++
      return new Response(JSON.stringify({ ok: true, active: true }), { status: 200 })
    }

    const testTrack: Track = {
      id: 'trk_dedup',
      title: 'No Surprises',
      artistName: 'Radiohead',
      albumTitle: 'OK Computer',
    }

    const res1 = await updateDiscordPresence(testTrack, true, 0)
    assert.strictEqual(res1, true)
    assert.strictEqual(fetchCount, 1)

    // Immediate second call with identical details
    const res2 = await updateDiscordPresence(testTrack, true, 0)
    assert.strictEqual(res2, true)
    assert.strictEqual(fetchCount, 1) // Network was not called again

    const metrics = getDiscordMetrics()
    assert.strictEqual(metrics.updatesQueued, 1)
    assert.strictEqual(metrics.deduplications, 1)
  } finally {
    globalThis.fetch = originalFetch
    clearDiscordPresenceState()
  }
})

test('Discord Service: auto mode falls back to companion bridge when backend reports remote [SMALL-35]', async () => {
  useEchoStore.setState({
    preferences: {
      ...useEchoStore.getState().preferences,
      discordRpc: true,
      discordMode: 'auto',
      discordBridgeUrl: 'http://127.0.0.1:6463',
    },
  })

  clearDiscordPresenceState()
  resetDiscordMetrics()

  const requestedUrls: string[] = []
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url.includes('/api/discord/presence')) {
        return new Response(
          JSON.stringify({ ok: true, active: false, remoteDeployment: true }),
          { status: 200 },
        )
      }
      if (url.includes(':6463/presence')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }

    const testTrack: Track = {
      id: 'trk_auto',
      title: 'Everything in Its Right Place',
      artistName: 'Radiohead',
    }

    const success = await updateDiscordPresence(testTrack, true, 5)
    assert.strictEqual(success, true)
    assert.ok(requestedUrls.some((u) => u.includes('/api/discord/presence')))
    assert.ok(requestedUrls.some((u) => u.includes(':6463/presence')))

    const metrics = getDiscordMetrics()
    assert.strictEqual(metrics.companionFallbacks, 1)
    assert.strictEqual(metrics.updatesSucceeded, 1)
  } finally {
    globalThis.fetch = originalFetch
    clearDiscordPresenceState()
  }
})

test('Discord Service: checkDiscordStatus queries /api/discord/status [SMALL-35]', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          isLocalDeployment: true,
          socketConnected: true,
          platform: 'win32',
          hint: 'Connected',
        }),
        { status: 200 },
      )
    }

    const status = await checkDiscordStatus()
    assert.ok(status !== null)
    assert.strictEqual(status?.ok, true)
    assert.strictEqual(status?.socketConnected, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
