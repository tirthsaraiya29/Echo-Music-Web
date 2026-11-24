import test from 'node:test'
import assert from 'node:assert'

import {
  pwaIconSchema,
  pwaManifestSchema,
  swStatusSchema,
  pwaMetricsSchema,
  getPwaMetrics,
  resetPwaMetrics,
  recordPwaMetric,
} from '../src/services/pwa/pwaTypes.ts'

import { PwaManager, pwaManager } from '../src/services/pwa/pwaManager.ts'

test('PWA: manifest schema validates valid manifest [SMALL-40]', () => {
  const validManifest = {
    name: 'Echo Music Web',
    short_name: 'Echo Music',
    description: 'Autonomous open music streaming client',
    theme_color: '#1a181f',
    background_color: '#121118',
    display: 'standalone',
    start_url: '/',
    scope: '/',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  }

  const result = pwaManifestSchema.safeParse(validManifest)
  assert.strictEqual(result.success, true)
})

test('PWA: manifest schema rejects invalid configurations [SMALL-40]', () => {
  // Invalid hex color
  assert.strictEqual(
    pwaManifestSchema.safeParse({
      name: 'Echo Music',
      short_name: 'Echo',
      theme_color: 'invalid-color',
      background_color: '#121118',
      start_url: '/',
      scope: '/',
      icons: [{ src: '/icon.png', sizes: '192x192', type: 'image/png' }],
    }).success,
    false,
  )

  // Empty icons array
  assert.strictEqual(
    pwaManifestSchema.safeParse({
      name: 'Echo Music',
      short_name: 'Echo',
      theme_color: '#123456',
      background_color: '#121118',
      start_url: '/',
      scope: '/',
      icons: [],
    }).success,
    false,
  )

  // Icon with missing required attributes
  assert.strictEqual(
    pwaIconSchema.safeParse({
      src: '',
      sizes: '192x192',
    }).success,
    false,
  )
})

test('PWA: telemetry metrics track operations and reset [SMALL-40]', () => {
  resetPwaMetrics()
  const initial = getPwaMetrics()
  assert.strictEqual(initial.registrations, 0)
  assert.strictEqual(initial.updatesFound, 0)

  recordPwaMetric('registrations')
  recordPwaMetric('updatesFound')
  recordPwaMetric('offlineTransitions')

  const updated = getPwaMetrics()
  assert.strictEqual(updated.registrations, 1)
  assert.strictEqual(updated.updatesFound, 1)
  assert.strictEqual(updated.offlineTransitions, 1)
  assert.strictEqual(pwaMetricsSchema.safeParse(updated).success, true)

  resetPwaMetrics()
  assert.strictEqual(getPwaMetrics().registrations, 0)
})

test('PWA: PwaManager singleton and observer subscriptions [SMALL-40]', () => {
  const instance1 = PwaManager.getInstance()
  const instance2 = PwaManager.getInstance()
  assert.strictEqual(instance1, instance2)
  assert.strictEqual(instance1, pwaManager)

  const status = pwaManager.getStatus()
  assert.strictEqual(swStatusSchema.safeParse(status).success, true)

  let notifiedCount = 0
  const unsubscribe = pwaManager.subscribe((st) => {
    notifiedCount++
    assert.strictEqual(typeof st.isOnline, 'boolean')
  })

  assert.strictEqual(notifiedCount, 1) // Initial callback
  unsubscribe()
})

test('PWA: registration returns false gracefully in non-browser environment [SMALL-40]', async () => {
  const registered = await pwaManager.register('/sw.js', { timeoutMs: 100 })
  assert.strictEqual(registered, false)

  const hasUpdate = await pwaManager.checkForUpdates()
  assert.strictEqual(hasUpdate, false)
})
