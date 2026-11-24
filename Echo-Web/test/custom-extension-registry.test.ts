import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  addonManifestSchema,
  addonEndpointSchema,
  registerAddonInputSchema,
  extensionHealthStatusSchema,
} from '../src/types/extension.ts'
import {
  ExtensionManager,
  getExtensionRegistryMetrics,
  resetExtensionRegistryMetrics,
  recordExtensionRegistryMetric,
} from '../src/services/extensions/extensionManager.ts'

describe('Custom Extension Registry [FEATURE-001]', () => {
  beforeEach(() => {
    resetExtensionRegistryMetrics()
  })

  it('validates addonManifestSchema', () => {
    const valid = {
      id: 'ext-flac',
      name: 'FLAC Vault',
      version: '1.0.0',
      description: 'Lossless audio',
    }
    const parsed = addonManifestSchema.parse(valid)
    assert.equal(parsed.id, 'ext-flac')
    assert.equal(parsed.version, '1.0.0')

    assert.throws(() => addonManifestSchema.parse({ id: '' }))
  })

  it('validates addonEndpointSchema and rejects non-http URLs', () => {
    const endpoint = {
      id: 'addon_1',
      name: 'Custom Provider',
      url: 'https://provider.example.com',
      enabled: true,
      priority: 1,
    }
    const parsed = addonEndpointSchema.parse(endpoint)
    assert.equal(parsed.url, 'https://provider.example.com')

    assert.throws(() => addonEndpointSchema.parse({ ...endpoint, url: 'ftp://provider.com' }))
    assert.throws(() => addonEndpointSchema.parse({ ...endpoint, url: 'not-a-url' }))
  })

  it('validates registerAddonInputSchema', () => {
    const valid = {
      url: 'https://stream.example.com/api',
      name: 'Stream Provider',
      enabled: true,
    }
    const parsed = registerAddonInputSchema.parse(valid)
    assert.equal(parsed.url, 'https://stream.example.com/api')
    assert.equal(parsed.name, 'Stream Provider')
  })

  it('adds custom addon, avoids duplicate URLs, and reorders priorities', async () => {
    const manager = new ExtensionManager()
    // Mock checkHealth
    manager.checkHealth = async () => ({
      status: 'online',
      latencyMs: 15,
      manifest: { id: 'mock', name: 'Mock Ext', version: '1.0.0' },
    })

    const a1 = await manager.addAddon({
      url: 'https://ext1.example.com',
      name: 'Extension 1',
    })
    const a2 = await manager.addAddon({
      url: 'https://ext2.example.com',
      name: 'Extension 2',
    })

    assert.equal(a1.priority, 1)
    assert.equal(a2.priority, 2)

    // Reject duplicate registration
    await assert.rejects(
      async () =>
        manager.addAddon({
          url: 'https://ext1.example.com',
          name: 'Extension 1 Dup',
        }),
      /already registered/,
    )

    // Reorder
    manager.reorderAddons([a2.id, a1.id])
    const addons = manager.getAddons()
    assert.equal(addons[0].id, a2.id)
    assert.equal(addons[0].priority, 1)
    assert.equal(addons[1].id, a1.id)
    assert.equal(addons[1].priority, 2)

    // Toggle and remove
    manager.toggleAddon(a2.id, false)
    assert.equal(manager.getAddons().find((a) => a.id === a2.id)?.enabled, false)

    manager.removeAddon(a2.id)
    assert.equal(manager.getAddons().length, 1)

    const metrics = getExtensionRegistryMetrics()
    assert.equal(metrics.registrations, 2)
    assert.equal(metrics.toggles, 1)
    assert.equal(metrics.removals, 1)
  })

  it('handles health check parsing and metrics', async () => {
    const status = extensionHealthStatusSchema.parse({
      status: 'online',
      latencyMs: 25,
      manifest: {
        id: 'lossless-1',
        name: 'Lossless 1',
        version: '1.0.0',
      },
    })
    assert.equal(status.status, 'online')
    assert.equal(status.latencyMs, 25)

    recordExtensionRegistryMetric('healthChecks')
    recordExtensionRegistryMetric('healthCheckFailures')

    const metrics = getExtensionRegistryMetrics()
    assert.equal(metrics.healthChecks, 1)
    assert.equal(metrics.healthCheckFailures, 1)
  })
})
