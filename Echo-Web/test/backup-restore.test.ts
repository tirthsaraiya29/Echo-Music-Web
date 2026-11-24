import test from 'node:test'
import assert from 'node:assert'

if (typeof globalThis.localStorage === 'undefined') {
  const mem = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, val: string) => mem.set(key, String(val)),
    removeItem: (key: string) => mem.delete(key),
    clear: () => mem.clear(),
    key: (i: number) => Array.from(mem.keys())[i] ?? null,
    length: 0,
  } as unknown as Storage
}

import { exportFullBackup, importFullBackup } from '../src/services/db/echoDatabase.ts'

test('Backup & Restore: exportFullBackup incorporates canonical playlists and importFullBackup returns restoredPlaylists [BUG-11]', async () => {
  const dummyPlaylists = [
    {
      id: 'pl-1',
      title: 'Roadtrip Anthems',
      description: 'Songs for driving',
      image: 'https://example.com/cover.jpg',
      trackIds: ['t1', 't2', 't3'],
      createdAt: 1700000000000,
    },
    {
      id: 'pl-2',
      title: 'Late Night Coding',
      description: 'Lo-fi beats',
      trackIds: ['t4'],
      createdAt: 1700001000000,
    },
  ]

  const preferences = { themeMode: 'dark', accentColor: 'violet' }
  const likedTrackIds = ['t1', 't5']

  // Export full backup with canonical playlists
  const backupJson = await exportFullBackup(preferences, likedTrackIds, dummyPlaylists)
  assert.ok(backupJson)

  const parsed = JSON.parse(backupJson) as {
    version: number
    playlists: Array<{ id: string; title: string; trackIds: string[] }>
    likedTrackIds: string[]
  }

  assert.strictEqual(parsed.version, 1)
  assert.strictEqual(parsed.playlists.length >= 2, true)
  const p1 = parsed.playlists.find((p) => p.id === 'pl-1')
  assert.ok(p1)
  assert.strictEqual(p1.title, 'Roadtrip Anthems')
  assert.deepStrictEqual(p1.trackIds, ['t1', 't2', 't3'])

  // Import full backup
  const restoreResult = await importFullBackup(backupJson, 'merge')
  assert.strictEqual(restoreResult.playlistsRestored >= 2, true)
  assert.ok(restoreResult.restoredPlaylists.length >= 2)
  const restoredP1 = restoreResult.restoredPlaylists.find((p) => p.id === 'pl-1')
  assert.ok(restoredP1)
  assert.strictEqual(restoredP1.title, 'Roadtrip Anthems')
  assert.deepStrictEqual(restoredP1.trackIds, ['t1', 't2', 't3'])
})

test('History clearing: clearRecentHistory and QueueManager.clearHistory clear all recent projections [BUG-12]', async () => {
  const { useEchoStore } = await import('../src/stores/useEchoStore.ts')
  const { QueueManager } = await import('../src/engine/QueueManager.ts')

  // Populate store and queue with history
  useEchoStore.setState({
    recentlyPlayedIds: ['track-1', 'track-2'],
    recentItems: [
      { id: 'track-1', kind: 'track', title: 'Song 1', subtitle: 'Artist', image: '', at: Date.now() },
    ],
  })

  const qm = new QueueManager([
    { id: 'track-1', title: 'Song 1', artistName: 'Artist', durationSeconds: 100 },
    { id: 'track-2', title: 'Song 2', artistName: 'Artist', durationSeconds: 120 },
  ], 0)
  qm.next()
  assert.strictEqual(qm.history.length, 1)

  // Clear history projections
  useEchoStore.getState().clearRecentHistory()
  qm.clearHistory()

  assert.deepStrictEqual(useEchoStore.getState().recentlyPlayedIds, [])
  assert.deepStrictEqual(useEchoStore.getState().recentItems, [])
  assert.deepStrictEqual(qm.history, [])
})
