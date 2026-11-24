import test from 'node:test'
import assert from 'node:assert'
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
