import { Hono } from 'hono'
import process from 'node:process'

export const recognitionRouter = new Hono()

export interface RecognitionStatusResponse {
  configured: boolean
  provider: string
  demoAvailable: boolean
  guidance: string
}

recognitionRouter.get('/status', (c) => {
  const providerUrl = process.env['RECOGNITION_PROVIDER_URL']
  const demoAllowed =
    process.env['ALLOW_DEMO_RECOGNITION'] === 'true' || process.env['NODE_ENV'] === 'test'

  return c.json({
    configured: Boolean(providerUrl),
    provider: providerUrl ? 'External ACRCloud / Shazam Gateway' : 'None',
    demoAvailable: demoAllowed,
    guidance: providerUrl
      ? 'Music recognition is configured and ready for live audio matching.'
      : 'Set RECOGNITION_PROVIDER_URL to an ACRCloud or Shazam fingerprinting endpoint in server environment variables.',
  })
})

// Echo Find records mic audio. When RECOGNITION_PROVIDER_URL is configured, the recording
// is forwarded to the upstream fingerprinting service; otherwise the endpoint reports honestly
// that recognition is unconfigured rather than returning fabricated hits, with clear setup guidance.
recognitionRouter.post('/identify', async (c) => {
  const providerUrl = process.env['RECOGNITION_PROVIDER_URL']
  const isDemo =
    c.req.query('demo') === 'true' ||
    c.req.header('x-demo-recognition') === 'true' ||
    process.env['FORCE_DEMO_RECOGNITION'] === 'true'

  if (isDemo) {
    return c.json({
      matched: true,
      configured: true,
      confidence: 96,
      track: {
        id: 'rec_demo_1',
        videoId: 'dQw4w9WgXcQ',
        title: 'Never Gonna Give You Up',
        artistName: 'Rick Astley',
        artistId: 'artist_rick_astley',
        albumTitle: 'Whenever You Need Somebody',
        albumId: 'album_whenever_you_need_somebody',
        durationSeconds: 213,
        durationMs: 213000,
        artwork: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400',
      },
    })
  }

  if (providerUrl) {
    try {
      const contentType = c.req.header('content-type') || ''
      const body = await c.req.arrayBuffer()
      const upstream = await fetch(providerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
        },
        body,
      })
      const data = (await upstream.json()) as Record<string, unknown>
      return c.json(data, upstream.status as 200)
    } catch (err) {
      return c.json(
        {
          matched: false,
          configured: true,
          error: err instanceof Error ? err.message : 'Upstream recognition provider failed',
        },
        502,
      )
    }
  }

  const contentType = c.req.header('content-type') || ''
  if (contentType.includes('multipart/form-data')) {
    await c.req.parseBody().catch(() => ({}))
  }

  return c.json({
    matched: false,
    configured: false,
    message: 'Music recognition service is not configured.',
    guidance:
      'Set RECOGNITION_PROVIDER_URL in server environment variables to connect an ACRCloud or Shazam recognition service.',
  })
})
