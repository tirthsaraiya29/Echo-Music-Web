import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  getOrFetchVideoInfo,
  clearInfoCache,
  setCustomYtdlGetInfo,
  streamRouter,
} from '../server/routes/stream.ts'

describe('Stream Info Request Deduplication [BUG-36]', () => {
  it('deduplicates concurrent requests for the same video and quality to a single getInfo call', async () => {
    clearInfoCache()
    let getInfoCallCount = 0

    const mockInfo = {
      formats: [
        {
          itag: 251,
          mimeType: 'audio/webm; codecs="opus"',
          bitrate: 160000,
          contentLength: '5242880',
          hasAudio: true,
          hasVideo: false,
        },
      ],
      videoDetails: {
        title: 'Dedup Song',
        author: { name: 'Dedup Artist' },
        lengthSeconds: '210',
      },
    }

    setCustomYtdlGetInfo(async (videoId: string) => {
      getInfoCallCount++
      // Simulate network latency
      await new Promise((resolve) => setTimeout(resolve, 40))
      return { ...mockInfo, videoDetails: { ...mockInfo.videoDetails, title: `Title ${videoId}` } }
    })

    try {
      // Launch 10 concurrent requests for the exact same videoId and quality
      const requests = Array.from({ length: 10 }, () =>
        getOrFetchVideoInfo('video12345a', 'high'),
      )

      const results = await Promise.all(requests)

      // Exactly 1 getInfo call was made
      assert.strictEqual(getInfoCallCount, 1, 'Concurrent calls must deduplicate to 1 underlying getInfo fetch')

      // All 10 callers received the identical metadata
      for (const res of results) {
        assert.strictEqual(res.title, 'Title video12345a')
        assert.strictEqual(res.format.itag, 251)
        assert.strictEqual(res.totalBytes, 5242880)
      }

      // Subsequent call uses LRU cache and does NOT call getInfo again
      const cached = await getOrFetchVideoInfo('video12345a', 'high')
      assert.strictEqual(getInfoCallCount, 1, 'Subsequent read must be served from cache without extra getInfo calls')
      assert.strictEqual(cached.title, 'Title video12345a')
    } finally {
      setCustomYtdlGetInfo(null)
      clearInfoCache()
    }
  })

  it('deduplicates concurrent requests across different qualities for the same videoId', async () => {
    clearInfoCache()
    let getInfoCallCount = 0

    const mockInfo = {
      formats: [
        {
          itag: 251,
          mimeType: 'audio/webm; codecs="opus"',
          bitrate: 160000,
          contentLength: '5000000',
          hasAudio: true,
          hasVideo: false,
        },
        {
          itag: 140,
          mimeType: 'audio/mp4; codecs="mp4a.40.2"',
          bitrate: 128000,
          contentLength: '4000000',
          hasAudio: true,
          hasVideo: false,
        },
      ],
      videoDetails: {
        title: 'Multi Quality Song',
        author: { name: 'Artist' },
        lengthSeconds: '180',
      },
    }

    setCustomYtdlGetInfo(async () => {
      getInfoCallCount++
      await new Promise((resolve) => setTimeout(resolve, 30))
      return mockInfo
    })

    try {
      // Concurrently request 'high' (itag 251) and 'low' (itag 140) for same videoId
      const [highRes, lowRes] = await Promise.all([
        getOrFetchVideoInfo('multiQual12', 'high'),
        getOrFetchVideoInfo('multiQual12', 'low'),
      ])

      // ytdl.getInfo called only once despite different qualities requested
      assert.strictEqual(getInfoCallCount, 1, 'Concurrent requests for same video with different qualities must share ytdl.getInfo')
      assert.strictEqual(highRes.format.itag, 251)
      assert.strictEqual(lowRes.format.itag, 140)
    } finally {
      setCustomYtdlGetInfo(null)
      clearInfoCache()
    }
  })

  it('cleans up in-flight promise map on failure so subsequent calls can retry', async () => {
    clearInfoCache()
    let attempt = 0

    setCustomYtdlGetInfo(async () => {
      attempt++
      if (attempt === 1) {
        throw new Error('Temporary network glitch')
      }
      return {
        formats: [{ itag: 251, hasAudio: true, hasVideo: false, contentLength: '100' }],
        videoDetails: { title: 'Recovered' },
      }
    })

    try {
      // First attempt fails
      await assert.rejects(
        () => getOrFetchVideoInfo('retryVid123', 'high'),
        /Temporary network glitch/,
      )

      // In-flight promise was cleaned up, second attempt retries and succeeds
      const recovered = await getOrFetchVideoInfo('retryVid123', 'high')
      assert.strictEqual(recovered.title, 'Recovered')
      assert.strictEqual(attempt, 2)
    } finally {
      setCustomYtdlGetInfo(null)
      clearInfoCache()
    }
  })

  it('stream /resolve endpoint deduplicates concurrent HTTP requests', async () => {
    clearInfoCache()
    let endpointGetInfoCount = 0

    setCustomYtdlGetInfo(async () => {
      endpointGetInfoCount++
      await new Promise((resolve) => setTimeout(resolve, 30))
      return {
        formats: [{ itag: 251, hasAudio: true, hasVideo: false, contentLength: '2000' }],
        videoDetails: { title: 'Router Dedup' },
      }
    })

    try {
      const p1 = streamRouter.fetch(new Request('http://localhost/resolve?videoId=abcdef12345'))
      const p2 = streamRouter.fetch(new Request('http://localhost/resolve?videoId=abcdef12345'))
      const [res1, res2] = await Promise.all([p1, p2])

      assert.strictEqual(res1.status, 200)
      assert.strictEqual(res2.status, 200)
      assert.strictEqual(endpointGetInfoCount, 1, 'Router-level concurrent requests must collapse to 1 fetch')
    } finally {
      setCustomYtdlGetInfo(null)
      clearInfoCache()
    }
  })
})
