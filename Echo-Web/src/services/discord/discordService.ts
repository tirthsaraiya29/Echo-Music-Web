import type { Track } from '../../types/domain.ts'
import { useEchoStore } from '../../stores/useEchoStore.ts'
import {
  discordPresencePayloadSchema,
  recordDiscordMetric,
  type DiscordPresencePayload,
  type DiscordStatusResponse,
} from './discordTypes.ts'

export type { DiscordPresencePayload }

export interface DiscordRequestOptions {
  signal?: AbortSignal | undefined
  timeoutMs?: number | undefined
  force?: boolean | undefined
}

interface LastPresenceState {
  track: string
  artist: string
  isPlaying: boolean
  album?: string | undefined
  timestamp: number
}

let lastDispatched: LastPresenceState | null = null
let activePresenceController: AbortController | null = null

export function clearDiscordPresenceState(): void {
  lastDispatched = null
  if (activePresenceController) {
    activePresenceController.abort()
    activePresenceController = null
  }
}

export async function checkDiscordStatus(
  options: DiscordRequestOptions = {},
): Promise<DiscordStatusResponse | null> {
  const timeoutMs = options.timeoutMs ?? 4000
  const timeoutCtrl = new AbortController()
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs)

  try {
    const res = await fetch('/api/discord/status', {
      signal: options.signal
        ? anySignal([options.signal, timeoutCtrl.signal])
        : timeoutCtrl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null
    return (await res.json()) as DiscordStatusResponse
  } catch (err: unknown) {
    clearTimeout(timer)
    if (options.signal?.aborted) {
      recordDiscordMetric('cancellations')
    } else {
      recordDiscordMetric('errors')
    }
    return null
  }
}

export async function updateDiscordPresence(
  track: Track,
  isPlaying: boolean,
  positionSeconds = 0,
  options: DiscordRequestOptions = {},
): Promise<boolean> {
  const prefs = useEchoStore.getState().preferences
  if (!prefs.discordRpc) return false

  const trackTitle = track.title?.trim()
  const artistName = track.artistName?.trim() || 'Unknown Artist'
  if (!trackTitle) return false

  const durationMs =
    track.durationMs || (track.durationSeconds ? track.durationSeconds * 1000 : undefined)
  const positionMs = Math.round(positionSeconds * 1000)

  const rawPayload = {
    track: trackTitle,
    artist: artistName,
    album: track.albumTitle?.trim() || undefined,
    durationMs,
    positionMs,
    isPlaying,
  }

  const parsed = discordPresencePayloadSchema.safeParse(rawPayload)
  if (!parsed.success) {
    recordDiscordMetric('errors')
    return false
  }

  const now = Date.now()

  // Deduplicate if identical track, artist, play state and dispatched within last 3 seconds
  if (
    !options.force &&
    lastDispatched &&
    lastDispatched.track === trackTitle &&
    lastDispatched.artist === artistName &&
    lastDispatched.isPlaying === isPlaying &&
    lastDispatched.album === parsed.data.album &&
    now - lastDispatched.timestamp < 3000
  ) {
    recordDiscordMetric('deduplications')
    return true
  }

  // Abort previous in-flight request if any to coalesce rapid updates
  if (activePresenceController) {
    activePresenceController.abort()
  }
  activePresenceController = new AbortController()
  const localCtrl = activePresenceController

  recordDiscordMetric('updatesQueued')

  const mode = prefs.discordMode || 'auto'
  const bridgeUrl = (prefs.discordBridgeUrl || 'http://127.0.0.1:6463').replace(/\/+$/, '')

  const timeoutMs = options.timeoutMs ?? 4000
  const timeoutCtrl = new AbortController()
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs)

  const combinedSignal = anySignal(
    [options.signal, localCtrl.signal, timeoutCtrl.signal].filter(
      (s): s is AbortSignal => s !== undefined,
    ),
  )

  try {
    // Companion Mode: dispatch directly to client desktop companion bridge
    if (mode === 'companion') {
      try {
        const compRes = await fetch(`${bridgeUrl}/presence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.data),
          mode: 'cors',
          signal: combinedSignal,
        })
        clearTimeout(timer)
        if (compRes.ok) {
          lastDispatched = {
            track: trackTitle,
            artist: artistName,
            isPlaying,
            album: parsed.data.album,
            timestamp: now,
          }
          recordDiscordMetric('updatesSucceeded')
          return true
        }
        recordDiscordMetric('updatesFailed')
        return false
      } catch (err: unknown) {
        clearTimeout(timer)
        if (combinedSignal.aborted) {
          recordDiscordMetric('cancellations')
        } else {
          recordDiscordMetric('updatesFailed')
          recordDiscordMetric('errors')
        }
        return false
      }
    }

    // Backend Mode or Auto Mode
    const res = await fetch('/api/discord/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
      signal: combinedSignal,
    })

    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        active?: boolean
        remoteDeployment?: boolean
      }

      // In Auto mode, if backend is remote or socket not active, fallback to client companion bridge
      if (mode === 'auto' && (data.remoteDeployment || data.active === false)) {
        recordDiscordMetric('companionFallbacks')
        try {
          const compRes = await fetch(`${bridgeUrl}/presence`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(parsed.data),
            mode: 'cors',
            signal: combinedSignal,
          })
          clearTimeout(timer)
          if (compRes.ok) {
            lastDispatched = {
              track: trackTitle,
              artist: artistName,
              isPlaying,
              album: parsed.data.album,
              timestamp: now,
            }
            recordDiscordMetric('updatesSucceeded')
            return true
          }
        } catch {
          // Companion fallback not running
        }
      }

      clearTimeout(timer)
      lastDispatched = {
        track: trackTitle,
        artist: artistName,
        isPlaying,
        album: parsed.data.album,
        timestamp: now,
      }
      recordDiscordMetric('updatesSucceeded')
      return true
    } else {
      recordDiscordMetric('updatesFailed')
      recordDiscordMetric('errors')
      clearTimeout(timer)
      return false
    }
  } catch (err: unknown) {
    clearTimeout(timer)
    if (combinedSignal.aborted) {
      recordDiscordMetric('cancellations')
      return false
    }

    // Backend unreachable: in Auto mode fallback to companion bridge directly
    if (mode === 'auto') {
      recordDiscordMetric('companionFallbacks')
      try {
        const compRes = await fetch(`${bridgeUrl}/presence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.data),
          mode: 'cors',
          signal: combinedSignal,
        })
        if (compRes.ok) {
          lastDispatched = {
            track: trackTitle,
            artist: artistName,
            isPlaying,
            album: parsed.data.album,
            timestamp: now,
          }
          recordDiscordMetric('updatesSucceeded')
          return true
        }
      } catch {
        // Ignored
      }
    }

    recordDiscordMetric('updatesFailed')
    recordDiscordMetric('errors')
    return false
  } finally {
    if (activePresenceController === localCtrl) {
      activePresenceController = null
    }
  }
}

