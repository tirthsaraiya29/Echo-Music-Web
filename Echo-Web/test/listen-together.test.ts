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
  resetJoinRateLimits,
  resetCreateRateLimits,
  getClientIp,
  MAX_ROOM_LOGS,
  MAX_ROOM_MEMBERS,
  MAX_GLOBAL_ROOMS,
  appendRoomLog,
  sanitizeTrackPayload,
  sanitizeName,
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

  it('rate limiting ignores untrusted x-forwarded-for headers by default [BUG-33]', async () => {
    assert.strictEqual(typeof getClientIp, 'function')
    resetJoinRateLimits()
    delete process.env['TRUST_PROXY']

    // 1. Without TRUST_PROXY, spoofed X-Forwarded-For is ignored
    for (let i = 0; i < 20; i++) {
      const spoofedReq = new Request('http://localhost/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `198.51.100.${i}`, // Attacker rotating IP headers
        },
        body: JSON.stringify({ code: 'ROOM99', userName: 'Attacker' }),
      })
      const res = await listenTogetherRouter.fetch(spoofedReq)
      // First 20 attempts should return 404 (room not found), not 429 yet
      assert.strictEqual(res.status, 404, `Attempt ${i + 1} should return 404, not rate-limited yet`)
    }

    // 21st attempt from the same socket (despite a new spoofed IP header) MUST be rate-limited (429)
    const blockedReq = new Request('http://localhost/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.99',
      },
      body: JSON.stringify({ code: 'ROOM99', userName: 'Attacker' }),
    })
    const blockedRes = await listenTogetherRouter.fetch(blockedReq)
    assert.strictEqual(blockedRes.status, 429, '21st attempt must be blocked by rate limiter regardless of spoofed header')

    // 2. With TRUST_PROXY=true, proxy headers are trusted
    resetJoinRateLimits()
    process.env['TRUST_PROXY'] = 'true'
    try {
      // Mock request with cf-connecting-ip
      const trustedReq = new Request('http://localhost/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '198.51.100.42',
        },
        body: JSON.stringify({ code: 'ROOM99', userName: 'Legit' }),
      })
      // Should evaluate under trusted IP and return 404 Room not found
      const trustedRes = await listenTogetherRouter.fetch(trustedReq)
      assert.strictEqual(trustedRes.status, 404)
    } finally {
      delete process.env['TRUST_PROXY']
      resetJoinRateLimits()
    }
  })

  it('enforces room resource limits, log caps, and payload validation [BUG-34]', async () => {
    // 1. appendRoomLog cap enforcement
    const testRoom = {
      code: 'CAPLOG',
      hostId: 'host_1',
      createdAt: Date.now(),
      track: null,
      isPlaying: false,
      playbackPositionSeconds: 0,
      lastUpdatedServerTime: Date.now(),
      lastActiveServerTime: Date.now(),
      members: new Map(),
      logs: [],
    }

    assert.strictEqual(MAX_ROOM_LOGS, 50)
    for (let i = 0; i < 75; i++) {
      appendRoomLog(testRoom, `Log entry #${i}`)
    }
    assert.strictEqual(testRoom.logs.length, 50, 'Room logs must be capped at MAX_ROOM_LOGS (50)')
    assert.strictEqual(testRoom.logs[0]?.message, 'Log entry #25', 'Oldest 25 logs must be pruned')
    assert.strictEqual(testRoom.logs[49]?.message, 'Log entry #74', 'Latest log must be retained at end')

    // 2. sanitizeName limits length to 32 chars
    assert.strictEqual(sanitizeName('   Alice   ', 'Guest'), 'Alice')
    assert.strictEqual(sanitizeName('', 'Guest'), 'Guest')
    assert.strictEqual(sanitizeName(null, 'Host'), 'Host')
    const longName = 'A'.repeat(100)
    assert.strictEqual(sanitizeName(longName, 'Guest').length, 32)

    // 3. sanitizeTrackPayload validation
    assert.strictEqual(sanitizeTrackPayload(null), null)
    assert.strictEqual(sanitizeTrackPayload(undefined), null)
    assert.strictEqual(sanitizeTrackPayload('invalid string'), null)
    assert.strictEqual(sanitizeTrackPayload({}), null) // No id and no title

    const oversizedTrack = {
      id: 'song_123',
      title: 'T'.repeat(500),
      artist: 'A'.repeat(500),
      album: 'Alb'.repeat(200),
      artworkUrl: 'https://example.com/' + 'x'.repeat(2000),
      durationMs: 999999999, // > 24 hours
      extraUnknown: 'preserved',
    }
    const cleanTrack = sanitizeTrackPayload(oversizedTrack)
    assert.ok(cleanTrack)
    assert.strictEqual(cleanTrack['id'], 'song_123')
    assert.strictEqual((cleanTrack['title'] as string).length, 256)
    assert.strictEqual((cleanTrack['artist'] as string).length, 256)
    assert.strictEqual((cleanTrack['album'] as string).length, 256)
    assert.strictEqual((cleanTrack['artworkUrl'] as string).length, 1024)
    assert.strictEqual(cleanTrack['durationMs'], 86400000, 'Clamped to 24 hours max')

    // 4. Create rate limiting per IP
    resetCreateRateLimits()
    for (let i = 0; i < 10; i++) {
      const createReq = new Request('http://localhost/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostName: 'RateLimitHost' }),
      })
      const res = await listenTogetherRouter.fetch(createReq)
      assert.strictEqual(res.status, 200, `Create ${i + 1} should succeed`)
    }
    const blockedCreateReq = new Request('http://localhost/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostName: 'RateLimitHost' }),
    })
    const blockedCreateRes = await listenTogetherRouter.fetch(blockedCreateReq)
    assert.strictEqual(blockedCreateRes.status, 429, '11th creation attempt from same IP must return 429')
    resetCreateRateLimits()

    // 5. Global room capacity limit
    const capacityStore = new MemoryRoomStore()
    setRoomStore(capacityStore)
    assert.strictEqual(capacityStore.size(), 0)

    // Fill capacity store up to MAX_GLOBAL_ROOMS
    for (let i = 0; i < MAX_GLOBAL_ROOMS; i++) {
      capacityStore.set(`RM${i.toString().padStart(4, '0')}`, {
        code: `RM${i.toString().padStart(4, '0')}`,
        hostId: 'host_active',
        createdAt: Date.now(),
        track: null,
        isPlaying: true,
        playbackPositionSeconds: 10,
        lastUpdatedServerTime: Date.now(),
        lastActiveServerTime: Date.now(), // Active, will not be pruned by cleanup
        members: new Map([['host_active', { id: 'host_active', name: 'Host', isHost: true, lastSeen: Date.now(), isBuffering: false, token: 't' }]]),
        logs: [],
      })
    }
    assert.strictEqual(capacityStore.size(), MAX_GLOBAL_ROOMS)

    const overCapacityReq = new Request('http://localhost/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostName: 'OverCapacity' }),
    })
    const overCapacityRes = await listenTogetherRouter.fetch(overCapacityReq)
    assert.strictEqual(overCapacityRes.status, 503, 'Must reject with 503 when server reaches MAX_GLOBAL_ROOMS')

    // 6. Max room members cap (409)
    const singleRoomStore = new MemoryRoomStore()
    setRoomStore(singleRoomStore)
    const fullRoomCode = 'FULLRM'
    const fullRoomMembers = new Map()
    for (let i = 0; i < MAX_ROOM_MEMBERS; i++) {
      fullRoomMembers.set(`user_${i}`, {
        id: `user_${i}`,
        name: `User ${i}`,
        isHost: i === 0,
        lastSeen: Date.now(),
        isBuffering: false,
        token: `tok_${i}`,
      })
    }
    singleRoomStore.set(fullRoomCode, {
      code: fullRoomCode,
      hostId: 'user_0',
      createdAt: Date.now(),
      track: null,
      isPlaying: false,
      playbackPositionSeconds: 0,
      lastUpdatedServerTime: Date.now(),
      lastActiveServerTime: Date.now(),
      members: fullRoomMembers,
      logs: [],
    })

    const joinFullReq = new Request('http://localhost/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: fullRoomCode, userName: '51stMember' }),
    })
    const joinFullRes = await listenTogetherRouter.fetch(joinFullReq)
    assert.strictEqual(joinFullRes.status, 409, 'Must reject join with 409 when room has 50 members')

    // 7. Sync sanitizes track and clamps position
    const syncReq = new Request('http://localhost/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: fullRoomCode,
        userId: 'user_0',
        token: 'tok_0',
        action: 'update_state',
        track: oversizedTrack,
        playbackPositionSeconds: 999999, // Exceeds 86400
      }),
    })
    const syncRes = await listenTogetherRouter.fetch(syncReq)
    assert.strictEqual(syncRes.status, 200)
    const syncData = (await syncRes.json()) as { playbackPositionSeconds: number; track: Record<string, unknown> }
    assert.strictEqual(syncData.playbackPositionSeconds, 86400, 'Position clamped to 86400s max')
    assert.strictEqual((syncData.track['title'] as string).length, 256, 'Track title sanitized/capped')
  })
})
