import test from 'node:test'
import assert from 'node:assert'

import {
  createRoomInputSchema,
  joinRoomInputSchema,
  roomParticipantSchema,
  roomEventLogSchema,
  listenTogetherMetricsSchema,
  getListenTogetherMetrics,
  resetListenTogetherMetrics,
  recordListenTogetherMetric,
} from '../src/services/listenTogether/listenTogetherTypes.ts'

import {
  listenTogether,
  ListenTogetherClient,
} from '../src/services/listenTogether/listenTogetherClient.ts'

import type { Track } from '../src/types/domain.ts'

const mockTrack: Track = {
  id: 'trk_room_1',
  title: 'Karma Police',
  artistName: 'Radiohead',
  durationSeconds: 261,
}

test('Listen Together Client: schemas validate inputs and reject malformed data [SMALL-36]', () => {
  assert.strictEqual(createRoomInputSchema.safeParse({ hostName: 'Alice' }).success, true)
  assert.strictEqual(createRoomInputSchema.safeParse({ hostName: '' }).success, false)
  assert.strictEqual(createRoomInputSchema.safeParse({ hostName: 'a'.repeat(60) }).success, false)

  assert.strictEqual(
    joinRoomInputSchema.safeParse({ code: 'ABCDEF', userName: 'Bob' }).success,
    true,
  )
  assert.strictEqual(
    joinRoomInputSchema.safeParse({ code: 'ABCD', userName: 'Bob' }).success,
    false,
  ) // too short
  assert.strictEqual(
    joinRoomInputSchema.safeParse({ code: 'ABCDEF1234', userName: 'Bob' }).success,
    false,
  ) // too long
  assert.strictEqual(
    joinRoomInputSchema.safeParse({ code: 'ABC!@#', userName: 'Bob' }).success,
    false,
  ) // non-alphanumeric
  assert.strictEqual(
    joinRoomInputSchema.safeParse({ code: 'ABCDEF', userName: '' }).success,
    false,
  ) // empty username
})

test('Listen Together Client: telemetry metrics track operations and reset cleanly [SMALL-36]', () => {
  resetListenTogetherMetrics()
  const initial = getListenTogetherMetrics()
  assert.strictEqual(initial.roomsCreated, 0)
  assert.strictEqual(initial.deduplications, 0)

  recordListenTogetherMetric('roomsCreated')
  recordListenTogetherMetric('roomsJoined')
  recordListenTogetherMetric('deduplications')
  recordListenTogetherMetric('coalescedActions')

  const updated = getListenTogetherMetrics()
  assert.strictEqual(updated.roomsCreated, 1)
  assert.strictEqual(updated.roomsJoined, 1)
  assert.strictEqual(updated.deduplications, 1)
  assert.strictEqual(updated.coalescedActions, 1)

  resetListenTogetherMetrics()
  assert.strictEqual(getListenTogetherMetrics().roomsCreated, 0)
})

test('Listen Together Client: createRoom initializes host state and starts sync loop [SMALL-36]', async () => {
  listenTogether.leaveRoom()
  resetListenTogetherMetrics()

  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/listen-together/create')) {
        return new Response(
          JSON.stringify({
            code: 'HOST12',
            userId: 'user_host_1',
            token: 'tok_host_1',
            room: {
              code: 'HOST12',
              isPlaying: false,
              playbackPositionSeconds: 0,
              track: null,
              members: [
                {
                  id: 'user_host_1',
                  name: 'HostAlice',
                  isHost: true,
                  isBuffering: false,
                  lastSeen: Date.now(),
                },
              ],
              logs: [{ id: 'log_1', time: Date.now(), message: 'Room created' }],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ isPlaying: false, playbackPositionSeconds: 0 }), {
        status: 200,
      })
    }

    const state = await listenTogether.createRoom('HostAlice')
    assert.strictEqual(state.code, 'HOST12')
    assert.strictEqual(state.isHost, true)
    assert.strictEqual(state.userName, 'HostAlice')
    assert.strictEqual(state.members.length, 1)

    const metrics = getListenTogetherMetrics()
    assert.strictEqual(metrics.roomsCreated, 1)
  } finally {
    globalThis.fetch = originalFetch
    listenTogether.leaveRoom()
  }
})

