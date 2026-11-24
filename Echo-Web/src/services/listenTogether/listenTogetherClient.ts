import type { Track } from '../../types/domain.ts'
import { buildApiUrl } from '../api.ts'
import {
  createRoomInputSchema,
  joinRoomInputSchema,
  recordListenTogetherMetric,
  type RoomParticipant,
  type RoomEventLog,
} from './listenTogetherTypes.ts'

export type { RoomParticipant, RoomEventLog }

export interface SynchronizedRoomState {
  code: string
  isHost: boolean
  userId: string
  // Secret token issued by the server at create/join; required for every sync call
  token: string
  userName: string
  track: Track | null
  isPlaying: boolean
  playbackPositionSeconds: number
  members: RoomParticipant[]
  logs: RoomEventLog[]
  revision: number
}

export interface ListenTogetherRequestOptions {
  signal?: AbortSignal | undefined
  timeoutMs?: number | undefined
}

type RoomListener = (state: SynchronizedRoomState) => void

export class ListenTogetherClient {
  private static instance: ListenTogetherClient | null = null

  private state: SynchronizedRoomState | null = null
  private listeners = new Set<RoomListener>()
  private syncTimer: number | null = null
  private hostThrottleTimer: number | null = null
  private lastHostSyncTime = 0
  private isSyncInProgress = false
  private pendingSyncAction: ('update_state' | 'heartbeat') | null = null
  private activeSyncController: AbortController | null = null
  private broadcastChannel: BroadcastChannel | null = null

  private lastDispatchedTrackId: string | null = null
  private lastDispatchedPlaying: boolean | null = null
  private lastDispatchedPosition = -1

