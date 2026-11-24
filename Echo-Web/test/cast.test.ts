import test from 'node:test'
import assert from 'node:assert'
import { castService } from '../src/services/cast/castService.ts'

test('Cast Service: methods have valid signatures and handle disconnected states gracefully [BUG-13]', async () => {
  assert.strictEqual(castService.getIsConnected(), false)

  let lastConnectedState: boolean | null = null
  const unsubscribe = castService.subscribe((connected) => {
    lastConnectedState = connected
  })
  assert.strictEqual(lastConnectedState, false)

  // Calling playback operations while disconnected returns false or acts safely without throwing
  const track = { id: 'track-1', title: 'Cast Track', artistName: 'Artist', durationSeconds: 200 }
  const castRes = await castService.castTrack(track, 'https://example.com/audio.mp4', 0)
  assert.strictEqual(castRes, false)

  assert.doesNotThrow(() => {
    castService.play()
    castService.pause()
    castService.seek(15)
  })

  unsubscribe()
})

test('Cast Service: infers MIME type from stream URL or normalizes provided MIME type [BUG-14]', () => {
  assert.strictEqual(castService.inferMimeType('https://example.com/stream.mp3'), 'audio/mpeg')
  assert.strictEqual(castService.inferMimeType('https://example.com/stream.m4a?token=xyz'), 'audio/mp4')
  assert.strictEqual(castService.inferMimeType('https://example.com/stream.mp4'), 'audio/mp4')
  assert.strictEqual(castService.inferMimeType('https://example.com/stream.aac'), 'audio/aac')
  assert.strictEqual(castService.inferMimeType('https://example.com/stream.flac'), 'audio/flac')
  assert.strictEqual(castService.inferMimeType('https://example.com/stream.wav'), 'audio/wav')
  assert.strictEqual(castService.inferMimeType('https://example.com/stream.ogg'), 'audio/ogg')
  assert.strictEqual(castService.inferMimeType('https://example.com/stream.opus'), 'audio/webm')
  assert.strictEqual(castService.inferMimeType('https://example.com/stream.webm'), 'audio/webm')
  assert.strictEqual(castService.inferMimeType('https://example.com/unknown_audio'), 'audio/webm')
})

test('Cast Service: creates MediaInfo with dynamic MIME type when casting [BUG-14]', async () => {
  let createdMediaInfo: { contentId: string; contentType: string } | null = null
  let loadedRequest: { mediaInfo: unknown; currentTime: number; autoplay: boolean } | null = null

  class MockMediaInfo {
    contentId: string
    contentType: string
    metadata: unknown = null
    streamType = ''
    constructor(contentId: string, contentType: string) {
      this.contentId = contentId
      this.contentType = contentType
      createdMediaInfo = { contentId, contentType }
    }
  }

  class MockLoadRequest {
    mediaInfo: unknown
    currentTime = 0
    autoplay = false
    constructor(mediaInfo: unknown) {
      this.mediaInfo = mediaInfo
    }
  }

  // Setup mock global window with cast framework
  const originalWindow = globalThis.window
  ;(globalThis as unknown as { window: unknown }).window = {
    location: { origin: 'http://localhost:5173' },
    cast: {
      framework: {
        CastContext: {
          getInstance: () => ({
            getCurrentSession: () => ({
              loadMedia: async (req: MockLoadRequest) => {
                loadedRequest = {
                  mediaInfo: req.mediaInfo,
                  currentTime: req.currentTime,
                  autoplay: req.autoplay,
                }
                return req
              },
            }),
          }),
        },
      },
    },
    chrome: {
      cast: {
        media: {
          MediaInfo: MockMediaInfo,
          LoadRequest: MockLoadRequest,
          MetadataType: { MUSIC_TRACK: 1 },
          StreamType: { BUFFERED: 'BUFFERED' },
        },
      },
    },
  }

  try {
    // Manually mark connected for test
    ;(castService as unknown as { isConnected: boolean }).isConnected = true

    const track = {
      id: 'track-dynamic',
      title: 'Dynamic Track',
      artistName: 'Artist',
      durationSeconds: 180,
      artwork: 'https://example.com/art.jpg',
    }

    // 1. Explicit MIME type (e.g. from stream resolution "audio/mp4; codecs=mp4a.40.2")
    await castService.castTrack(track, '/api/stream/listen?videoId=123', 10, 'audio/mp4; codecs="mp4a.40.2"')
    assert.ok(createdMediaInfo)
    assert.strictEqual(createdMediaInfo.contentType, 'audio/mp4')
    assert.strictEqual(createdMediaInfo.contentId, 'http://localhost:5173/api/stream/listen?videoId=123')
    assert.strictEqual(loadedRequest?.currentTime, 10)

    // 2. Inferred MIME type from URL extension
    await castService.castTrack(track, 'https://cdn.example.com/audio.flac', 0)
    assert.strictEqual(createdMediaInfo.contentType, 'audio/flac')
    assert.strictEqual(createdMediaInfo.contentId, 'https://cdn.example.com/audio.flac')

    // 3. Fallback when unspecified
    await castService.castTrack(track, 'https://cdn.example.com/audio.webm', 0)
    assert.strictEqual(createdMediaInfo.contentType, 'audio/webm')
  } finally {
    ;(castService as unknown as { isConnected: boolean }).isConnected = false
    ;(globalThis as unknown as { window: unknown }).window = originalWindow
  }
})

