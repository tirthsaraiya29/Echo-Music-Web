import type { Track } from '../../types/domain.ts'
import {
  lastFmSessionSchema,
  lastFmTrackPayloadSchema,
  recordLastFmMetric,
  type LastFmSession,
} from './lastfmTypes.ts'

export type { LastFmSession }

let activeNowPlayingKey: string | null = null
let lastScrobbledKey: string | null = null
let lastScrobbledTimestamp = 0

export function clearLastFmState(): void {
  activeNowPlayingKey = null
  lastScrobbledKey = null
  lastScrobbledTimestamp = 0
}

export interface LastFmRequestOptions {
  signal?: AbortSignal | undefined
  timeoutMs?: number | undefined
  skipRetry?: boolean | undefined
}

export async function getLastFmAuthUrl(
  callbackUrl?: string,
  options: LastFmRequestOptions = {},
): Promise<string> {
  const cb =
    callbackUrl ||
    (typeof window !== 'undefined'
      ? `${window.location.origin}/settings?tab=integrations`
      : 'http://localhost:5173/settings?tab=integrations')

  const timeoutMs = options.timeoutMs ?? 6000
  const timeoutCtrl = new AbortController()
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs)

  try {
    const res = await fetch(`/api/lastfm/auth-url?callback=${encodeURIComponent(cb)}`, {
      signal: options.signal
        ? anySignal([options.signal, timeoutCtrl.signal])
        : timeoutCtrl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      recordLastFmMetric('errors')
      throw new Error(err.error || 'Last.fm authentication service is not configured on the server')
    }
    const data = (await res.json()) as { url: string }
    return data.url
  } catch (err: unknown) {
    clearTimeout(timer)
    if (options.signal?.aborted) {
      recordLastFmMetric('cancellations')
    } else {
      recordLastFmMetric('errors')
    }
    throw err
  }
}

export async function fetchLastFmSession(
  token: string,
  options: LastFmRequestOptions = {},
): Promise<LastFmSession> {
  if (!token || !token.trim()) {
    recordLastFmMetric('errors')
    throw new Error('Missing authentication token')
  }

  const timeoutMs = options.timeoutMs ?? 8000
  const timeoutCtrl = new AbortController()
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs)

  try {
    const res = await fetch(`/api/lastfm/session?token=${encodeURIComponent(token.trim())}`, {
      signal: options.signal
        ? anySignal([options.signal, timeoutCtrl.signal])
        : timeoutCtrl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      recordLastFmMetric('errors')
      throw new Error(err.error || 'Failed to authenticate with Last.fm')
    }
    const raw = await res.json()
    const parsed = lastFmSessionSchema.safeParse(raw)
    if (!parsed.success) {
      recordLastFmMetric('errors')
      throw new Error('Malformed Last.fm session data received')
    }
    return parsed.data
  } catch (err: unknown) {
    clearTimeout(timer)
    if (options.signal?.aborted) {
      recordLastFmMetric('cancellations')
    } else {
      recordLastFmMetric('errors')
    }
    throw err
  }
}

export async function updateLastFmNowPlaying(
  track: Track,
  sessionKey: string,
  options: LastFmRequestOptions = {},
): Promise<boolean> {
  const trackTitle = track.title?.trim()
  const artistName = track.artistName?.trim() || 'Unknown Artist'
  if (!trackTitle || !sessionKey) return false

  const nowKey = `${sessionKey}__${trackTitle}__${artistName}`.toLowerCase()
  if (activeNowPlayingKey === nowKey) {
    recordLastFmMetric('deduplications')
    return true
  }

  const payload = {
    sessionKey,
    track: trackTitle,
    artist: artistName,
    album: track.albumTitle?.trim() || undefined,
    duration: track.durationSeconds || Math.round((track.durationMs || 180000) / 1000),
  }

  const parsed = lastFmTrackPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    recordLastFmMetric('errors')
    return false
  }

  recordLastFmMetric('nowPlayingUpdates')

  const timeoutMs = options.timeoutMs ?? 5000
  const timeoutCtrl = new AbortController()
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs)

  try {
    const res = await fetch('/api/lastfm/now-playing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
      signal: options.signal
        ? anySignal([options.signal, timeoutCtrl.signal])
        : timeoutCtrl.signal,
    })
    clearTimeout(timer)
    if (res.ok) {
      activeNowPlayingKey = nowKey
      return true
    }
    return false
  } catch (err: unknown) {
    clearTimeout(timer)
    if (options.signal?.aborted) {
      recordLastFmMetric('cancellations')
    } else {
      recordLastFmMetric('errors')
    }
    return false
  }
}

export async function scrobbleLastFmTrack(
  track: Track,
  sessionKey: string,
  timestamp?: number,
  options: LastFmRequestOptions = {},
): Promise<boolean> {
  const trackTitle = track.title?.trim()
  const artistName = track.artistName?.trim() || 'Unknown Artist'
  if (!trackTitle || !sessionKey) return false

  const scrobbleTimestamp = timestamp || Math.floor(Date.now() / 1000)
  const scrobbleKey = `${sessionKey}__${trackTitle}__${artistName}`.toLowerCase()

  // Deduplicate if scrobbled the exact same track within 30 seconds
  if (
    lastScrobbledKey === scrobbleKey &&
    Math.abs(scrobbleTimestamp - lastScrobbledTimestamp) < 30
  ) {
    recordLastFmMetric('deduplications')
    return true
  }

  const payload = {
    sessionKey,
    track: trackTitle,
    artist: artistName,
    album: track.albumTitle?.trim() || undefined,
    duration: track.durationSeconds || Math.round((track.durationMs || 180000) / 1000),
    timestamp: scrobbleTimestamp,
  }

  const parsed = lastFmTrackPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    recordLastFmMetric('errors')
    return false
  }

  recordLastFmMetric('scrobblesQueued')

  const timeoutMs = options.timeoutMs ?? 8000
  const timeoutCtrl = new AbortController()
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs)

  try {
    const postScrobble = async () => {
      const res = await fetch('/api/lastfm/scrobble', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
        signal: options.signal
          ? anySignal([options.signal, timeoutCtrl.signal])
          : timeoutCtrl.signal,
      })
      if (!res.ok) {
        throw new Error(`Scrobble failed HTTP ${res.status}`)
      }
      return true
    }

    try {
      await postScrobble()
    } catch (err: unknown) {
      if (options.signal?.aborted || timeoutCtrl.signal.aborted) throw err
      if (!options.skipRetry) {
        recordLastFmMetric('retries')
        const jitter = Math.floor(Math.random() * 100) + 50
        await new Promise((r) => setTimeout(r, jitter))
        await postScrobble()
      } else {
        throw err
      }
    }

    clearTimeout(timer)
    lastScrobbledKey = scrobbleKey
    lastScrobbledTimestamp = scrobbleTimestamp
    recordLastFmMetric('scrobblesSucceeded')
    return true
  } catch (err: unknown) {
    clearTimeout(timer)
    if (options.signal?.aborted) {
      recordLastFmMetric('cancellations')
    } else {
      recordLastFmMetric('scrobblesFailed')
      recordLastFmMetric('errors')
    }
    return false
  }
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const s of signals) {
    if (s.aborted) {
      controller.abort()
      return controller.signal
    }
    s.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return controller.signal
}