  private constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.broadcastChannel = new BroadcastChannel('echo_listen_together')
        this.broadcastChannel.onmessage = (e) => {
          if (e.data && e.data.type === 'SYNC_STATE' && this.state) {
            this.handleLocalBroadcast(e.data.payload)
          }
        }
      } catch {
        // BroadcastChannel unavailable
      }
    }
  }

  public static getInstance(): ListenTogetherClient {
    if (!ListenTogetherClient.instance) {
      ListenTogetherClient.instance = new ListenTogetherClient()
    }
    return ListenTogetherClient.instance
  }

  public getState(): SynchronizedRoomState | null {
    if (!this.state) return null
    return {
      ...this.state,
      members: this.state.members.map((m) => ({ ...m })),
      logs: this.state.logs.map((l) => ({ ...l })),
    }
  }

  public subscribe(listener: RoomListener): () => void {
    this.listeners.add(listener)
    const current = this.getState()
    if (current) {
      listener(current)
    }
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify() {
    const current = this.getState()
    if (!current) return
    for (const listener of this.listeners) {
      listener(current)
    }
  }

  public async createRoom(
    hostName = 'Host',
    options: ListenTogetherRequestOptions = {},
  ): Promise<SynchronizedRoomState> {
    const parsed = createRoomInputSchema.safeParse({ hostName })
    if (!parsed.success) {
      recordListenTogetherMetric('networkErrors')
      throw new Error(parsed.error.issues[0]?.message || 'Invalid host name')
    }

    this.leaveRoom()

    const timeoutMs = options.timeoutMs ?? 6000
    const timeoutCtrl = new AbortController()
    const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs)
    const combinedSignal = anySignal(
      [options.signal, timeoutCtrl.signal].filter((s): s is AbortSignal => s !== undefined),
    )

    try {
      const res = await fetch(buildApiUrl('/api/listen-together/create'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostName: parsed.data.hostName }),
        signal: combinedSignal,
      })
      clearTimeout(timer)

      if (!res.ok) {
        recordListenTogetherMetric('networkErrors')
        throw new Error(`Failed to create listening room (HTTP ${res.status})`)
      }

      const data = (await res.json()) as {
        code: string
        userId: string
        token: string
        room: {
          code: string
          isPlaying: boolean
          playbackPositionSeconds: number
          track: Track | null
          members: RoomParticipant[]
          logs: RoomEventLog[]
        }
      }

      this.state = {
        code: data.code,
        isHost: true,
        userId: data.userId,
        token: data.token,
        userName: parsed.data.hostName,
        track: data.room.track,
        isPlaying: data.room.isPlaying,
        playbackPositionSeconds: data.room.playbackPositionSeconds,
        members: data.room.members.map((m) => ({ ...m })),
        logs: data.room.logs.map((l) => ({ ...l })),
        revision: 1,
      }

      this.lastDispatchedTrackId = data.room.track?.id ?? null
      this.lastDispatchedPlaying = data.room.isPlaying
      this.lastDispatchedPosition = data.room.playbackPositionSeconds

      recordListenTogetherMetric('roomsCreated')
      this.startSyncLoop()
      this.notify()
      return this.getState()!
    } catch (err: unknown) {
      clearTimeout(timer)
      if (combinedSignal.aborted) {
        recordListenTogetherMetric('cancellations')
      } else {
        recordListenTogetherMetric('networkErrors')
      }
      throw err
    }
  }

  public async joinRoom(
    code: string,
    userName = 'Guest',
    options: ListenTogetherRequestOptions = {},
  ): Promise<SynchronizedRoomState> {
    const parsed = joinRoomInputSchema.safeParse({ code, userName })
    if (!parsed.success) {
      recordListenTogetherMetric('networkErrors')
      throw new Error(parsed.error.issues[0]?.message || 'Invalid room code or nickname')
    }

    this.leaveRoom()

    const timeoutMs = options.timeoutMs ?? 6000
    const timeoutCtrl = new AbortController()
    const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs)
    const combinedSignal = anySignal(
      [options.signal, timeoutCtrl.signal].filter((s): s is AbortSignal => s !== undefined),
    )

    try {
      const res = await fetch(buildApiUrl('/api/listen-together/join'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: parsed.data.code, userName: parsed.data.userName }),
        signal: combinedSignal,
      })
      clearTimeout(timer)

      if (!res.ok) {
        recordListenTogetherMetric('networkErrors')
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || `Failed to join room ${parsed.data.code}`)
      }

      const data = (await res.json()) as {
        code: string
        userId: string
        isHost: boolean
        token: string
        room: {
          code: string
          isPlaying: boolean
          playbackPositionSeconds: number
          track: Track | null
          members: RoomParticipant[]
          logs: RoomEventLog[]
        }
      }

      this.state = {
        code: data.code,
        isHost: data.isHost,
        userId: data.userId,
        token: data.token,
        userName: parsed.data.userName,
        track: data.room.track,
        isPlaying: data.room.isPlaying,
        playbackPositionSeconds: data.room.playbackPositionSeconds,
        members: data.room.members.map((m) => ({ ...m })),
        logs: data.room.logs.map((l) => ({ ...l })),
        revision: 1,
      }

      recordListenTogetherMetric('roomsJoined')
      this.startSyncLoop()
      this.notify()
      return this.getState()!
    } catch (err: unknown) {
      clearTimeout(timer)
      if (combinedSignal.aborted) {
        recordListenTogetherMetric('cancellations')
      } else {
        recordListenTogetherMetric('networkErrors')
      }
      throw err
    }
  }

  public leaveRoom(): void {
    if (this.syncTimer !== null) {
      if (typeof window !== 'undefined') window.clearInterval(this.syncTimer)
      else clearInterval(this.syncTimer)
      this.syncTimer = null
    }
    if (this.hostThrottleTimer !== null) {
      if (typeof window !== 'undefined') window.clearTimeout(this.hostThrottleTimer)
      else clearTimeout(this.hostThrottleTimer)
      this.hostThrottleTimer = null
    }
    if (this.activeSyncController) {
      this.activeSyncController.abort()
      this.activeSyncController = null
    }
    this.isSyncInProgress = false
    this.pendingSyncAction = null

    if (this.state) {
      recordListenTogetherMetric('roomsLeft')
      // Fire and forget leave notification
      fetch(buildApiUrl('/api/listen-together/sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: this.state.code,
          userId: this.state.userId,
          token: this.state.token,
          action: 'leave',
        }),
      }).catch(() => {})
    }

    this.state = null
    this.lastDispatchedTrackId = null
    this.lastDispatchedPlaying = null
    this.lastDispatchedPosition = -1

    const emptyState: SynchronizedRoomState = {
      code: '',
      isHost: false,
      userId: '',
      token: '',
      userName: '',
      track: null,
      isPlaying: false,
      playbackPositionSeconds: 0,
      members: [],
      logs: [],
      revision: 0,
    }
    for (const listener of this.listeners) {
      listener(emptyState)
    }
  }

  public updateHostPlayback(
    track: Track | null,
    isPlaying: boolean,
    positionSeconds: number,
    immediate = false,
  ): void {
    if (!this.state || !this.state.isHost) return

    // Deduplication check: if track, playing status, and position within 1.5s haven't changed, skip
    const trackId = track?.id ?? null
    if (
      !immediate &&
      this.lastDispatchedTrackId === trackId &&
      this.lastDispatchedPlaying === isPlaying &&
      Math.abs(this.lastDispatchedPosition - positionSeconds) < 1.5
    ) {
      recordListenTogetherMetric('deduplications')
      return
    }

    this.state = {
      ...this.state,
      track,
      isPlaying,
      playbackPositionSeconds: positionSeconds,
      revision: this.state.revision + 1,
    }

    this.lastDispatchedTrackId = trackId
    this.lastDispatchedPlaying = isPlaying
    this.lastDispatchedPosition = positionSeconds

    // Push local broadcast
    this.broadcastChannel?.postMessage({
      type: 'SYNC_STATE',
      payload: {
        code: this.state.code,
        track,
        isPlaying,
        playbackPositionSeconds: positionSeconds,
      },
    })

    const now = Date.now()
    if (immediate || now - this.lastHostSyncTime >= 1000) {
      if (this.hostThrottleTimer !== null) {
        if (typeof window !== 'undefined') window.clearTimeout(this.hostThrottleTimer)
        else clearTimeout(this.hostThrottleTimer)
        this.hostThrottleTimer = null
      }
      this.lastHostSyncTime = now
      this.performSync('update_state')
    } else if (this.hostThrottleTimer === null) {
      const delay = Math.max(0, 1000 - (now - this.lastHostSyncTime))
      const scheduleFn = typeof window !== 'undefined' ? window.setTimeout : setTimeout
      this.hostThrottleTimer = scheduleFn(() => {
        this.hostThrottleTimer = null
        this.lastHostSyncTime = Date.now()
        this.performSync('update_state')
      }, delay) as unknown as number
    }
  }

  private startSyncLoop() {
    if (this.syncTimer !== null) {
      if (typeof window !== 'undefined') window.clearInterval(this.syncTimer)
      else clearInterval(this.syncTimer)
    }

    const intervalFn = typeof window !== 'undefined' ? window.setInterval : setInterval
    this.syncTimer = intervalFn(() => {
      this.performSync('heartbeat')
    }, 1500) as unknown as number
  }

  private async performSync(action: 'update_state' | 'heartbeat') {
    if (!this.state) return

    // Serialize and coalesce in-flight requests to eliminate backend flooding
    if (this.isSyncInProgress) {
      recordListenTogetherMetric('coalescedActions')
      if (action === 'update_state') {
        this.pendingSyncAction = 'update_state'
      } else if (!this.pendingSyncAction) {
        this.pendingSyncAction = 'heartbeat'
      }
      return
    }

    this.isSyncInProgress = true
    this.activeSyncController = new AbortController()
    const syncCtrl = this.activeSyncController

    if (action === 'update_state') {
      recordListenTogetherMetric('syncStateUpdates')
    } else {
      recordListenTogetherMetric('syncHeartbeats')
    }

    try {
      const res = await fetch(buildApiUrl('/api/listen-together/sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: this.state.code,
          userId: this.state.userId,
          token: this.state.token,
          action,
          track: this.state.track,
          isPlaying: this.state.isPlaying,
          playbackPositionSeconds: this.state.playbackPositionSeconds,
        }),
        signal: syncCtrl.signal,
      })

      if (!res.ok) {
        recordListenTogetherMetric('networkErrors')
        return
      }

      const data = (await res.json()) as {
        isPlaying: boolean
        playbackPositionSeconds: number
        track: Track | null
        members: RoomParticipant[]
        logs: RoomEventLog[]
      }

      if (!this.state) return

      this.state = {
        ...this.state,
        ...(!this.state.isHost
          ? {
              isPlaying: data.isPlaying,
              playbackPositionSeconds: data.playbackPositionSeconds,
              track: data.track,
            }
          : {}),
        members: data.members ? data.members.map((m) => ({ ...m })) : [],
        logs: data.logs ? data.logs.map((l) => ({ ...l })) : [],
        revision: this.state.revision + 1,
      }
      this.notify()
    } catch (err: unknown) {
      if (syncCtrl.signal.aborted) {
        recordListenTogetherMetric('cancellations')
      } else {
        recordListenTogetherMetric('networkErrors')
      }
    } finally {
      if (this.activeSyncController === syncCtrl) {
        this.activeSyncController = null
      }
      this.isSyncInProgress = false
      if (this.pendingSyncAction && this.state) {
        const nextAction = this.pendingSyncAction
        this.pendingSyncAction = null
        this.performSync(nextAction)
      }
    }
  }

  private handleLocalBroadcast(payload: {
    code: string
    track: Track | null
    isPlaying: boolean
    playbackPositionSeconds: number
  }) {
    if (!this.state || this.state.isHost || this.state.code !== payload.code) return

    this.state = {
      ...this.state,
      track: payload.track,
      isPlaying: payload.isPlaying,
      playbackPositionSeconds: payload.playbackPositionSeconds,
      revision: this.state.revision + 1,
    }
    this.notify()
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

export const listenTogether = ListenTogetherClient.getInstance()
