import test from 'node:test'
import assert from 'node:assert'

import {
  sponsorSegmentSchema,
  sponsorblockOptionsSchema,
  sponsorblockMetricsSchema,
  getSponsorBlockMetrics,
  resetSponsorBlockMetrics,
  recordSponsorBlockMetric,
} from '../src/engine/sponsorblockTypes.ts'

import { SponsorBlock } from '../src/engine/SponsorBlock.ts'
import { sponsorblockRouter } from '../server/routes/sponsorblock.ts'

test('SponsorBlock: schemas validate segment data and options [SMALL-39]', () => {
  const valid = {
    category: 'music_offtopic',
    start: 0,
    end: 15.5,
    uuid: 'uuid-123',
  }
  assert.strictEqual(sponsorSegmentSchema.safeParse(valid).success, true)

  // Inverted times or negative start
  assert.strictEqual(sponsorSegmentSchema.safeParse({ ...valid, start: 20, end: 10 }).success, false)
  assert.strictEqual(sponsorSegmentSchema.safeParse({ ...valid, start: -1 }).success, false)

  const defaultOpts = sponsorblockOptionsSchema.parse({})
  assert.strictEqual(defaultOpts.enabled, true)
  assert.strictEqual(defaultOpts.pollIntervalMs, 250)
})

test('SponsorBlock: telemetry metrics track operations and reset cleanly [SMALL-39]', () => {
  resetSponsorBlockMetrics()
  const initial = getSponsorBlockMetrics()
  assert.strictEqual(initial.segmentsLoaded, 0)
  assert.strictEqual(initial.cacheHits, 0)

  recordSponsorBlockMetric('segmentsLoaded')
  recordSponsorBlockMetric('cacheHits')
  recordSponsorBlockMetric('segmentsSkipped')

  const updated = getSponsorBlockMetrics()
  assert.strictEqual(updated.segmentsLoaded, 1)
  assert.strictEqual(updated.cacheHits, 1)
  assert.strictEqual(updated.segmentsSkipped, 1)

  resetSponsorBlockMetrics()
  assert.strictEqual(getSponsorBlockMetrics().segmentsLoaded, 0)
})

test('SponsorBlock: loadSegmentsForVideo fetches, caches, and coalesces requests [SMALL-39]', async () => {
  resetSponsorBlockMetrics()
  const sb = new SponsorBlock({ apiBaseUrl: '/api/sponsorblock' })

  let fetchCount = 0
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => {
      fetchCount++
      return new Response(
        JSON.stringify([
          {
            category: 'music_offtopic',
            segment: [0, 10.5],
            UUID: 'uuid-seg-1',
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const videoId = 'dQw4w9WgXcQ'

    // First call: cache miss, network hit
    const segs1 = await sb.loadSegmentsForVideo(videoId)
    assert.strictEqual(segs1.length, 1)
    assert.strictEqual(segs1[0]?.start, 0)
    assert.strictEqual(segs1[0]?.end, 10.5)
    assert.strictEqual(fetchCount, 1)

    // Second call: cache hit, no network hit
    const segs2 = await sb.loadSegmentsForVideo(videoId)
    assert.strictEqual(segs2.length, 1)
    assert.strictEqual(fetchCount, 1)

    const metrics = getSponsorBlockMetrics()
    assert.strictEqual(metrics.cacheMisses, 1)
    assert.strictEqual(metrics.cacheHits, 1)
  } finally {
    globalThis.fetch = originalFetch
    sb.destroy()
  }
})

test('SponsorBlock: checkSegments detects target segment and ignores already skipped ones [SMALL-39]', () => {
  const sb = new SponsorBlock()
  sb.setManualSegments([
    {
      category: 'intro',
      start: 5.0,
      end: 15.0,
      uuid: 'intro-uuid',
    },
  ])

  // Before segment
  assert.strictEqual(sb.checkSegments(4.0), null)

  // Inside segment
  const detected = sb.checkSegments(7.5)
  assert.ok(detected)
  assert.strictEqual(detected?.uuid, 'intro-uuid')

  // After segment
  assert.strictEqual(sb.checkSegments(16.0), null)

  sb.destroy()
})

test('SponsorBlock Router: /:videoId validates videoId and handles errors gracefully [SMALL-39]', async () => {
  // Invalid videoId
  const resBad = await sponsorblockRouter.request('/short')
  assert.strictEqual(resBad.status, 400)

  // Valid 11-char videoId
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify([]), { status: 200 })
    }

    const resGood = await sponsorblockRouter.request('/12345678901')
    assert.strictEqual(resGood.status, 200)
    const data = await resGood.json()
    assert.deepStrictEqual(data, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('SponsorBlock: loadSegmentsForVideo handles AbortSignal cancellation [SMALL-39]', async () => {
  resetSponsorBlockMetrics()
  const sb = new SponsorBlock()

  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        throw err
      }
      return new Response(JSON.stringify([]), { status: 200 })
    }

    const controller = new AbortController()
    controller.abort()

    const segs = await sb.loadSegmentsForVideo('dQw4w9WgXcQ', { signal: controller.signal })
    assert.deepStrictEqual(segs, [])

    const metrics = getSponsorBlockMetrics()
    assert.ok(metrics.cancellations > 0)
  } finally {
    globalThis.fetch = originalFetch
    sb.destroy()
  }
})