export async function clearDiscordPresence(options: DiscordRequestOptions = {}): Promise<void> {
  const prefs = useEchoStore.getState().preferences
  const mode = prefs.discordMode || 'auto'
  const bridgeUrl = (prefs.discordBridgeUrl || 'http://127.0.0.1:6463').replace(/\/+$/, '')

  lastDispatched = null
  if (activePresenceController) {
    activePresenceController.abort()
    activePresenceController = null
  }

  recordDiscordMetric('clearOperations')

  const timeoutMs = options.timeoutMs ?? 3000
  const timeoutCtrl = new AbortController()
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs)

  const combinedSignal = anySignal(
    [options.signal, timeoutCtrl.signal].filter((s): s is AbortSignal => s !== undefined),
  )

  // Clear backend IPC
  try {
    await fetch('/api/discord/clear', {
      method: 'POST',
      signal: combinedSignal,
    })
  } catch {
    // Non-fatal
  } finally {
    clearTimeout(timer)
  }

  // Clear desktop companion bridge if configured or in auto mode
  if (mode === 'companion' || mode === 'auto') {
    try {
      await fetch(`${bridgeUrl}/clear`, {
        method: 'POST',
        mode: 'cors',
        signal: combinedSignal,
      })
    } catch {
      // Ignored
    }
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