test('Cast Service: requestSession waits for SDK readiness instead of failing immediately [BUG-30]', async () => {
  const originalWindow = globalThis.window
  let sessionRequested = false

  // Simulate environment where Cast SDK is not initially loaded
  const mockWindow: Record<string, unknown> = {
    location: { origin: 'http://localhost:5173' },
  }
  ;(globalThis as unknown as { window: unknown }).window = mockWindow

  // Reset internal castService state for testing
  const cast = castService as unknown as {
    isLoaded: boolean
    isConnected: boolean
    readyPromise: Promise<boolean> | null
    readyResolvers: Array<(ready: boolean) => void>
  }
  cast.isLoaded = false
  cast.isConnected = false
  cast.readyPromise = null
  cast.readyResolvers = []

  assert.strictEqual(castService.isSdkReady(), false)

  // Start requesting session in the background
  const sessionPromise = castService.requestSession(2000)

  // Simulate Cast framework arriving asynchronously via __onGCastApiAvailable
  mockWindow.cast = {
    framework: {
      CastContext: {
        getInstance: () => ({
          setOptions: () => {},
          addEventListener: () => {},
          requestSession: async () => {
            sessionRequested = true
            return {}
          },
          endCurrentSession: async () => {},
        }),
      },
      CastState: { CONNECTED: 'CONNECTED' },
      CastContextEventType: { CAST_STATE_CHANGED: 'CAST_STATE_CHANGED' },
    },
  }

  // Trigger global SDK callback
  const onAvailable = mockWindow.__onGCastApiAvailable as ((available: boolean) => void) | undefined
  assert.ok(typeof onAvailable === 'function', '__onGCastApiAvailable callback should be registered')
  onAvailable(true)

  const success = await sessionPromise
  assert.strictEqual(success, true)
  assert.strictEqual(sessionRequested, true)
  assert.strictEqual(castService.isSdkReady(), true)
  assert.strictEqual(castService.getIsConnected(), true)

  // Disconnect should end session and update state
  await castService.disconnect()
  assert.strictEqual(castService.getIsConnected(), false)

  ;(globalThis as unknown as { window: unknown }).window = originalWindow
})

import { castTrackInputSchema, castPayloadSchema } from '../src/services/cast/castService.ts'

test('Cast Service: schema validation rejects malformed payloads and unsafe URLs [SMALL-07]', async () => {
  // 1. Valid track
  assert.strictEqual(castTrackInputSchema.safeParse({ id: 't1', title: 'Song' }).success, true)
  // Missing id or title
  assert.strictEqual(castTrackInputSchema.safeParse({ id: '', title: 'Song' }).success, false)
  assert.strictEqual(castTrackInputSchema.safeParse({ id: 't1', title: '' }).success, false)

  // 2. Stream URL validation: allow http, https, and relative; reject javascript: or data:
  assert.strictEqual(castPayloadSchema.safeParse({ streamUrl: 'https://cdn.example.com/audio.mp3', currentTime: 10 }).success, true)
  assert.strictEqual(castPayloadSchema.safeParse({ streamUrl: '/api/stream/listen?v=123', currentTime: 0 }).success, true)
  assert.strictEqual(castPayloadSchema.safeParse({ streamUrl: 'javascript:alert(1)', currentTime: 0 }).success, false)
  assert.strictEqual(castPayloadSchema.safeParse({ streamUrl: '', currentTime: 0 }).success, false)

  // 3. Rejected castTrack invocation with invalid track
  castService.resetMetrics()
  // @ts-expect-error testing invalid track
  const castResult = await castService.castTrack({ id: '', title: '' }, 'https://example.com/audio.mp3', 0)
  assert.strictEqual(castResult, false)
  const metrics = castService.getMetrics()
  assert.strictEqual(metrics.castErrors, 1)
  assert.ok(metrics.lastError)
})

test('Cast Service: requestSession deduplication and connection state subscription [SMALL-07]', async () => {
  const originalWindow = globalThis.window
  let capturedState = ''
  const unsub = castService.subscribeState((state) => {
    capturedState = state
  })

  ;(globalThis as unknown as { window: unknown }).window = {
    location: { origin: 'http://localhost:5173' },
    cast: {
      framework: {
        CastContext: {
          getInstance: () => ({
            setOptions: () => {},
            addEventListener: () => {},
            requestSession: () => new Promise((resolve) => setTimeout(resolve, 50)),
            endCurrentSession: async () => {},
          }),
        },
        CastState: { CONNECTED: 'CONNECTED' },
        CastContextEventType: { CAST_STATE_CHANGED: 'CAST_STATE_CHANGED' },
      },
    },
  }

  // Ensure isLoaded
  ;(castService as unknown as { isLoaded: boolean }).isLoaded = true

  // Fire two concurrent requestSession calls
  const req1 = castService.requestSession(2000)
  const req2 = castService.requestSession(2000)
  assert.strictEqual(req1, req2, 'Concurrent requestSession calls return the identical in-flight promise')

  const [res1, res2] = await Promise.all([req1, req2])
  assert.strictEqual(res1, true)
  assert.strictEqual(res2, true)
  assert.strictEqual(capturedState, 'CONNECTED')
  assert.strictEqual(castService.getConnectionState(), 'CONNECTED')

  unsub()
  await castService.disconnect()
  assert.strictEqual(castService.getConnectionState(), 'NOT_CONNECTED')
  ;(globalThis as unknown as { window: unknown }).window = originalWindow
})

