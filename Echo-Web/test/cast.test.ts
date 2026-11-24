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
