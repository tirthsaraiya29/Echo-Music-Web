import { Hono } from 'hono'
import process from 'node:process'

export const spotifyRouter = new Hono()

export interface SpotifyTrackInfo {
  title: string
  artist: string
  album?: string | undefined
  durationMs?: number | undefined
  isrc?: string | undefined
}

export interface SpotifyResolvedData {
  title: string
  description?: string | undefined
  coverUrl?: string | undefined
  totalTracks?: number | undefined
  offset?: number | undefined
  limit?: number | undefined
  hasMore?: boolean | undefined
  tracks: SpotifyTrackInfo[]
}

let cachedAnonToken: string | null = null
let anonTokenExpiry = 0

async function getSpotifyAccessToken(userToken?: string): Promise<string | null> {
  if (userToken && userToken.trim()) {
    return userToken.trim()
  }

  // 1. Client credentials from environment if configured
  const clientId = process.env['SPOTIFY_CLIENT_ID']
  const clientSecret = process.env['SPOTIFY_CLIENT_SECRET']
  if (clientId && clientSecret) {
    try {
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
      const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      })
      if (tokenRes.ok) {
        const tokenData = (await tokenRes.json()) as { access_token?: string }
        if (tokenData.access_token) return tokenData.access_token
      }
    } catch {
      // Fall through to anonymous token
    }
  }

  // 2. Public anonymous web player token
  if (cachedAnonToken && Date.now() < anonTokenExpiry) {
    return cachedAnonToken
  }

  try {
    const anonRes = await fetch(
      'https://open.spotify.com/get_access_token?reason=transport&productType=web_player',
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      },
    )
    if (anonRes.ok) {
      const data = (await anonRes.json()) as {
        accessToken?: string
        accessTokenExpirationTimestampMs?: number
      }
      if (data.accessToken) {
        cachedAnonToken = data.accessToken
        anonTokenExpiry = data.accessTokenExpirationTimestampMs
          ? data.accessTokenExpirationTimestampMs - 60000
          : Date.now() + 30 * 60 * 1000
        return cachedAnonToken
      }
    }
  } catch {
    // Return null to allow fallback to embed scraper
  }

  return null
}

function extractBearerToken(c: any): string | undefined {
  const authHeader = c.req.header('authorization')
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim()
  }
  const xToken = c.req.header('x-spotify-token')
  if (xToken) return xToken.trim()
  const queryToken = c.req.query('token')
  if (queryToken) return queryToken.trim()
  return undefined
}

