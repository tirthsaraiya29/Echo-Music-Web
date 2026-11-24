import type { Track } from '../../types/domain'
import {
  musicDnaQuerySchema,
  musicDnaDataSchema,
  type MusicDnaData,
  recordMusicDnaMetric,
} from './musicDnaTypes.ts'

export type { MusicDnaData }

// LRU-bounded cache (Map keeps insertion order)
const DNA_CACHE_MAX = 300
const dnaCache = new Map<string, MusicDnaData>()
const inFlightRequests = new Map<string, Promise<MusicDnaData>>()

export interface FetchMusicDnaOptions {
  signal?: AbortSignal
  timeoutMs?: number
  skipRetry?: boolean
}

export function clearMusicDnaCache(): void {
  dnaCache.clear()
  inFlightRequests.clear()
}

export async function fetchMusicDna(
  track: Track,
  options: FetchMusicDnaOptions = {},
): Promise<MusicDnaData> {
  const queryResult = musicDnaQuerySchema.safeParse({
    title: track.title,
    artist: track.artistName || '',
  })

  if (!queryResult.success) {
    recordMusicDnaMetric('errors')
    throw new Error(`Invalid Music DNA track input: ${queryResult.error.message}`)
  }

  const { title, artist } = queryResult.data
  const cacheKey = `${title}__${artist}`.toLowerCase()

  const cached = dnaCache.get(cacheKey)
  if (cached) {
    dnaCache.delete(cacheKey)
    dnaCache.set(cacheKey, cached)
    recordMusicDnaMetric('cacheHits')
    return cached
  }

  recordMusicDnaMetric('cacheMisses')
  recordMusicDnaMetric('requests')

  const inFlight = inFlightRequests.get(cacheKey)
  if (inFlight) {
    recordMusicDnaMetric('inFlightDeduplications')
    return inFlight
  }

  const executeFetch = async (): Promise<MusicDnaData> => {
    const timeoutMs = options.timeoutMs ?? 8000
    const timeoutController = new AbortController()
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs)

    const onAbort = () => {
      timeoutController.abort()
    }

    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true })
    }

    try {
      const query = new URLSearchParams({
        title,
        artist,
      })

      const makeRequest = async () => {
        const res = await fetch(`/api/music-dna?${query.toString()}`, {
          signal: timeoutController.signal,
        })
        if (!res.ok) {
          throw new Error(`Failed to fetch Music DNA (HTTP ${res.status})`)
        }
        return res.json()
      }

      let rawData: unknown
      try {
        rawData = await makeRequest()
      } catch (err: unknown) {
        if (options.signal?.aborted || timeoutController.signal.aborted) {
          throw err
        }
        if (!options.skipRetry) {
          recordMusicDnaMetric('retries')
          // Jittered backoff (50ms - 150ms)
          const jitter = Math.floor(Math.random() * 100) + 50
          await new Promise((resolve) => setTimeout(resolve, jitter))
          rawData = await makeRequest()
        } else {
          throw err
        }
      }

      const parsed = musicDnaDataSchema.safeParse(rawData)
      const data: MusicDnaData = parsed.success
        ? parsed.data
        : {
            trackTitle: title,
            artistName: artist,
          }

      dnaCache.set(cacheKey, data)
      if (dnaCache.size > DNA_CACHE_MAX) {
        const oldest = dnaCache.keys().next().value
        if (oldest !== undefined) dnaCache.delete(oldest)
      }

      return data
    } catch (err: unknown) {
      if (options.signal?.aborted) {
        recordMusicDnaMetric('cancellations')
      } else {
        recordMusicDnaMetric('errors')
      }
      throw err
    } finally {
      clearTimeout(timer)
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort)
      }
      inFlightRequests.delete(cacheKey)
    }
  }

  const requestPromise = executeFetch()
  inFlightRequests.set(cacheKey, requestPromise)
  return requestPromise
}
