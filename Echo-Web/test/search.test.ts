import test from 'node:test'
import assert from 'node:assert'
import {
  searchFilterSchema,
  searchQueryInputSchema,
  recentSearchSchema,
  searchMetricsSchema,
  getSearchMetrics,
  resetSearchMetrics,
  getStoredRecentSearches,
  saveRecentSearch,
  removeRecentSearch,
  clearAllRecentSearches,
} from '../src/hooks/useSearch.ts'

test('Search: searchFilterSchema validates catalog filter options correctly', () => {
  const validFilters = ['all', 'songs', 'videos', 'albums', 'artists', 'playlists']
  for (const f of validFilters) {
    assert.strictEqual(searchFilterSchema.safeParse(f).success, true, `Filter ${f} must be valid`)
  }

  assert.strictEqual(searchFilterSchema.safeParse('invalid_filter').success, false)
  assert.strictEqual(searchFilterSchema.safeParse('').success, false)
})

test('Search: searchQueryInputSchema trims and validates query boundaries', () => {
  const normal = searchQueryInputSchema.safeParse('  Radiohead OK Computer  ')
  assert.strictEqual(normal.success, true)
  if (normal.success) {
    assert.strictEqual(normal.data, 'Radiohead OK Computer')
  }

  // Reject oversized queries exceeding 500 characters
  const tooLong = 'a'.repeat(501)
  assert.strictEqual(searchQueryInputSchema.safeParse(tooLong).success, false)
})

test('Search: recentSearchSchema validates string array records', () => {
  const validList = ['Radiohead', 'Kendrick Lamar', 'Daft Punk']
  assert.strictEqual(recentSearchSchema.safeParse(validList).success, true)

  const invalidList = [{ term: 'Not a string' }]
  assert.strictEqual(recentSearchSchema.safeParse(invalidList).success, false)

  const tooMany = Array.from({ length: 25 }, (_, i) => `search-${i}`)
  assert.strictEqual(recentSearchSchema.safeParse(tooMany).success, false, 'Over 20 items should be rejected')
})

test('Search: telemetry metrics record searches and suggestions and reset cleanly', () => {
  resetSearchMetrics()
  const initial = getSearchMetrics()
  assert.strictEqual(initial.searchesCount, 0)
  assert.strictEqual(initial.suggestionsCount, 0)
  assert.strictEqual(initial.failuresCount, 0)
  assert.strictEqual(initial.lastError, null)

  assert.strictEqual(searchMetricsSchema.safeParse(initial).success, true)

  resetSearchMetrics()
  assert.deepStrictEqual(getSearchMetrics(), {
    searchesCount: 0,
    suggestionsCount: 0,
    failuresCount: 0,
    lastError: null,
  })
})

test('Search: recent search persistence functions handle lifecycle operations safely', () => {
  // Clear any existing searches
  clearAllRecentSearches()
  assert.deepStrictEqual(getStoredRecentSearches(), [])

  // Save new search
  const afterSave1 = saveRecentSearch('The Beatles')
  assert.ok(afterSave1.includes('The Beatles'))

  // Save second search
  const afterSave2 = saveRecentSearch('Pink Floyd')
  assert.strictEqual(afterSave2[0], 'Pink Floyd')
  assert.strictEqual(afterSave2[1], 'The Beatles')

  // Deduplicate case-insensitively
  const afterDedup = saveRecentSearch('the beatles')
  assert.strictEqual(afterDedup.length, 2)
  assert.strictEqual(afterDedup[0], 'the beatles')

  // Remove search
  const afterRemove = removeRecentSearch('the beatles')
  assert.strictEqual(afterRemove.includes('the beatles'), false)
  assert.ok(afterRemove.includes('Pink Floyd'))

  // Clear all
  clearAllRecentSearches()
  assert.deepStrictEqual(getStoredRecentSearches(), [])
})