spotifyRouter.get('/resolve', async (c) => {
  const urlParam = c.req.query('url')
  if (!urlParam) {
    return c.json({ error: 'Missing url parameter' }, 400)
  }

  const offsetParam = parseInt(c.req.query('offset') || '0', 10)
  const limitParam = parseInt(c.req.query('limit') || '100', 10)
  const offset = Number.isNaN(offsetParam) || offsetParam < 0 ? 0 : offsetParam
  const limit = Number.isNaN(limitParam) || limitParam < 1 ? 100 : Math.min(limitParam, 100)

  try {
    const parsedUrl = new URL(urlParam)
    if (!parsedUrl.hostname.includes('spotify.com') && !parsedUrl.hostname.includes('spotify.link')) {
      return c.json({ error: 'Not a valid Spotify URL' }, 400)
    }

    const pathParts = parsedUrl.pathname.split('/').filter(Boolean)
    const type = pathParts[0] // 'playlist', 'album', 'track'
    const id = pathParts[1]

    if (!type || !id) {
      return c.json({ error: 'Could not parse Spotify entity ID' }, 400)
    }

    const token = await getSpotifyAccessToken(extractBearerToken(c))

    // If access token is available, query official Spotify Web API with full metadata and pagination
    if (token) {
      try {
        if (type === 'playlist') {
          const playlistRes = await fetch(`https://api.spotify.com/v1/playlists/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          })

          if (playlistRes.ok) {
            const pData = (await playlistRes.json()) as {
              name?: string
              description?: string
              images?: Array<{ url: string }>
              tracks?: {
                total?: number
                items?: Array<{
                  track?: {
                    name?: string
                    artists?: Array<{ name?: string }>
                    album?: { name?: string }
                    duration_ms?: number
                    external_ids?: { isrc?: string }
                  }
                }>
              }
            }

            const total = pData.tracks?.total || 0
            const tracks: SpotifyTrackInfo[] = []

            // If offset > 0 or specific limit requested, fetch that page directly
            const tracksEndpoint = `https://api.spotify.com/v1/playlists/${id}/tracks?offset=${offset}&limit=${limit}`
            const tracksRes = await fetch(tracksEndpoint, {
              headers: { Authorization: `Bearer ${token}` },
            })

            if (tracksRes.ok) {
              const tData = (await tracksRes.json()) as {
                items?: Array<{
                  track?: {
                    name?: string
                    artists?: Array<{ name?: string }>
                    album?: { name?: string }
                    duration_ms?: number
                    external_ids?: { isrc?: string }
                  }
                }>
              }

              for (const item of tData.items || []) {
                const tr = item.track
                if (tr && tr.name) {
                  tracks.push({
                    title: tr.name,
                    artist: tr.artists?.map((a) => a.name).filter(Boolean).join(', ') || '',
                    album: tr.album?.name,
                    durationMs: tr.duration_ms,
                    isrc: tr.external_ids?.isrc,
                  })
                }
              }

              return c.json({
                title: pData.name || 'Imported Spotify Playlist',
                description: pData.description,
                coverUrl: pData.images?.[0]?.url,
                totalTracks: total,
                offset,
                limit,
                hasMore: offset + tracks.length < total,
                tracks,
              } satisfies SpotifyResolvedData)
            }
          }
        } else if (type === 'album') {
          const albumRes = await fetch(`https://api.spotify.com/v1/albums/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          })

          if (albumRes.ok) {
            const aData = (await albumRes.json()) as {
              name?: string
              images?: Array<{ url: string }>
              artists?: Array<{ name?: string }>
              tracks?: {
                total?: number
                items?: Array<{
                  name?: string
                  artists?: Array<{ name?: string }>
                  duration_ms?: number
                  external_ids?: { isrc?: string }
                }>
              }
            }

            const albumArtist = aData.artists?.map((a) => a.name).filter(Boolean).join(', ') || ''
            const total = aData.tracks?.total || 0
            const tracks: SpotifyTrackInfo[] = []

            for (const item of aData.tracks?.items || []) {
              if (item.name) {
                tracks.push({
                  title: item.name,
                  artist:
                    item.artists?.map((a) => a.name).filter(Boolean).join(', ') || albumArtist,
                  album: aData.name,
                  durationMs: item.duration_ms,
                  isrc: item.external_ids?.isrc,
                })
              }
            }

            return c.json({
              title: aData.name || 'Imported Spotify Album',
              coverUrl: aData.images?.[0]?.url,
              totalTracks: total,
              offset: 0,
              limit: total,
              hasMore: false,
              tracks,
            } satisfies SpotifyResolvedData)
          }
        } else if (type === 'track') {
          const trackRes = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          })

          if (trackRes.ok) {
            const tr = (await trackRes.json()) as {
              name?: string
              artists?: Array<{ name?: string }>
              album?: { name?: string; images?: Array<{ url: string }> }
              duration_ms?: number
              external_ids?: { isrc?: string }
            }

            return c.json({
              title: tr.name || 'Imported Spotify Track',
              coverUrl: tr.album?.images?.[0]?.url,
              totalTracks: 1,
              hasMore: false,
              tracks: [
                {
                  title: tr.name || '',
                  artist: tr.artists?.map((a) => a.name).filter(Boolean).join(', ') || '',
                  album: tr.album?.name,
                  durationMs: tr.duration_ms,
                  isrc: tr.external_ids?.isrc,
                },
              ],
            } satisfies SpotifyResolvedData)
          }
        }
      } catch {
        // Fall back to scraping embed if API call fails
      }
    }

    // 1. Fetch Spotify oEmbed for title and thumbnail fallback
    let oEmbedTitle = 'Imported Spotify Playlist'
    let oEmbedThumbnail: string | undefined
    try {
      const oembedRes = await fetch(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(urlParam)}`,
        { headers: { 'User-Agent': 'Mozilla/5.0 EchoMusicWeb/1.0' } },
      )
      if (oembedRes.ok) {
        const oembedData = (await oembedRes.json()) as { title?: string; thumbnail_url?: string }
        if (oembedData.title) oEmbedTitle = oembedData.title
        if (oembedData.thumbnail_url) oEmbedThumbnail = oembedData.thumbnail_url
      }
    } catch {
      // Continue even if oembed fails
    }

    // 2. Fetch Spotify Embed HTML page
    const embedUrl = `https://open.spotify.com/embed/${type}/${id}`
    const embedRes = await fetch(embedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    })

    if (!embedRes.ok) {
      return c.json(
        {
          error: `Spotify returned HTTP ${embedRes.status}`,
          title: oEmbedTitle,
          coverUrl: oEmbedThumbnail,
          tracks: [],
        },
        502,
      )
    }

    const html = await embedRes.text()
    const tracks: SpotifyTrackInfo[] = []

    const nextDataMatch = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
    )
    const initialStateMatch = html.match(
      /<script id="initial-state" type="text\/plain">([\s\S]*?)<\/script>/,
    )

    if (nextDataMatch && nextDataMatch[1]) {
      try {
        const parsed = JSON.parse(nextDataMatch[1])
        const entityData =
          parsed?.props?.pageProps?.state?.data?.entity || parsed?.props?.pageProps?.entity
        if (entityData?.trackList && Array.isArray(entityData.trackList)) {
          for (const item of entityData.trackList) {
            tracks.push({
              title: item.title || item.name || '',
              artist: item.subtitle || item.artists?.[0]?.name || '',
              durationMs: item.duration || 0,
            })
          }
        }
      } catch (err) {
        console.warn('Could not parse __NEXT_DATA__ from Spotify embed:', err)
      }
    } else if (initialStateMatch && initialStateMatch[1]) {
      try {
        const decoded = Buffer.from(initialStateMatch[1], 'base64').toString('utf8')
        const parsed = JSON.parse(decoded)
        const entity = parsed?.data?.entity
        if (entity?.trackList && Array.isArray(entity.trackList)) {
          for (const item of entity.trackList) {
            tracks.push({
              title: item.title || item.name || '',
              artist: item.subtitle || item.artists?.[0]?.name || '',
              durationMs: item.duration || 0,
            })
          }
        }
      } catch (err) {
        console.warn('Could not parse initial-state from Spotify embed:', err)
      }
    }

    if (tracks.length === 0) {
      const trackRegex =
        /class="track-name[^>]*>([^<]+)<\/[^>]+>[\s\S]*?class="artist-name[^>]*>([^<]+)<\//g
      let match: RegExpExecArray | null
      while ((match = trackRegex.exec(html)) !== null) {
        const t = match[1]?.trim()
        const a = match[2]?.trim()
        if (t && a) {
          tracks.push({ title: t, artist: a })
        }
      }
    }

    const result: SpotifyResolvedData = {
      title: oEmbedTitle,
      coverUrl: oEmbedThumbnail,
      totalTracks: tracks.length,
      tracks,
    }

    return c.json(result)
  } catch (err) {
    return c.json(
      {
        error: 'Failed to resolve Spotify URL',
        message: err instanceof Error ? err.message : String(err),
      },
      500,
    )
  }
})

