import { Hono } from 'hono'
import process from 'node:process'
import crypto from 'node:crypto'

export const recognitionRouter = new Hono()

export interface RecognitionStatusResponse {
  configured: boolean
  provider: string
  isDefault: boolean
  demoAvailable: boolean
  guidance: string
}

recognitionRouter.get('/status', (c) => {
  const providerUrl = process.env['RECOGNITION_PROVIDER_URL']
  const demoAllowed =
    process.env['ALLOW_DEMO_RECOGNITION'] === 'true' || process.env['NODE_ENV'] === 'test'

  return c.json({
    configured: true,
    provider: providerUrl ? 'Custom Recognition Gateway' : 'Shazam Gateway (Default)',
    isDefault: !providerUrl,
    demoAvailable: demoAllowed,
    guidance: providerUrl
      ? 'Custom music recognition gateway is active.'
      : 'Echo Find is operating with the built-in default Shazam recognition gateway. You can also configure a custom RECOGNITION_PROVIDER_URL in server environment variables.',
  })
})

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
      provider: 'Shazam Gateway (Default)',
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
      return c.json(
        {
          configured: true,
          provider: 'Custom Recognition Gateway',
          ...data,
        },
        upstream.status as 200,
      )
    } catch (err) {
      return c.json(
        {
          matched: false,
          configured: true,
          provider: 'Custom Recognition Gateway',
          error: err instanceof Error ? err.message : 'Upstream recognition provider failed',
        },
        502,
      )
    }
  }

  // Default Recognition Backend (Shazam Gateway)
  try {
    const signatureHeader = c.req.header('x-shazam-signature')
    const contentType = c.req.header('content-type') || ''
    let signature = signatureHeader || ''

    if (!signature && contentType.includes('multipart/form-data')) {
      const formData = (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>
      if (typeof formData['signature'] === 'string') {
        signature = formData['signature']
      }
    }

    if (signature) {
      const uuid1 = crypto.randomUUID().toUpperCase()
      const uuid2 = crypto.randomUUID()
      const shazamUrl = `https://amp.shazam.com/discovery/v5/en/US/android/-/tag/${uuid1}/${uuid2}?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&video=v3`

      const timestamp = Math.floor(Date.now() / 1000)
      const shazamPayload = {
        geolocation: {
          altitude: 200,
          latitude: 40.7128,
          longitude: -74.006,
        },
        signature: {
          samplems: 6000,
          timestamp,
          uri: signature,
        },
        timestamp,
        timezone: 'America/New_York',
      }

      const upstream = await fetch(shazamUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G920F Build/MMB29K)',
          'Content-Language': 'en_US',
        },
        body: JSON.stringify(shazamPayload),
      })

      if (upstream.ok) {
        const data = (await upstream.json()) as {
          track?: {
            key?: string
            title?: string
            subtitle?: string
            images?: { coverarthq?: string; coverart?: string }
            sections?: Array<{ type?: string; metadata?: Array<{ title?: string; text?: string }> }>
          }
          matches?: unknown[]
        }

        if (data.track && data.track.title) {
          const songSection = data.track.sections?.find((s) => s.type === 'SONG')
          const albumMeta = songSection?.metadata?.find((m) => m.title?.toLowerCase() === 'album')

          return c.json({
            matched: true,
            configured: true,
            provider: 'Shazam Gateway (Default)',
            confidence: 95,
            track: {
              id: `shazam_${data.track.key || crypto.randomUUID()}`,
              title: data.track.title,
              artistName: data.track.subtitle || 'Unknown Artist',
              albumTitle: albumMeta?.text || '',
              artwork: data.track.images?.coverarthq || data.track.images?.coverart || '',
              durationSeconds: 0,
              durationMs: 0,
            },
          })
        }
      }
    }

    return c.json({
      matched: false,
      configured: true,
      provider: 'Shazam Gateway (Default)',
      message: 'No matching track found for this audio sample.',
      guidance:
        'Ensure your microphone is close to the audio source and try recording for a few more seconds.',
    })
  } catch (err) {
    return c.json({
      matched: false,
      configured: true,
      provider: 'Shazam Gateway (Default)',
      error: err instanceof Error ? err.message : 'Default recognition provider error',
      message: 'Recognition service temporarily unavailable. Please retry in a few moments.',
    })
  }
})
