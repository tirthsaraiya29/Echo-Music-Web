import type { Track } from '../../types/domain.ts'
import { useEchoStore } from '../../stores/useEchoStore.ts'

export async function updateDiscordPresence(
  track: Track,
  isPlaying: boolean,
  positionSeconds = 0,
): Promise<void> {
  const prefs = useEchoStore.getState().preferences
  if (!prefs.discordRpc) return

  const payload = {
    track: track.title,
    artist: track.artistName || 'Unknown Artist',
    album: track.albumTitle || undefined,
    durationMs:
      track.durationMs || (track.durationSeconds ? track.durationSeconds * 1000 : undefined),
    positionMs: Math.round(positionSeconds * 1000),
    isPlaying,
  }

  const mode = prefs.discordMode || 'auto'
  const bridgeUrl = (prefs.discordBridgeUrl || 'http://127.0.0.1:6463').replace(/\/+$/, '')

  // Companion Mode: dispatch directly to client desktop companion bridge
  if (mode === 'companion') {
    try {
      await fetch(`${bridgeUrl}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        mode: 'cors',
      })
      return
    } catch {
      // Companion unavailable
      return
    }
  }

  // Backend Mode or Auto Mode
  try {
    const res = await fetch('/api/discord/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (res.ok) {
      const data = (await res.json()) as { active?: boolean; remoteDeployment?: boolean }
      // In Auto mode, if backend is remote, fallback to client companion bridge
      if (mode === 'auto' && (data.remoteDeployment || data.active === false)) {
        try {
          await fetch(`${bridgeUrl}/presence`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            mode: 'cors',
          })
        } catch {
          // Companion fallback not running
        }
      }
    }
  } catch {
    // Backend unreachable: in Auto mode fallback to companion bridge directly
    if (mode === 'auto') {
      try {
        await fetch(`${bridgeUrl}/presence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          mode: 'cors',
        })
      } catch {
        // Ignored
      }
    }
  }
}

export async function clearDiscordPresence(): Promise<void> {
  const prefs = useEchoStore.getState().preferences
  const mode = prefs.discordMode || 'auto'
  const bridgeUrl = (prefs.discordBridgeUrl || 'http://127.0.0.1:6463').replace(/\/+$/, '')

  // Clear backend IPC
  try {
    await fetch('/api/discord/clear', {
      method: 'POST',
    })
  } catch {
    // Non-fatal
  }

  // Clear desktop companion bridge if configured or in auto mode
  if (mode === 'companion' || mode === 'auto') {
    try {
      await fetch(`${bridgeUrl}/clear`, {
        method: 'POST',
        mode: 'cors',
      })
    } catch {
      // Ignored
    }
  }
}