// Paginated endpoint for playlist tracks
spotifyRouter.get('/playlist/:id/tracks', async (c) => {
  const id = c.req.param('id')
  const offset = parseInt(c.req.query('offset') || '0', 10)
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 100)

  const token = await getSpotifyAccessToken(extractBearerToken(c))
  if (!token) {
    return c.json({ error: 'Spotify access token unavailable' }, 503)
  }

  try {
    const res = await fetch(
      `https://api.spotify.com/v1/playlists/${id}/tracks?offset=${offset}&limit=${limit}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) {
      return c.json({ error: `Spotify API error: ${res.statusText}` }, res.status as any)
    }
    const data = (await res.json()) as any
    const tracks: SpotifyTrackInfo[] = []
    for (const item of data.items || []) {
      const tr = item.track
      if (tr && tr.name) {
        tracks.push({
          title: tr.name,
          artist: tr.artists?.map((a: any) => a.name).filter(Boolean).join(', ') || '',
          album: tr.album?.name,
          durationMs: tr.duration_ms,
          isrc: tr.external_ids?.isrc,
        })
      }
    }

    return c.json({
      total: data.total || 0,
      offset,
      limit,
      hasMore: offset + tracks.length < (data.total || 0),
      tracks,
    })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// Authenticated live Spotify library: User's saved playlists
spotifyRouter.get('/me/playlists', async (c) => {
  const userToken = extractBearerToken(c)
  if (!userToken) {
    return c.json({ error: 'Unauthorized: Spotify user token required for /me endpoints' }, 401)
  }

  const offset = parseInt(c.req.query('offset') || '0', 10)
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 50)

  try {
    const res = await fetch(`https://api.spotify.com/v1/me/playlists?offset=${offset}&limit=${limit}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    })
    if (!res.ok) {
      return c.json({ error: `Spotify API error: ${res.statusText}` }, res.status as any)
    }
    const data = (await res.json()) as any
    return c.json({
      total: data.total || 0,
      offset,
      limit,
      hasMore: offset + (data.items?.length || 0) < (data.total || 0),
      items: (data.items || []).map((p: any) => ({
        id: p.id,
        title: p.name,
        description: p.description,
        coverUrl: p.images?.[0]?.url,
        trackCount: p.tracks?.total || 0,
      })),
    })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// Authenticated live Spotify library: User's saved tracks
spotifyRouter.get('/me/tracks', async (c) => {
  const userToken = extractBearerToken(c)
  if (!userToken) {
    return c.json({ error: 'Unauthorized: Spotify user token required for /me endpoints' }, 401)
  }

  const offset = parseInt(c.req.query('offset') || '0', 10)
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 50)

  try {
    const res = await fetch(`https://api.spotify.com/v1/me/tracks?offset=${offset}&limit=${limit}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    })
    if (!res.ok) {
      return c.json({ error: `Spotify API error: ${res.statusText}` }, res.status as any)
    }
    const data = (await res.json()) as any
    const tracks: SpotifyTrackInfo[] = []
    for (const item of data.items || []) {
      const tr = item.track
      if (tr && tr.name) {
        tracks.push({
          title: tr.name,
          artist: tr.artists?.map((a: any) => a.name).filter(Boolean).join(', ') || '',
          album: tr.album?.name,
          durationMs: tr.duration_ms,
          isrc: tr.external_ids?.isrc,
        })
      }
    }

    return c.json({
      total: data.total || 0,
      offset,
      limit,
      hasMore: offset + tracks.length < (data.total || 0),
      tracks,
    })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})
