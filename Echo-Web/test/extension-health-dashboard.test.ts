import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ExtensionManager } from '../src/services/extensions/extensionManager.ts'
import { addonEndpointSchema } from '../src/types/extension.ts'

// Provide minimal localStorage mock for Node test environment
const mockStorage = new Map<string, string>()
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = {
    getItem: (key: string) => mockStorage.get(key) ?? null,
    setItem: (key: string, val: string) => mockStorage.set(key, val),
    removeItem: (key: string) => mockStorage.delete(key),
    clear: () => mockStorage.clear(),
    key: (index: number) => Array.from(mockStorage.keys())[index] ?? null,
    length: 0,
  } as Storage
}

describe('Extension Health Dashboard [FEATURE-008]', () => {
  beforeEach(() => {
    mockStorage.clear()
  })

  it('validates addonEndpointSchema with health fields', () => {
    const endpoint = addonEndpointSchema.parse({
      id: 'test-addon-1',
      name: 'Lossless Flac Addon',
      url: 'https://addons.echo.test/v1',
      enabled: true,
      priority: 1,
      healthStatus: 'online',
      latencyMs: 42,
      lastCheckAt: 1700000000000,
      lastSuccessAt: 1700000005000,
      lastError: undefined,
    })

    assert.equal(endpoint.healthStatus, 'online')
    assert.equal(endpoint.latencyMs, 42)
    assert.equal(endpoint.lastSuccessAt, 1700000005000)
  })

  it('applies default health fields in addonEndpointSchema', () => {
    const endpoint = addonEndpointSchema.parse({
      id: 'test-addon-2',
      name: 'Unchecked Addon',
      url: 'https://addons2.echo.test/v1',
    })

    assert.equal(endpoint.healthStatus, 'unknown')
    assert.equal(endpoint.latencyMs, undefined)
    assert.equal(endpoint.lastSuccessAt, undefined)
  })

  it('testEndpointHealth updates endpoint status and latency', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url: RequestInfo | URL) => {
      const urlStr = String(url)
      if (urlStr.includes('/api/extensions/health')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            latencyMs: 38,
            manifest: { id: 'flac-mirror', name: 'Flac Mirror', version: '1.0.0' },
          }),
        } as Response
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response
    }

    try {
      const manager = new ExtensionManager()
      const addon = await manager.addAddon({
        url: 'https://flac-mirror.example.com',
        name: 'Flac Mirror',
      })

      const health = await manager.testEndpointHealth(addon.id)
      assert.equal(health.status, 'online')
      assert.equal(health.latencyMs, 38)

      const updated = manager.getAddons().find((a) => a.id === addon.id)
      assert.ok(updated)
      assert.equal(updated.healthStatus, 'online')
      assert.equal(updated.latencyMs, 38)
      assert.ok(typeof updated.lastCheckAt === 'number')
      assert.ok(typeof updated.lastSuccessAt === 'number')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('testAllEndpoints tests all endpoints concurrently', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url: RequestInfo | URL) => {
      const urlStr = String(url)
      if (urlStr.includes('/api/extensions/health')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            latencyMs: 15,
            manifest: { id: 'fast-addon', name: 'Fast Addon', version: '1.0.0' },
          }),
        } as Response
      }
      return { ok: false, status: 500, json: async () => ({}) } as Response
    }

    try {
      const manager = new ExtensionManager()
      await manager.addAddon({ url: 'https://source-a.example.com', name: 'Source A' })
      await manager.addAddon({ url: 'https://source-b.example.com', name: 'Source B' })

      await manager.testAllEndpoints()

      const addons = manager.getAddons()
      assert.equal(addons.length, 2)
      assert.ok(addons.every((a) => a.healthStatus === 'online'))
      assert.ok(addons.every((a) => a.latencyMs === 15))
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
