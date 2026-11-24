import test from 'node:test'
import assert from 'node:assert'
import {
  themedCategorySchema,
  themedShelfSchema,
  homeShelvesMetricsSchema,
  getHomeShelvesMetrics,
  resetHomeShelvesMetrics,
  THEMED_HOME_CATEGORIES,
} from '../src/hooks/useHomeFeed.ts'

test('Home Shelves: themedCategorySchema validates valid and invalid categories', () => {
  const validCat = {
    id: 'bollywood',
    title: 'Bollywood Hits',
    subtitle: 'Classic and modern cinema songs',
    query: 'Bollywood Hits Playlists',
  }
  assert.strictEqual(themedCategorySchema.safeParse(validCat).success, true)

  const invalidCat = {
    id: 'unknown-id',
    title: 'Unknown',
    subtitle: 'Unknown',
    query: 'Unknown',
  }
  assert.strictEqual(themedCategorySchema.safeParse(invalidCat).success, false, 'Invalid category id rejected')
})

test('Home Shelves: THEMED_HOME_CATEGORIES contains configured unique categories', () => {
  assert.strictEqual(THEMED_HOME_CATEGORIES.length, 4)
  const ids = new Set(THEMED_HOME_CATEGORIES.map((c) => c.id))
  assert.strictEqual(ids.size, 4, 'All categories must have unique IDs')

  for (const cat of THEMED_HOME_CATEGORIES) {
    const res = themedCategorySchema.safeParse(cat)
    assert.strictEqual(res.success, true, `Category ${cat.id} must satisfy schema`)
    assert.ok(cat.title.length > 0)
    assert.ok(cat.query.length > 0)
  }
})

test('Home Shelves: themedShelfSchema validates populated shelf structures', () => {
  const validShelf = {
    id: 'hollywood',
    title: 'Hollywood & Global Pop',
    subtitle: 'Chart-topping international tracks',
    items: [
      { id: 'pl-1', title: 'Billboard Hot 100', author: 'Billboard' },
      { id: 'pl-2', title: 'Top Pop Hits', author: 'Pop Central' },
    ],
  }
  assert.strictEqual(themedShelfSchema.safeParse(validShelf).success, true)

  const invalidShelf = {
    id: 'invalid-id',
    title: '',
    subtitle: 'Missing title and invalid id',
    items: [],
  }
  assert.strictEqual(themedShelfSchema.safeParse(invalidShelf).success, false)
})

test('Home Shelves: telemetry metrics track activity and reset cleanly', () => {
  resetHomeShelvesMetrics()
  const initial = getHomeShelvesMetrics()
  assert.strictEqual(initial.loadsCount, 0)
  assert.strictEqual(initial.failuresCount, 0)
  assert.strictEqual(initial.lastError, null)

  assert.strictEqual(homeShelvesMetricsSchema.safeParse(initial).success, true)

  resetHomeShelvesMetrics()
  assert.deepStrictEqual(getHomeShelvesMetrics(), {
    loadsCount: 0,
    failuresCount: 0,
    lastError: null,
  })
})
