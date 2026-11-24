import { Hono } from 'hono'
import { z } from 'zod'
import { getInnerTubeHeaders } from '../utils/headers.ts'
import { buildClientContext, fetchVisitorData, type ClientContextType } from '../utils/potoken.ts'

export const innertubeRouter = new Hono()

export const browseRequestSchema = z.object({
  browseId: z.string().min(1, 'browseId is required'),
  context: z.record(z.string(), z.unknown()).optional(),
  formData: z.record(z.string(), z.unknown()).optional(),
  params: z.string().optional(),
})

export const searchRequestSchema = z.object({
  query: z.string().min(1, 'query is required'),
  params: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
})

export interface InnerTubeRouterMetrics {
  browseRequests: number
  searchRequests: number
  clientRotations: number
  upstreamFailures: number
  lastError: string | null
}

const routerMetrics: InnerTubeRouterMetrics = {
  browseRequests: 0,
  searchRequests: 0,
  clientRotations: 0,
  upstreamFailures: 0,
  lastError: null,
}

export function getInnerTubeRouterMetrics(): InnerTubeRouterMetrics {
  return { ...routerMetrics }
}

export function resetInnerTubeRouterMetrics(): void {
  routerMetrics.browseRequests = 0
  routerMetrics.searchRequests = 0
  routerMetrics.clientRotations = 0
  routerMetrics.upstreamFailures = 0
  routerMetrics.lastError = null
}

const CLIENT_ROTATION_LIST: ClientContextType[] = ['ANDROID_MUSIC', 'IOS', 'WEB_REMIX']

export async function forwardInnerTubeRequest(
  endpoint: string,
  bodyData: Record<string, unknown>,
  clientType: ClientContextType = 'WEB_REMIX',
  visitorHeaderOverride?: string,
): Promise<Response> {
  const url = `https://music.youtube.com/youtubei/v1/${endpoint}`
  const visitorData = visitorHeaderOverride || (await fetchVisitorData())

  const candidates: ClientContextType[] = [
    clientType,
    ...CLIENT_ROTATION_LIST.filter((c) => c !== clientType),
  ]

  let lastResponse: Response | null = null

  for (const currentClient of candidates) {
    const incomingContext =
      typeof bodyData['context'] === 'object' && bodyData['context'] !== null
        ? (bodyData['context'] as Record<string, unknown>)
        : {}
    const incomingClient =
      typeof incomingContext['client'] === 'object' && incomingContext['client'] !== null
        ? (incomingContext['client'] as Record<string, unknown>)
        : {}

    const gl = typeof incomingClient['gl'] === 'string' ? incomingClient['gl'] : 'US'
    const hl = typeof incomingClient['hl'] === 'string' ? incomingClient['hl'] : 'en'

    const defaultContext = buildClientContext(currentClient, visitorData, undefined, gl, hl)

    const mergedBody: Record<string, unknown> = {
      ...bodyData,
      context: {
        ...defaultContext,
        ...incomingContext,
        client: {
          ...(defaultContext['client'] as Record<string, unknown>),
          ...incomingClient,
          gl,
          hl,
        },
      },
    }

    const headers = getInnerTubeHeaders({
      clientType: currentClient,
      visitorData,
    })

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(mergedBody),
      })

      lastResponse = res
      if (res.ok || (res.status !== 403 && res.status !== 429)) {
        return res
      }
    } catch {
      // Rotate on network or upstream error
    }
  }

  if (lastResponse) {
    return lastResponse
  }

  throw new Error(`InnerTube request to ${endpoint} failed across all rotated client definitions`)
}

// Telemetry endpoint
innertubeRouter.get('/telemetry', (c) => {
  return c.json(getInnerTubeRouterMetrics())
})

// 1. POST /api/innertube/browse
innertubeRouter.post('/browse', async (c) => {
  routerMetrics.browseRequests++
  let bodyData: unknown = {}
  try {
    bodyData = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON request body' }, 400)
  }

  const parsed = browseRequestSchema.safeParse(bodyData)
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid browse request' }, 400)
  }

  const visitorHeader = c.req.header('x-youtube-visitor-data')

  try {
    const upstreamRes = await forwardInnerTubeRequest(
      'browse',
      parsed.data as Record<string, unknown>,
      'WEB_REMIX',
      visitorHeader,
    )
    const data = (await upstreamRes.json()) as Record<string, unknown>
    return c.json(data, upstreamRes.status as 200)
  } catch (err: unknown) {
    routerMetrics.upstreamFailures++
    routerMetrics.lastError = err instanceof Error ? err.message : String(err)
    return c.json(
      {
        error: 'Upstream InnerTube browse error',
        message: err instanceof Error ? err.message : String(err),
      },
      502,
    )
  }
})

