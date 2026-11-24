import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  RadioContinuationService,
} from '../src/services/radio/radioContinuationService.ts'
import {
  radioContinuationInputSchema,
  radioRetryOptionsSchema,
  radioContinuationResponseSchema,
} from '../src/services/radio/radioContinuationTypes.ts'

describe('Radio Retry and Recovery [FEATURE-016]', () => {
  it('schemas: validate inputs, options, and responses strictly', () => {
    // Valid videoId input
    const vInput = radioContinuationInputSchema.parse({ videoId: 'vid123', region: 'US' })
    assert.equal(vInput.videoId, 'vid123')
    assert.equal(vInput.region, 'US')
    assert.equal(vInput.explicit, true)

    // Valid continuationToken input
    const cInput = radioContinuationInputSchema.parse({ continuationToken: 'token456' })
    assert.equal(cInput.continuationToken, 'token456')

    // Reject missing both
    assert.throws(() => {
      radioContinuationInputSchema.parse({ region: 'US' })
    })

    // Retry options defaults and boundary clamps
    const defOptions = radioRetryOptionsSchema.parse({})
    assert.equal(defOptions.maxRetries, 3)
    assert.equal(defOptions.initialBackoffMs, 800)

    // Valid response payload
    const parsedResp = radioContinuationResponseSchema.parse({
      tracks: [
        {
          id: 't1',
          title: 'Track 1',
          artistName: 'Artist',
          durationMs: 180000,
        },
      ],
      continuationToken: 'next_token',
    })
    assert.equal(parsedResp.tracks.length, 1)
    assert.equal(parsedResp.continuationToken, 'next_token')
  })

  it('computeBackoff: calculates exponential backoff bounded by maxMs with jitter', () => {
    const service = new RadioContinuationService()
    const b0 = service.computeBackoff(0, 200, 2000)
    assert.ok(b0 >= 200 && b0 <= 550)

    const b1 = service.computeBackoff(1, 200, 2000)
    assert.ok(b1 >= 400 && b1 <= 750)

    const bLarge = service.computeBackoff(10, 200, 2000)
    assert.ok(bLarge >= 2000 && bLarge <= 2350)
  })

  it('RadioContinuationService: retries on failure and recovers successfully', async () => {
    const service = new RadioContinuationService()
    let callCount = 0

    // Mock global.fetch
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      callCount++
      if (callCount < 3) {
        return new Response(JSON.stringify({ error: 'Gateway timeout' }), { status: 504 })
      }
      return new Response(
        JSON.stringify({
          tracks: [{ id: 'recovered-1', title: 'Recovered Track' }],
          continuationToken: 'cont_token_recovered',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    try {
      const res = await service.fetchWithRetry(
        { videoId: 'test-seed' },
        { maxRetries: 3, initialBackoffMs: 50, maxBackoffMs: 200 },
      )

      assert.equal(callCount, 3)
      assert.equal(res.tracks.length, 1)
      assert.equal(res.tracks[0]?.id, 'recovered-1')
      assert.equal(res.continuationToken, 'cont_token_recovered')

      const metrics = service.getState().metrics
      assert.equal(metrics.successCount, 1)
      assert.equal(metrics.retryAttempts, 2)
      assert.equal(metrics.successAfterRetryCount, 1)
      assert.equal(metrics.failureCount, 0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('RadioContinuationService: transitions to exhausted when all retries fail', async () => {
    const service = new RadioContinuationService()
    let callCount = 0

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      callCount++
      return new Response(JSON.stringify({ error: 'Persistent failure' }), { status: 500 })
    }) as unknown as typeof fetch

    try {
      await assert.rejects(
        async () => {
          await service.fetchWithRetry(
            { videoId: 'fail-seed' },
            { maxRetries: 2, initialBackoffMs: 50, maxBackoffMs: 150 },
          )
        },
        /Radio continuation failed after 3 attempts/,
      )

      assert.equal(callCount, 3)
      const state = service.getState()
      assert.equal(state.status, 'exhausted')
      assert.equal(state.metrics.failureCount, 1)
      assert.ok(state.lastError?.includes('500'))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('RadioContinuationService: respects AbortSignal cancellation', async () => {
    const service = new RadioContinuationService()
    const abortController = new AbortController()

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: 'Fail' }), { status: 502 })
    }) as unknown as typeof fetch

    try {
      // Abort after small delay during retry backoff
      setTimeout(() => abortController.abort(), 80)

      await assert.rejects(
        async () => {
          await service.fetchWithRetry(
            { videoId: 'abort-seed' },
            { maxRetries: 5, initialBackoffMs: 200, maxBackoffMs: 1000 },
            abortController.signal,
          )
        },
      )

      assert.equal(service.getState().status, 'idle')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
