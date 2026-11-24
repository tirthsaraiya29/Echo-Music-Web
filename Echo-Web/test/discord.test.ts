import test from 'node:test'
import assert from 'node:assert'
import {
  discordRouter,
  isLocalDeployment,
  encodeFrame,
  getIpcPath,
} from '../server/routes/discord.ts'
import { updateDiscordPresence, clearDiscordPresence } from '../src/services/discord/discordService.ts'
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

test('Discord Service: updateDiscordPresence respects discordRpc preference', async () => {
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

  // Should no-op silently when disabled
  await updateDiscordPresence(testTrack, true, 10)
  await clearDiscordPresence()
})