// 2. POST /api/innertube/search
innertubeRouter.post('/search', async (c) => {
  routerMetrics.searchRequests++
  let bodyData: unknown = {}
  try {
    bodyData = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON request body' }, 400)
  }

  const parsed = searchRequestSchema.safeParse(bodyData)
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid search request' }, 400)
  }

  const visitorHeader = c.req.header('x-youtube-visitor-data')

  try {
    const upstreamRes = await forwardInnerTubeRequest(
      'search',
      parsed.data as Record<string, unknown>,
      'WEB_REMIX',
      visitorHeader,
    )
    const data = (await upstreamRes.json()) as Record<string, unknown>
    return c.json(data, upstreamRes.status as 200)
  } catch (err: unknown) {
    routerMetrics.upstreamFailures++
    routerMetrics.lastError = err instanceof Error ? err.message : String(err)
    return c.json(
      {
        error: 'Upstream InnerTube search error',
        message: err instanceof Error ? err.message : String(err),
      },
      502,
    )
  }
})

// 3. GET /api/innertube/suggestions?q=:query
innertubeRouter.get('/suggestions', async (c) => {
  const query = c.req.query('q') || c.req.query('input') || ''
  if (!query.trim()) {
    return c.json([])
  }

  const gl = c.req.query('gl') || 'US'
  const hl = c.req.query('hl') || 'en'

  try {
    const upstreamRes = await forwardInnerTubeRequest(
      'music/get_search_suggestions',
      {
        input: query.trim(),
        context: {
          client: { gl, hl },
        },
      },
      'WEB_REMIX',
    )

    if (upstreamRes.ok) {
      const data = (await upstreamRes.json()) as {
        contents?: Array<{
          searchSuggestionsSectionRenderer?: {
            contents?: Array<{
              searchSuggestionRenderer?: {
                suggestion?: {
                  runs?: Array<{ text: string }>
                }
                navigationEndpoint?: {
                  searchEndpoint?: {
                    query?: string
                  }
                }
              }
            }>
          }
        }>
      }

      const suggestions: string[] = []
      const sections = data.contents || []

      for (const section of sections) {
        const items = section.searchSuggestionsSectionRenderer?.contents || []
        for (const item of items) {
          const renderer = item.searchSuggestionRenderer
          if (!renderer) continue
          const text =
            renderer.navigationEndpoint?.searchEndpoint?.query ||
            renderer.suggestion?.runs?.map((r) => r.text).join('')
          if (text && !suggestions.includes(text)) {
            suggestions.push(text)
          }
        }
      }

      if (suggestions.length > 0) {
        return c.json(suggestions)
      }
    }
  } catch {
    // InnerTube suggestion failed, proceed to fallback
  }

  // Fallback to Google YouTube suggest
  try {
    const fallbackUrl = `https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&hl=${encodeURIComponent(hl)}&gl=${encodeURIComponent(gl)}&ds=yt&q=${encodeURIComponent(query.trim())}`
    const fallbackRes = await fetch(fallbackUrl)
    if (fallbackRes.ok) {
      const text = await fallbackRes.text()
      const match = /window\.google\.ac\.h\(\[.*?,(\[.*?\])\s*,\{/s.exec(text)
      if (match?.[1]) {
        const rawList = JSON.parse(match[1]) as Array<[string, ...unknown[]]>
        const suggestions = rawList
          .map((item) => (Array.isArray(item) ? item[0] : null))
          .filter((item): item is string => typeof item === 'string')
        return c.json(suggestions)
      }
    }
  } catch {
    // Non-fatal
  }

  return c.json([])
})

// 4. POST /api/innertube/next
innertubeRouter.post('/next', async (c) => {
  let bodyData: Record<string, unknown> = {}
  try {
    bodyData = (await c.req.json()) as Record<string, unknown>
  } catch {
    bodyData = {}
  }

  const visitorHeader = c.req.header('x-youtube-visitor-data')

  try {
    const upstreamRes = await forwardInnerTubeRequest('next', bodyData, 'WEB_REMIX', visitorHeader)
    const data = (await upstreamRes.json()) as Record<string, unknown>
    return c.json(data, upstreamRes.status as 200)
  } catch (err: unknown) {
    return c.json(
      {
        error: 'Upstream InnerTube next error',
        message: err instanceof Error ? err.message : String(err),
      },
      502,
    )
  }
})

// 5. Allowlisted passthrough: only InnerTube endpoints the client actually uses may be
// forwarded. An open relay would let any third-party site proxy arbitrary InnerTube calls
// through this server.
const ALLOWED_ENDPOINTS = new Set(['browse', 'search', 'next', 'music/get_search_suggestions'])

innertubeRouter.post('/:endpoint', async (c) => {
  const endpoint = c.req.param('endpoint')
  if (!endpoint || !ALLOWED_ENDPOINTS.has(endpoint)) {
    return c.json({ error: 'Endpoint not allowed' }, 403)
  }

  let bodyData: Record<string, unknown> = {}
  try {
    bodyData = (await c.req.json()) as Record<string, unknown>
  } catch {
    bodyData = {}
  }

  const visitorHeader = c.req.header('x-youtube-visitor-data')

  try {
    const upstreamRes = await forwardInnerTubeRequest(
      encodeURIComponent(endpoint),
      bodyData,
      'WEB_REMIX',
      visitorHeader,
    )
    const data = (await upstreamRes.json()) as Record<string, unknown>
    return c.json(data, upstreamRes.status as 200)
  } catch (err: unknown) {
    return c.json(
      {
        error: 'Upstream InnerTube error',
        message: err instanceof Error ? err.message : String(err),
      },
      502,
    )
  }
})
