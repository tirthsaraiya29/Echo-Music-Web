import { Hono } from 'hono'
import { isIP } from 'node:net'
import { isPrivateIp } from '../utils/ssrf.ts'
import { createHash } from 'node:crypto'

export const cloudRouter = new Hono()

export interface TestConnectionPayload {
  type: 'jellyfin' | 'navidrome'
  serverUrl: string
  username?: string
  password?: string
  token?: string
}

export function normalizeServerUrl(raw: string): string {
  let url = (raw || '').trim()
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`
  }
  return url.replace(/\/+$/, '')
}

/**
 * Validates external server URL against SSRF rules.
 */
export function isAllowedCloudServer(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const allowLocal = process.env['TRUST_LOCAL_SERVERS'] === 'true'
    const host = parsed.hostname.toLowerCase()
    if (!allowLocal) {
      if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
        return false
      }
      if (isIP(host) && isPrivateIp(host)) {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}

cloudRouter.post('/test-connection', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as TestConnectionPayload
  if (!body.serverUrl || !body.type) {
    return c.json({ error: 'serverUrl and type (jellyfin | navidrome) are required' }, 400)
  }

  const serverUrl = normalizeServerUrl(body.serverUrl)
  if (!isAllowedCloudServer(serverUrl)) {
    return c.json({ error: 'Invalid or restricted server destination' }, 403)
  }

  try {
    if (body.type === 'jellyfin') {
      // Jellyfin authentication via /Users/AuthenticateByName
      const authHeader = 'MediaBrowser Client="Echo Music Web", Device="Web Client", DeviceId="echo-web", Version="1.0.0"'
      const res = await fetch(`${serverUrl}/Users/AuthenticateByName`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Emby-Authorization': authHeader,
        },
        body: JSON.stringify({
          Username: body.username || '',
          Pw: body.password || '',
        }),
      })

      if (!res.ok) {
        return c.json({ success: false, error: `Jellyfin auth failed with HTTP ${res.status}` }, 401)
      }

      const data = (await res.json()) as {
        AccessToken?: string
        User?: { Id?: string; Name?: string }
        ServerId?: string
      }

      return c.json({
        success: true,
        type: 'jellyfin',
        serverName: data.User?.Name ? `${data.User.Name}'s Jellyfin` : 'Jellyfin Server',
        token: data.AccessToken,
        userId: data.User?.Id,
        serverId: data.ServerId,
      })
    } else if (body.type === 'navidrome') {
      // Subsonic / Navidrome REST ping via /rest/ping.view
      const salt = Math.random().toString(36).slice(2, 10)
      const token = createHash('md5').update((body.password || '') + salt).digest('hex')
      const pingUrl = `${serverUrl}/rest/ping.view?u=${encodeURIComponent(body.username || '')}&t=${token}&s=${salt}&v=1.16.1&c=EchoMusicWeb&f=json`

      const res = await fetch(pingUrl)
      if (!res.ok) {
        return c.json({ success: false, error: `Navidrome ping failed with HTTP ${res.status}` }, 401)
      }

      const data = (await res.json()) as {
        'subsonic-response'?: {
          status?: string
          version?: string
          type?: string
          serverVersion?: string
          error?: { message?: string }
        }
      }

      const resp = data['subsonic-response']
      if (resp?.status !== 'ok') {
        return c.json({ success: false, error: resp?.error?.message || 'Authentication failed' }, 401)
      }

      return c.json({
        success: true,
        type: 'navidrome',
        serverName: resp.type ? `${resp.type} (${resp.serverVersion || 'Subsonic'})` : 'Navidrome Server',
        version: resp.version,
        salt,
        token,
      })
    }

    return c.json({ error: 'Unsupported provider type' }, 400)
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 502)
  }
})

cloudRouter.post('/browse', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    type: 'jellyfin' | 'navidrome'
    serverUrl: string
    token?: string
    userId?: string
    salt?: string
    username?: string
    view: 'albums' | 'artists' | 'tracks'
    parentId?: string
  }

  if (!body.serverUrl || !body.type) {
    return c.json({ error: 'serverUrl and type are required' }, 400)
  }

  const serverUrl = normalizeServerUrl(body.serverUrl)
  if (!isAllowedCloudServer(serverUrl)) {
    return c.json({ error: 'Invalid or restricted server destination' }, 403)
  }

  try {
    if (body.type === 'jellyfin') {
      const headers = {
        'X-Emby-Token': body.token || '',
      }
      let url = `${serverUrl}/Items?Recursive=true&UserId=${encodeURIComponent(body.userId || '')}&Fields=ItemCounts,PrimaryImageAspectRatio,CanDelete`

      if (body.view === 'albums') {
        url += '&IncludeItemTypes=MusicAlbum&SortBy=SortName'
      } else if (body.view === 'artists') {
        url = `${serverUrl}/Artists?UserId=${encodeURIComponent(body.userId || '')}&SortBy=SortName`
      } else {
        url += '&IncludeItemTypes=Audio&SortBy=DateCreated&SortOrder=Descending&Limit=100'
      }

      if (body.parentId) {
        url += `&ParentId=${encodeURIComponent(body.parentId)}`
      }

      const res = await fetch(url, { headers })
      if (!res.ok) {
        return c.json({ error: `Jellyfin request failed with HTTP ${res.status}` }, 502)
      }

      const data = (await res.json()) as { Items?: unknown[] }
      return c.json({ items: data.Items || [] })
    } else if (body.type === 'navidrome') {
      const authParams = `u=${encodeURIComponent(body.username || '')}&t=${body.token || ''}&s=${body.salt || ''}&v=1.16.1&c=EchoMusicWeb&f=json`
      let url = ''

      if (body.view === 'albums') {
        url = `${serverUrl}/rest/getAlbumList2.view?type=recent&size=50&${authParams}`
      } else if (body.view === 'artists') {
        url = `${serverUrl}/rest/getArtists.view?${authParams}`
      } else {
        url = `${serverUrl}/rest/getRandomSongs.view?size=50&${authParams}`
      }

      const res = await fetch(url)
      if (!res.ok) {
        return c.json({ error: `Subsonic request failed with HTTP ${res.status}` }, 502)
      }

      const data = (await res.json()) as Record<string, unknown>
      return c.json({ data: data['subsonic-response'] || {} })
    }

    return c.json({ error: 'Unsupported provider type' }, 400)
  } catch (err: unknown) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502)
  }
})
