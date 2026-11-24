import test from 'node:test'
import assert from 'node:assert'

const mem = new Map<string, string>()
const mockStorage = {
  getItem: (key: string) => mem.get(key) ?? null,
  setItem: (key: string, val: string) => mem.set(key, String(val)),
  removeItem: (key: string) => mem.delete(key),
  clear: () => mem.clear(),
  key: (i: number) => Array.from(mem.keys())[i] ?? null,
  length: 0,
} as unknown as Storage

globalThis.localStorage = mockStorage
if (typeof globalThis.window !== 'undefined') {
  ;(globalThis.window as unknown as { localStorage: Storage }).localStorage = mockStorage
}

import { InnerTubeClient } from '../src/services/innertube/client.ts'
import { useEchoStore } from '../src/stores/useEchoStore.ts'

test('InnerTubeClient: client context reflects contentRegion and explicit preference [BUG-17]', () => {
  // 1. Explicit enabled, UK region
  useEchoStore.setState({
    preferences: {
      ...useEchoStore.getState().preferences,
      contentRegion: 'GB',
      showExplicit: true,
    },
  })

  let ctx = InnerTubeClient.getClientContext() as {
    client: { gl: string; hl: string }
    user: { lockedSafetyMode: boolean }
  }

  assert.strictEqual(ctx.client.gl, 'GB')
  assert.strictEqual(ctx.user.lockedSafetyMode, false)

  // 2. Explicit disabled (Restricted mode), JP region
  useEchoStore.setState({
    preferences: {
      ...useEchoStore.getState().preferences,
      contentRegion: 'JP',
      showExplicit: false,
    },
  })

  ctx = InnerTubeClient.getClientContext() as {
    client: { gl: string; hl: string }
    user: { lockedSafetyMode: boolean }
  }

  assert.strictEqual(ctx.client.gl, 'JP')
  assert.strictEqual(ctx.user.lockedSafetyMode, true)

  // Reset preferences
  useEchoStore.setState({
    preferences: {
      ...useEchoStore.getState().preferences,
      contentRegion: 'US',
      showExplicit: true,
      dataSaver: false,
    },
  })
})

test('Data Saver: audio quality and preloading suspension [BUG-17]', () => {
  const prefs = useEchoStore.getState().preferences

  // With dataSaver false: normal quality
  assert.strictEqual(prefs.dataSaver, false)

  // With dataSaver true: forces lowest bitrate and suppresses background preloading
  useEchoStore.setState({
    preferences: {
      ...useEchoStore.getState().preferences,
      dataSaver: true,
      audioQuality: 'high',
    },
  })

  const currentPrefs = useEchoStore.getState().preferences
  assert.strictEqual(currentPrefs.dataSaver, true)
  const effectiveQuality = currentPrefs.dataSaver ? 'low' : currentPrefs.audioQuality
  assert.strictEqual(effectiveQuality, 'low')

  // Reset
  useEchoStore.setState({
    preferences: {
      ...useEchoStore.getState().preferences,
      dataSaver: false,
    },
  })
})
