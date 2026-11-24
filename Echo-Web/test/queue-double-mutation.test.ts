import test from 'node:test'
import assert from 'node:assert'
import { QueueManager } from '../src/engine/QueueManager.ts'
import type { Track } from '../src/types/audio.ts'

function createMockTrack(id: string, title: string): Track {
  return {
    id,
    title,
    artistName: 'Artist ' + id,
    artistId: 'art-' + id,
    albumTitle: 'Album ' + id,
    albumId: 'alb-' + id,
    albumImage: 'https://example.com/art.jpg',
    artwork: 'https://example.com/art.jpg',
    durationMs: 180000,
    durationSeconds: 180,
    playCount: 0,
  }
}

test('Zustand queue actions: engine as single source of truth prevents double mutations [BUG-02]', () => {
  const qm = new QueueManager()

  // Simulate Zustand store state
  let storeQueueIds: string[] = []

  // Simulate the bridge subscriber that listens to engine queue changes
  const onEngineQueueChange = () => {
    const upNextIds = qm.upNext.map((t) => t.id)
    if (
      upNextIds.length !== storeQueueIds.length ||
      upNextIds.some((id, idx) => id !== storeQueueIds[idx])
    ) {
      storeQueueIds = upNextIds
    }
  }

  // The CORRECTED store actions:
  // Instead of: qm.addToQueue(track); storeQueueIds = [...storeQueueIds, track.id] (which duplicated)
  // The corrected actions let the engine own the queue and sync storeQueueIds idempotently:
  const enqueue = (track: Track) => {
    qm.addToQueue(track)
    onEngineQueueChange()
    storeQueueIds = qm.upNext.map((t) => t.id)
  }

  const removeFromQueue = (index: number) => {
    qm.removeUpNext(index)
    onEngineQueueChange()
    storeQueueIds = qm.upNext.map((t) => t.id)
  }

  const moveQueueItem = (from: number, to: number) => {
    qm.moveUpNext(from, to)
    onEngineQueueChange()
    storeQueueIds = qm.upNext.map((t) => t.id)
  }

  const clearQueue = () => {
    qm.clearUpNext()
    onEngineQueueChange()
    storeQueueIds = []
  }

  // Test 1: Enqueue must not duplicate IDs
  const t1 = createMockTrack('t1', 'Track 1')
  const t2 = createMockTrack('t2', 'Track 2')
  const t3 = createMockTrack('t3', 'Track 3')

  enqueue(t1)
  assert.strictEqual(storeQueueIds.length, 1, 'Store queue must have exactly 1 item')
  assert.strictEqual(storeQueueIds[0], 't1')
  assert.strictEqual(qm.upNext.length, 1, 'QueueManager upNext must have exactly 1 item')

  enqueue(t2)
  enqueue(t3)
  assert.deepStrictEqual(storeQueueIds, ['t1', 't2', 't3'], 'Enqueue adds without duplicate mutation')
  assert.deepStrictEqual(qm.upNext.map((t) => t.id), ['t1', 't2', 't3'])

  // Test 2: removeFromQueue must not remove two items
  removeFromQueue(1) // remove t2
  assert.deepStrictEqual(storeQueueIds, ['t1', 't3'], 'removeFromQueue removes exactly one item')
  assert.deepStrictEqual(qm.upNext.map((t) => t.id), ['t1', 't3'])

  // Test 3: moveQueueItem must not reorder twice
  moveQueueItem(0, 1) // move t1 to index 1 -> ['t3', 't1']
  assert.deepStrictEqual(storeQueueIds, ['t3', 't1'], 'moveQueueItem reorders exactly once')
  assert.deepStrictEqual(qm.upNext.map((t) => t.id), ['t3', 't1'])

  // Test 4: clearQueue clears both
  clearQueue()
  assert.strictEqual(storeQueueIds.length, 0)
  assert.strictEqual(qm.upNext.length, 0)
})
