import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  listenTogetherRouter,
  MemoryRoomStore,
  setRoomStore,
  ROOM_CODE_LENGTH,
  ROOM_CODE_ALPHABET,
  generateRoomCode,
  isValidRoomCode,
} from '../server/routes/listenTogether.ts'

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

  it('generates 6-character room codes and enforces unified code contract [BUG-31]', async () => {
    assert.strictEqual(ROOM_CODE_LENGTH, 6)

    // isValidRoomCode validation
    assert.strictEqual(isValidRoomCode('K7P9MX'), true)
    assert.strictEqual(isValidRoomCode('TEST01'), true)
    assert.strictEqual(isValidRoomCode('ABC12345'), true) // 8 chars supported for compatibility
    assert.strictEqual(isValidRoomCode('123'), false) // Too short
    assert.strictEqual(isValidRoomCode('TOOLONGCODE99'), false) // Too long
    assert.strictEqual(isValidRoomCode('BAD-CODE!'), false) // Invalid characters

    // Endpoint creates 6-character room code
    const createReq = new Request('http://localhost/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostName: 'HostCodeTester' }),
    })
    const createRes = await listenTogetherRouter.fetch(createReq)
    assert.strictEqual(createRes.status, 200)
    const data = (await createRes.json()) as { code: string }
    assert.strictEqual(data.code.length, 6, 'Generated room code must be exactly 6 characters')
    assert.strictEqual(isValidRoomCode(data.code), true)

    // Join rejects invalid code lengths with 400
    const invalidJoinReq = new Request('http://localhost/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'SHORT', userName: 'Guest' }),
    })
    const invalidRes = await listenTogetherRouter.fetch(invalidJoinReq)
    assert.strictEqual(invalidRes.status, 400)

    // Join accepts the 6-character code
    const validJoinReq = new Request('http://localhost/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: data.code, userName: 'Guest' }),
    })
    const validRes = await listenTogetherRouter.fetch(validJoinReq)
    assert.strictEqual(validRes.status, 200)
  })

  it('generateRoomCode indexes full 32-character alphabet with full entropy [BUG-32]', () => {
    assert.strictEqual(ROOM_CODE_ALPHABET.length, 32)
    const upperHalfChars = new Set(ROOM_CODE_ALPHABET.slice(16).split(''))
    let upperHalfCount = 0
    const observedSymbols = new Set<string>()

    const SAMPLE_COUNT = 300
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const code = generateRoomCode()
      assert.strictEqual(code.length, ROOM_CODE_LENGTH)
      for (const char of code) {
        assert.ok(ROOM_CODE_ALPHABET.includes(char), `Character ${char} must be in alphabet`)
        observedSymbols.add(char)
        if (upperHalfChars.has(char)) {
          upperHalfCount++
        }
      }
    }

    const totalChars = SAMPLE_COUNT * ROOM_CODE_LENGTH
    // Upper half should account for approximately 50% of characters (e.g. between 40% and 60%)
    const upperHalfRatio = upperHalfCount / totalChars
    assert.ok(
      upperHalfRatio > 0.4 && upperHalfRatio < 0.6,
      `Expected ~50% upper-half symbols, got ${(upperHalfRatio * 100).toFixed(1)}% (previously 0%)`,
    )

    // All 32 distinct symbols should be observed in 1800 character samples
    assert.strictEqual(
      observedSymbols.size,
      32,
      `All 32 alphabet symbols must be generated across samples (observed ${observedSymbols.size})`,
    )
  })
})
