import test from 'node:test'
import assert from 'node:assert/strict'

import {
  recognitionHistoryService,
  recognitionHistoryItemSchema,
  type RecognitionHistoryItem,
} from '../src/services/recognition/RecognitionHistoryService.ts'
import type { Track } from '../src/types/domain.ts'

const sampleTrack1: Track = {
  id: 'track-rec-1',
  title: 'Starboy',
  artistName: 'The Weeknd, Daft Punk',
  artistId: 'artist-weeknd',
  albumTitle: 'Starboy (Deluxe)',
  albumId: 'album-starboy',
  albumImage: 'https://example.com/starboy.jpg',
  artwork: 'https://example.com/starboy.jpg',
  durationSeconds: 230,
  durationMs: 230000,
  explicit: true,
  playCount: 100,
}

const sampleTrack2: Track = {
  id: 'track-rec-2',
  title: 'Blinding Lights',
  artistName: 'The Weeknd',
  artistId: 'artist-weeknd',
  albumTitle: 'After Hours',
  albumId: 'album-after-hours',
  albumImage: '',
  artwork: '',
  durationSeconds: 200,
  durationMs: 200000,
  explicit: false,
  playCount: 50,
}

test('Recognition History: schema validates full and partial history items [FEATURE-062]', () => {
  const item: RecognitionHistoryItem = {
    id: 'rec_hist_test_1',
    trackId: 'track-rec-1',
    title: 'Starboy',
    artist: 'The Weeknd',
    confidence: 96,
    recognizedAt: 1700000000000,
    provider: 'Shazam Gateway (Default)',
    played: false,
  }

  const parsed = recognitionHistoryItemSchema.safeParse(item)
  assert.strictEqual(parsed.success, true)

  const invalid = recognitionHistoryItemSchema.safeParse({ id: '', title: '' })
  assert.strictEqual(invalid.success, false)
})

test('Recognition History: records, retrieves, searches, and marks items as played [FEATURE-062]', async () => {
  await recognitionHistoryService.clearHistory()
  recognitionHistoryService.resetMetrics()

  // Add items
  const item1 = await recognitionHistoryService.addMatch(sampleTrack1, 95, 'Shazam Gateway (Default)')
  await new Promise((resolve) => setTimeout(resolve, 15))
  const item2 = await recognitionHistoryService.addMatch(sampleTrack2, 88, 'Shazam Gateway (Default)')

  assert.ok(item1.id.startsWith('rec_hist_'))
  assert.strictEqual(item1.title, 'Starboy')
  assert.strictEqual(item1.confidence, 95)
  assert.strictEqual(item1.played, false)

  assert.strictEqual(item2.title, 'Blinding Lights')
  assert.strictEqual(item2.confidence, 88)

  // Retrieve history (newest first)
  const history = await recognitionHistoryService.getHistory()
  assert.strictEqual(history.length, 2)
  assert.strictEqual(history[0]?.id, item2.id) // item2 was added second
  assert.strictEqual(history[1]?.id, item1.id)

  // Search history
  const searchStar = await recognitionHistoryService.searchHistory('star')
  assert.strictEqual(searchStar.length, 1)
  assert.strictEqual(searchStar[0]?.title, 'Starboy')

  const searchArtist = await recognitionHistoryService.searchHistory('Weeknd')
  assert.strictEqual(searchArtist.length, 2)

  const searchNone = await recognitionHistoryService.searchHistory('Nonexistent Song')
  assert.strictEqual(searchNone.length, 0)

  // Mark as played
  await recognitionHistoryService.markAsPlayed(item1.id)
  const updatedItem1 = await recognitionHistoryService.getHistoryItem(item1.id)
  assert.strictEqual(updatedItem1?.played, true)

  // Single deletion
  const deleted = await recognitionHistoryService.deleteItem(item2.id)
  assert.strictEqual(deleted, true)

  const historyAfterDelete = await recognitionHistoryService.getHistory()
  assert.strictEqual(historyAfterDelete.length, 1)
  assert.strictEqual(historyAfterDelete[0]?.id, item1.id)

  // Clear all history
  await recognitionHistoryService.clearHistory()
  const historyAfterClear = await recognitionHistoryService.getHistory()
  assert.strictEqual(historyAfterClear.length, 0)

  // Telemetry metrics
  const metrics = recognitionHistoryService.getMetrics()
  assert.strictEqual(metrics.itemsAdded, 2)
  assert.strictEqual(metrics.itemsDeleted, 1)
  assert.strictEqual(metrics.historyCleared, 1)
  assert.strictEqual(metrics.historyPlays, 1)
})
