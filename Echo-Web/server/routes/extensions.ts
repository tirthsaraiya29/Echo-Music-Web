import { Hono } from 'hono'
import { isAllowedCloudServer, normalizeServerUrl } from './cloud.ts'
import type { AddonTrack, AddonManifest, AddonStreamResponse } from '../../src/types/extension.ts'

export const extensionsRouter = new Hono()

export const QUALIFIER_TOKENS = new Set([
  'remix',
  'live',
  'instrumental',
  'acoustic',
  'edit',
  'version',
  'radio',
  'extended',
  'mix',
  'vip',
  'dub',
  'deluxe',
  'orchestral',
])

export const CREDIT_TOKENS = new Set(['feat', 'featuring', 'ft', 'prod', 'with'])
export const ARTIST_STOP_TOKENS = new Set(['the', 'and', 'or', 'feat', 'ft', 'featuring', 'prod', 'by', '&'])

export const MIN_TOKEN_MATCH_LEN = 3
export const MAX_PREFIX_SUFFIX_LEN = 4

export function normalizeForMatch(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenize(value: string): string[] {
  return normalizeForMatch(value)
    .split(' ')
    .filter((t) => t.length > 0)
}

export function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true
  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  if (shorter.length < MIN_TOKEN_MATCH_LEN) return false
  return longer.startsWith(shorter) && longer.length - shorter.length <= MAX_PREFIX_SUFFIX_LEN
}

export function coversAllTokens(gotTokens: string[], wantTokens: string[]): boolean {
  return wantTokens.every((w) => gotTokens.some((g) => tokensMatch(g, w)))
}

export function artistMatches(wantArtist: string[], gotArtist: string[]): boolean {
  const wantSig = wantArtist.filter((t) => t.length >= 2 && !ARTIST_STOP_TOKENS.has(t))
  const gotSig = gotArtist.filter((t) => t.length >= 2 && !ARTIST_STOP_TOKENS.has(t))
  if (wantSig.length === 0 || gotSig.length === 0) return false
  return wantSig.some((w) => gotSig.some((g) => tokensMatch(w, g)))
}

export function selectBestMatch(
  tracks: AddonTrack[],
  title: string,
  artist: string,
  durationMs?: number,
): { track: AddonTrack; score: number } | null {
  if (!tracks || tracks.length === 0) return null

  const wantTokens = tokenize(title)
  if (wantTokens.length === 0) return null

  const wantQualifiers = new Set(wantTokens.filter((t) => QUALIFIER_TOKENS.has(t)))
  const wantBase = wantTokens.filter((t) => !QUALIFIER_TOKENS.has(t) && !CREDIT_TOKENS.has(t))
  if (wantBase.length === 0) return null

  const artistTokens = tokenize(artist)

  let best: AddonTrack | null = null
  let bestScore = -Infinity

  for (const track of tracks) {
    if (!track.id || !track.title) continue

    const gotTokens = tokenize(track.title)
    if (gotTokens.length === 0) continue

    const gotQualifiers = new Set(gotTokens.filter((t) => QUALIFIER_TOKENS.has(t)))
    const gotBase = gotTokens.filter((t) => !QUALIFIER_TOKENS.has(t) && !CREDIT_TOKENS.has(t))
    if (gotBase.length === 0) continue

    // Gate 1: Candidate must cover the requested base tokens
    if (!coversAllTokens(gotBase, wantBase)) continue

    // Gate 2: Requested qualifiers (e.g. remix, live) must be present in candidate
    const qualifiersMatched = Array.from(wantQualifiers).every((wq) =>
      Array.from(gotQualifiers).some((gq) => tokensMatch(wq, gq)),
    )
    if (!qualifiersMatched) continue

    // Gate 3: Artist must match if both specify one
    const artistMatched = artistMatches(artistTokens, tokenize(track.artist || ''))
    if (artistTokens.length > 0 && !artistMatched) continue

    // Scoring
    let score = 0
    const exactBase = gotBase.length === wantBase.length && gotBase.every((g, idx) => g === wantBase[idx])
    if (exactBase) {
      score += 100
    } else {
      const matchCount = gotBase.filter((g) => wantBase.some((w) => tokensMatch(g, w))).length
      score += Math.round((matchCount / Math.max(gotBase.length, wantBase.length)) * 60)
    }

    if (artistMatched) score += 60
    if (gotQualifiers.size === wantQualifiers.size) score += 20
    else if (wantQualifiers.size === 0) score -= gotQualifiers.size * 5

    if (durationMs && durationMs > 0 && track.duration && track.duration > 0) {
      const diffMs = Math.abs(track.duration * 1000 - durationMs)
      if (diffMs <= 8000) score += 10
      else if (diffMs <= 20000) score += 3
    }

    if (score > bestScore) {
      bestScore = score
      best = track
    }
  }

  return best ? { track: best, score: bestScore } : null
}

