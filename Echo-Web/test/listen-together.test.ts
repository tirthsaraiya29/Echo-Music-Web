import { describe, it } from 'node:test'
import assert from 'node:assert'
import { listenTogetherRouter, MemoryRoomStore, setRoomStore } from '../server/routes/listenTogether.ts'

describe('Listen Together Room Storage & Endpoints', () => {
  it('MemoryRoomStore performs CRUD and stale cleanup operations', async () => {
    const store = new MemoryRoomStore()
    const dummyRoom = {
      code: 'TESTROOM',
      hostId: 'host_1',
      createdAt: Date.now(),
      track: null,
      isPlaying: false,
      playbackPositionSeconds: 0,
      lastUpdatedServerTime: Date.now() - 40 * 60 * 1000, // 40m ago
      members: new Map(),
      logs: [],
    }

    store.set('TESTROOM', dummyRoom)
    assert.strictEqual(await store.has('TESTROOM'), true)
    assert.strictEqual((await store.get('TESTROOM'))?.code, 'TESTROOM')

    // Stale cleanup (> 30m)
    const pruned = await store.cleanup(30 * 60 * 1000)
    assert.strictEqual(pruned, 1)
    assert.strictEqual(await store.has('TESTROOM'), false)
  })

  it('allows plugging custom RoomStore implementation', async () => {
    const customStore = new MemoryRoomStore()
    setRoomStore(customStore)

    // Test creating a room via router
    const createReq = new Request('http://localhost/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostName: 'HostAlice' }),
    })

    const res = await listenTogetherRouter.fetch(createReq)
    assert.strictEqual(res.status, 200)
    const data = (await res.json()) as { code: string; userId: string; token: string; room: { code: string } }
    assert.ok(data.code)
    assert.strictEqual(data.room.code, data.code)
    assert.strictEqual(await customStore.has(data.code), true)
  })
})
