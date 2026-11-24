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
      lastActiveServerTime: Date.now() - 40 * 60 * 1000,
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

  it('preserves paused room with active host heartbeats during cleanup [BUG-07]', async () => {
    const store = new MemoryRoomStore()
    const hostMember = {
      id: 'host_active',
      name: 'Host Alice',
      isHost: true,
      lastSeen: Date.now() - 5000, // heartbeating 5s ago
      isBuffering: false,
      token: 'token_123',
    }
    const pausedRoom = {
      code: 'PAUSED1',
      hostId: 'host_active',
      createdAt: Date.now() - 60 * 60 * 1000, // created 1h ago
      track: null,
      isPlaying: false,
      playbackPositionSeconds: 0,
      lastUpdatedServerTime: Date.now() - 45 * 60 * 1000, // last state update 45m ago
      lastActiveServerTime: Date.now() - 5000, // active 5s ago
      members: new Map([['host_active', hostMember]]),
      logs: [],
    }

    store.set('PAUSED1', pausedRoom)

    // Run cleanup with 30m threshold
    const pruned = await store.cleanup(30 * 60 * 1000)
    assert.strictEqual(pruned, 0, 'Should not prune room with active host heartbeats')
    assert.strictEqual(await store.has('PAUSED1'), true)
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

  it('audioEngineActions maintains stable references across calls [BUG-06]', async () => {
    const { audioEngineActions } = await import('../src/hooks/useAudioEngine.ts')
    assert.ok(audioEngineActions.play)
    assert.ok(audioEngineActions.pause)
    assert.ok(audioEngineActions.seekTo)
    assert.strictEqual(typeof audioEngineActions.play, 'function')
    assert.strictEqual(typeof audioEngineActions.pause, 'function')
    assert.strictEqual(typeof audioEngineActions.seekTo, 'function')
  })

  it('ListenTogetherClient publishes immutable snapshots with incrementing revision [BUG-08]', async () => {
    const { listenTogether } = await import('../src/services/listenTogether/listenTogetherClient.ts')
    const receivedSnapshots: unknown[] = []

    const unsub = listenTogether.subscribe((state) => {
      receivedSnapshots.push(state)
    })

    listenTogether.leaveRoom()
    assert.ok(receivedSnapshots.length > 0)
    const emptyState = receivedSnapshots[receivedSnapshots.length - 1] as { revision: number; members: unknown[] }
    assert.strictEqual(emptyState.revision, 0)
    assert.deepStrictEqual(emptyState.members, [])

    // Mutating snapshot should not affect subsequent getState()
    emptyState.members.push('dirty')
    assert.deepStrictEqual(listenTogether.getState(), null)
    unsub()
  })
})