extensionsRouter.get('/health', async (c) => {
  const urlParam = c.req.query('url')
  if (!urlParam) {
    return c.json({ ok: false, error: 'url query param required' }, 400)
  }

  const normalized = normalizeServerUrl(urlParam)
  if (!isAllowedCloudServer(normalized)) {
    return c.json({ ok: false, error: 'Target URL is restricted or invalid' }, 403)
  }

  const manifestUrl = `${normalized}/manifest.json`
  const startTime = performance.now()

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)

    const res = await fetch(manifestUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    }).finally(() => clearTimeout(timer))

    const latencyMs = Math.round(performance.now() - startTime)

    if (!res.ok) {
      return c.json({ ok: false, latencyMs, error: `HTTP ${res.status}` }, 502)
    }

    const manifest = (await res.json()) as AddonManifest
    return c.json({
      ok: true,
      latencyMs,
      manifest: {
        id: manifest.id || 'addon',
        name: manifest.name || 'Unnamed Extension',
        version: manifest.version || '1.0.0',
        description: manifest.description,
      },
    })
  } catch (err) {
    return c.json({
      ok: false,
      latencyMs: Math.round(performance.now() - startTime),
      error: err instanceof Error ? err.message : String(err),
    }, 502)
  }
})

extensionsRouter.post('/match', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    addonUrl: string
    title: string
    artist: string
    durationMs?: number
  }

  if (!body.addonUrl || !body.title) {
    return c.json({ matched: false, error: 'addonUrl and title are required' }, 400)
  }

  const normalized = normalizeServerUrl(body.addonUrl)
  if (!isAllowedCloudServer(normalized)) {
    return c.json({ matched: false, error: 'Restricted target URL' }, 403)
  }

  try {
    const query = encodeURIComponent(`${body.title} ${body.artist || ''}`.trim())
    const searchUrl = `${normalized}/search?query=${query}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(searchUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    }).finally(() => clearTimeout(timer))

    if (!res.ok) {
      return c.json({ matched: false, error: `Addon search failed with HTTP ${res.status}` }, 502)
    }

    const data = (await res.json()) as { tracks?: AddonTrack[] }
    const tracks = data.tracks || []

    const best = selectBestMatch(tracks, body.title, body.artist || '', body.durationMs)
    if (!best) {
      return c.json({ matched: false })
    }

    return c.json({
      matched: true,
      candidate: best.track,
      score: best.score,
    })
  } catch (err) {
    return c.json({ matched: false, error: err instanceof Error ? err.message : String(err) }, 502)
  }
})

extensionsRouter.post('/resolve', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    addonUrl: string
    trackId: string
  }

  if (!body.addonUrl || !body.trackId) {
    return c.json({ error: 'addonUrl and trackId are required' }, 400)
  }

  const normalized = normalizeServerUrl(body.addonUrl)
  if (!isAllowedCloudServer(normalized)) {
    return c.json({ error: 'Restricted target URL' }, 403)
  }

  try {
    const streamUrl = `${normalized}/stream?id=${encodeURIComponent(body.trackId)}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(streamUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    }).finally(() => clearTimeout(timer))

    if (!res.ok) {
      return c.json({ error: `Addon stream resolution failed with HTTP ${res.status}` }, 502)
    }

    const data = (await res.json()) as AddonStreamResponse
    if (!data.url) {
      return c.json({ error: 'Addon returned empty stream URL' }, 502)
    }

    return c.json({
      success: true,
      stream: {
        url: data.url,
        format: data.format,
        codec: data.codec,
        quality: data.quality || data.audioQuality || data.streamQuality,
      },
    })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502)
  }
})