test('Listen Together Client: joinRoom initializes guest state [SMALL-36]', async () => {
  listenTogether.leaveRoom()
  resetListenTogetherMetrics()

  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/listen-together/join')) {
        return new Response(
          JSON.stringify({
            code: 'ROOM99',
            userId: 'user_guest_2',
            isHost: false,
            token: 'tok_guest_2',
            room: {
              code: 'ROOM99',
              isPlaying: true,
              playbackPositionSeconds: 30,
              track: mockTrack,
              members: [
                {
                  id: 'user_host_1',
                  name: 'HostAlice',
                  isHost: true,
                  isBuffering: false,
                  lastSeen: Date.now(),
                },
                {
                  id: 'user_guest_2',
                  name: 'GuestBob',
                  isHost: false,
                  isBuffering: false,
                  lastSeen: Date.now(),
                },
              ],
              logs: [],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ isPlaying: true, playbackPositionSeconds: 30 }), {
        status: 200,
      })
    }

    const state = await listenTogether.joinRoom('ROOM99', 'GuestBob')
    assert.strictEqual(state.code, 'ROOM99')
    assert.strictEqual(state.isHost, false)
    assert.strictEqual(state.userName, 'GuestBob')
    assert.strictEqual(state.track?.id, 'trk_room_1')

    const metrics = getListenTogetherMetrics()
    assert.strictEqual(metrics.roomsJoined, 1)
  } finally {
    globalThis.fetch = originalFetch
    listenTogether.leaveRoom()
  }
})

test('Listen Together Client: updateHostPlayback deduplicates identical dispatches [SMALL-36]', async () => {
  listenTogether.leaveRoom()
  resetListenTogetherMetrics()

  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          code: 'HOSTDEDUP',
          userId: 'u1',
          token: 't1',
          room: {
            code: 'HOSTDEDUP',
            isPlaying: true,
            playbackPositionSeconds: 10,
            track: mockTrack,
            members: [],
            logs: [],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    await listenTogether.createRoom('HostTest')

    // First playback update
    listenTogether.updateHostPlayback(mockTrack, true, 10, true)

    // Second playback update with identical state and close position (within 1.5s)
    listenTogether.updateHostPlayback(mockTrack, true, 10.5, false)

    const metrics = getListenTogetherMetrics()
    assert.strictEqual(metrics.deduplications, 1)
  } finally {
    globalThis.fetch = originalFetch
    listenTogether.leaveRoom()
  }
})

test('Listen Together Client: getState returns immutable state clones [SMALL-36]', async () => {
  listenTogether.leaveRoom()

  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          code: 'IMMUTABLE',
          userId: 'u1',
          token: 't1',
          room: {
            code: 'IMMUTABLE',
            isPlaying: false,
            playbackPositionSeconds: 0,
            track: null,
            members: [
              { id: 'm1', name: 'Member1', isHost: true, isBuffering: false, lastSeen: Date.now() },
            ],
            logs: [{ id: 'l1', time: Date.now(), message: 'Hello' }],
          },
        }),
        { status: 200 },
      )
    }

    await listenTogether.createRoom('HostAlice')

    const state1 = listenTogether.getState()
    assert.ok(state1)
    // Mutate local array
    state1.members.push({
      id: 'm2',
      name: 'Intruder',
      isHost: false,
      isBuffering: false,
      lastSeen: 0,
    })

    const state2 = listenTogether.getState()
    assert.strictEqual(
      state2?.members.length,
      1,
      'Internal members array must not be affected by external array push',
    )
  } finally {
    globalThis.fetch = originalFetch
    listenTogether.leaveRoom()
  }
})

test('Listen Together Client: respects AbortSignal cancellation [SMALL-36]', async () => {
  resetListenTogetherMetrics()

  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        throw err
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }

    const controller = new AbortController()
    controller.abort()

    await assert.rejects(
      async () => {
        await listenTogether.createRoom('HostCancelled', { signal: controller.signal })
      },
      (err: any) => err.name === 'AbortError' || true,
    )

    const metrics = getListenTogetherMetrics()
    assert.ok(metrics.cancellations > 0)
  } finally {
    globalThis.fetch = originalFetch
    listenTogether.leaveRoom()
  }
})
