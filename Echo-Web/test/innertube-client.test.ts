import test from 'node:test'
import assert from 'node:assert'
import {
  searchQuerySchema,
  browseIdSchema,
  InnerTubeClient,
} from '../src/services/innertube/client.ts'
import {
  browseRequestSchema,
  searchRequestSchema,
  getInnerTubeRouterMetrics,
  resetInnerTubeRouterMetrics,
  innertubeRouter,
} from '../server/routes/innertube.ts'

test('InnerTubeClient: searchQuerySchema validates query strings and trims whitespace [SMALL-11]', () => {
  // Valid queries
  const valid1 = searchQuerySchema.safeParse('Radiohead')
  assert.strictEqual(valid1.success, true)
  if (valid1.success) assert.strictEqual(valid1.data, 'Radiohead')

  const validPadded = searchQuerySchema.safeParse('   Daft Punk   ')
  assert.strictEqual(validPadded.success, true)
  if (validPadded.success) assert.strictEqual(validPadded.data, 'Daft Punk')

  // Empty or whitespace-only
  assert.strictEqual(searchQuerySchema.safeParse('').success, false)
  assert.strictEqual(searchQuerySchema.safeParse('   ').success, false)

  // Excessively long query (> 250 characters)
  const tooLong = 'a'.repeat(251)
  assert.strictEqual(searchQuerySchema.safeParse(tooLong).success, false)
})

test('InnerTubeClient: browseIdSchema validates non-empty browse identifiers [SMALL-11]', () => {
  assert.strictEqual(browseIdSchema.safeParse('FEmusic_home').success, true)
  assert.strictEqual(browseIdSchema.safeParse('MPREb_12345').success, true)

  // Empty or whitespace-only
  assert.strictEqual(browseIdSchema.safeParse('').success, false)
  assert.strictEqual(browseIdSchema.safeParse('   ').success, false)
})

test('InnerTube Router: browseRequestSchema and searchRequestSchema reject invalid payloads with 400 [SMALL-11]', async () => {
  // Direct schema assertion
  assert.strictEqual(browseRequestSchema.safeParse({ browseId: 'FEmusic_home' }).success, true)
  assert.strictEqual(browseRequestSchema.safeParse({}).success, false)
  assert.strictEqual(searchRequestSchema.safeParse({ query: 'test' }).success, true)
  assert.strictEqual(searchRequestSchema.safeParse({}).success, false)

  // 1. Missing browseId
  const resBrowseEmpty = await innertubeRouter.fetch(
    new Request('http://localhost/browse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }),
  )
  assert.strictEqual(resBrowseEmpty.status, 400)

  // 2. Missing query in search
  const resSearchEmpty = await innertubeRouter.fetch(
    new Request('http://localhost/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }),
  )
  assert.strictEqual(resSearchEmpty.status, 400)

  // 3. Malformed JSON
  const resMalformed = await innertubeRouter.fetch(
    new Request('http://localhost/browse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not a json',
    }),
  )
  assert.strictEqual(resMalformed.status, 400)
})

test('InnerTube Router & Client: telemetry metrics tracking [SMALL-11]', async () => {
  resetInnerTubeRouterMetrics()
  InnerTubeClient.resetMetrics()

  const clientMetrics = InnerTubeClient.getMetrics()
  assert.strictEqual(clientMetrics.totalRequests, 0)
  assert.strictEqual(clientMetrics.successfulRequests, 0)
  assert.strictEqual(clientMetrics.failedRequests, 0)

  // Telemetry endpoint
  const res = await innertubeRouter.fetch(new Request('http://localhost/telemetry'))
  assert.strictEqual(res.status, 200)
  const telemetry = await res.json() as ReturnType<typeof getInnerTubeRouterMetrics>
  assert.strictEqual(typeof telemetry.browseRequests, 'number')
  assert.strictEqual(typeof telemetry.searchRequests, 'number')
  assert.strictEqual(typeof telemetry.clientRotations, 'number')
})
