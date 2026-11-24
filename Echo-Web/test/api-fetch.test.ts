import test from 'node:test'
import assert from 'node:assert'

import {
  apiFetchOptionsSchema,
  apiMetricsSchema,
  getApiMetrics,
  resetApiMetrics,
  recordApiMetric,
} from '../src/services/apiTypes.ts'

import { apiFetch, ApiError, buildApiUrl, getApiBaseUrl } from '../src/services/api.ts'

test('API: options schema clamps boundaries and sets defaults [SMALL-48]', () => {
  const defaults = apiFetchOptionsSchema.parse({})
  assert.strictEqual(defaults.timeoutMs, 10000)
  assert.strictEqual(defaults.retries, 0)
  assert.strictEqual(defaults.dedup, false)

  const custom = apiFetchOptionsSchema.parse({
    timeoutMs: 5000,
    retries: 2,
    dedup: true,
  })
  assert.strictEqual(custom.timeoutMs, 5000)
  assert.strictEqual(custom.retries, 2)
  assert.strictEqual(custom.dedup, true)

  // Out of bounds
  assert.strictEqual(apiFetchOptionsSchema.safeParse({ timeoutMs: 10 }).success, false)
  assert.strictEqual(apiFetchOptionsSchema.safeParse({ retries: 10 }).success, false)
})

test('API: buildApiUrl and getApiBaseUrl resolve clean paths [SMALL-48]', () => {
  const url1 = buildApiUrl('/api/health')
  const url2 = buildApiUrl('api/health')
  assert.strictEqual(url1.endsWith('/api/health'), true)
  assert.strictEqual(url1, url2)
})

test('API: telemetry metrics track operations and reset [SMALL-48]', () => {
  resetApiMetrics()
  const initial = getApiMetrics()
  assert.strictEqual(initial.requestsTotal, 0)
  assert.strictEqual(initial.dedupCoalesced, 0)

  recordApiMetric('requestsTotal')
  recordApiMetric('requestsSuccessful')
  recordApiMetric('dedupCoalesced')

  const updated = getApiMetrics()
  assert.strictEqual(updated.requestsTotal, 1)
  assert.strictEqual(updated.requestsSuccessful, 1)
  assert.strictEqual(updated.dedupCoalesced, 1)
  assert.strictEqual(apiMetricsSchema.safeParse(updated).success, true)

  resetApiMetrics()
  assert.strictEqual(getApiMetrics().requestsTotal, 0)
})

test('API: apiFetch handles successful response with mock fetch [SMALL-48]', async () => {
  resetApiMetrics()
  const originalFetch = globalThis.fetch

  globalThis.fetch = async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', data: 42 }),
    }) as unknown as Response

  try {
    const res = await apiFetch<{ status: string; data: number }>('/api/test')
    assert.strictEqual(res.status, 'ok')
    assert.strictEqual(res.data, 42)
    assert.strictEqual(getApiMetrics().requestsSuccessful, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('API: apiFetch deduplicates concurrent GET requests when dedup=true [SMALL-48]', async () => {
  resetApiMetrics()
  const originalFetch = globalThis.fetch
  let callCount = 0

  globalThis.fetch = async () => {
    callCount++
    await new Promise((r) => setTimeout(r, 20))
    return {
      ok: true,
      status: 200,
      json: async () => ({ value: 123 }),
    } as unknown as Response
  }

  try {
    const p1 = apiFetch<{ value: number }>('/api/dedup-test', { dedup: true })
    const p2 = apiFetch<{ value: number }>('/api/dedup-test', { dedup: true })
    const [r1, r2] = await Promise.all([p1, p2])

    assert.strictEqual(r1.value, 123)
    assert.strictEqual(r2.value, 123)
    assert.strictEqual(callCount, 1) // Only one underlying HTTP call made!
    assert.strictEqual(getApiMetrics().dedupCoalesced, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('API: apiFetch handles errors and throws ApiError [SMALL-48]', async () => {
  resetApiMetrics()
  const originalFetch = globalThis.fetch

  globalThis.fetch = async () =>
    ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => JSON.stringify({ error: 'Item not found' }),
    }) as unknown as Response

  try {
    await assert.rejects(
      async () => {
        await apiFetch('/api/missing')
      },
      (err: unknown) => {
        assert.strictEqual(err instanceof ApiError, true)
        assert.strictEqual((err as ApiError).status, 404)
        assert.strictEqual((err as ApiError).message, 'Item not found')
        return true
      },
    )
    assert.strictEqual(getApiMetrics().requestsFailed, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
