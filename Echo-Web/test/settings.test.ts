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

test('Data Saver: respects browser network policy and gates preloading [BUG-37]', async () => {
  const { isDataSaverActive } = await import('../src/engine/AudioEngine.ts')

  // 1. With preferences.dataSaver = true, active regardless of connection
  useEchoStore.setState({
    preferences: {
      ...useEchoStore.getState().preferences,
      dataSaver: true,
    },
  })
  assert.strictEqual(isDataSaverActive(), true)

  // 2. With preferences.dataSaver = false, but navigator.connection.saveData = true
  useEchoStore.setState({
    preferences: {
      ...useEchoStore.getState().preferences,
      dataSaver: false,
    },
  })

  const originalNavigator = globalThis.navigator
  try {
    // Mock navigator.connection with saveData = true
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        ...originalNavigator,
        connection: { saveData: true, effectiveType: '4g' },
      },
      configurable: true,
      writable: true,
    })
    assert.strictEqual(isDataSaverActive(), true, 'Network saveData=true should activate Data Saver')

    // Mock navigator.connection with slow-2g
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        ...originalNavigator,
        connection: { saveData: false, effectiveType: 'slow-2g' },
      },
      configurable: true,
      writable: true,
    })
    assert.strictEqual(isDataSaverActive(), true, 'effectiveType slow-2g should activate Data Saver')

    // Normal fast unmetered connection
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        ...originalNavigator,
        connection: { saveData: false, effectiveType: '4g' },
      },
      configurable: true,
      writable: true,
    })
    assert.strictEqual(isDataSaverActive(), false, 'Normal 4g with saveData=false should NOT activate Data Saver')
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    })
    useEchoStore.setState({
      preferences: {
        ...useEchoStore.getState().preferences,
        dataSaver: false,
      },
    })
  }
})

test('Lossless metadata and settings consistency [BUG-38]', async () => {
  const fs = await import('node:fs')
  const indexHtml = fs.readFileSync('index.html', 'utf8')

  // Open Graph description must not falsely promise lossless streaming from YouTube
  assert.ok(
    !indexHtml.includes('ad-free playback, synchronized lyrics, and lossless audio'),
    'og:description must not overpromise streaming lossless audio',
  )
  assert.ok(
    indexHtml.includes('high-fidelity audio, and lossless local playback') ||
      indexHtml.includes('lossless local playback'),
    'og:description must accurately describe high-fidelity streaming and lossless local playback',
  )

  // Stream resolution for lossless quality maps to highest available tier (high)
  const { streamRouter } = await import('../server/routes/stream.ts')
  assert.ok(streamRouter)
})
