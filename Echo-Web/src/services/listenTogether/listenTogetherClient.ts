import type { Track } from '../../types/domain.ts'
import { buildApiUrl } from '../api.ts'

export interface RoomParticipant {
  id: string
  name: string
  isHost: boolean
  isBuffering: boolean
  lastSeen: number
}

export interface RoomEventLog {
  id: string
  time: number
  message: string
}

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
  private broadcastChannel: BroadcastChannel | null = null

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
      members: [...this.state.members],
      logs: [...this.state.logs],
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

  public async createRoom(hostName = 'Host'): Promise<SynchronizedRoomState> {
    this.leaveRoom()

    const res = await fetch(buildApiUrl('/api/listen-together/create'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostName }),
    })

    if (!res.ok) {
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
      userName: hostName,
      track: data.room.track,
      isPlaying: data.room.isPlaying,
      playbackPositionSeconds: data.room.playbackPositionSeconds,
      members: [...data.room.members],
      logs: [...data.room.logs],
      revision: 1,
    }

    this.startSyncLoop()
    this.notify()
    return this.getState()!
  }

  public async joinRoom(code: string, userName = 'Guest'): Promise<SynchronizedRoomState> {
    this.leaveRoom()

    const cleanCode = code.trim().toUpperCase()
    if (!cleanCode || (cleanCode.length !== 6 && cleanCode.length !== 8)) {
      throw new Error('Please enter a valid 6-character room code')
    }

    const res = await fetch(buildApiUrl('/api/listen-together/join'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: cleanCode, userName }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Failed to join room ${cleanCode}`)
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
      userName,
      track: data.room.track,
      isPlaying: data.room.isPlaying,
      playbackPositionSeconds: data.room.playbackPositionSeconds,
      members: [...data.room.members],
      logs: [...data.room.logs],
      revision: 1,
    }

    this.startSyncLoop()
    this.notify()
    return this.getState()!
  }

  public leaveRoom(): void {
    if (this.syncTimer !== null) {
      window.clearInterval(this.syncTimer)
      this.syncTimer = null
    }
    if (this.hostThrottleTimer !== null) {
      window.clearTimeout(this.hostThrottleTimer)
      this.hostThrottleTimer = null
    }
    this.isSyncInProgress = false
    this.pendingSyncAction = null

    if (this.state) {
      // Fire and forget leave
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

    this.state = {
      ...this.state,
      track,
      isPlaying,
      playbackPositionSeconds: positionSeconds,
      revision: this.state.revision + 1,
    }

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
        window.clearTimeout(this.hostThrottleTimer)
        this.hostThrottleTimer = null
      }
      this.lastHostSyncTime = now
      this.performSync('update_state')
    } else if (this.hostThrottleTimer === null) {
      const delay = Math.max(0, 1000 - (now - this.lastHostSyncTime))
      this.hostThrottleTimer = window.setTimeout(() => {
        this.hostThrottleTimer = null
        this.lastHostSyncTime = Date.now()
        this.performSync('update_state')
      }, delay)
    }
  }

  private startSyncLoop() {
    if (this.syncTimer !== null) {
      window.clearInterval(this.syncTimer)
    }

    this.syncTimer = window.setInterval(() => {
      this.performSync('heartbeat')
    }, 1500)
  }

  private async performSync(action: 'update_state' | 'heartbeat') {
    if (!this.state) return

    // Serialize and coalesce in-flight requests to eliminate backend flooding
    if (this.isSyncInProgress) {
      if (action === 'update_state') {
        this.pendingSyncAction = 'update_state'
      } else if (!this.pendingSyncAction) {
        this.pendingSyncAction = 'heartbeat'
      }
      return
    }

    this.isSyncInProgress = true
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
      })

      if (!res.ok) return

      const data = (await res.json()) as {
        isPlaying: boolean
        playbackPositionSeconds: number
        track: Track | null
        members: RoomParticipant[]
        logs: RoomEventLog[]
      }

      this.state = {
        ...this.state,
        ...(!this.state.isHost
          ? {
              isPlaying: data.isPlaying,
              playbackPositionSeconds: data.playbackPositionSeconds,
              track: data.track,
            }
          : {}),
        members: data.members ? [...data.members] : [],
        logs: data.logs ? [...data.logs] : [],
        revision: this.state.revision + 1,
      }
      this.notify()
    } catch {
      // Ignore transient network errors
    } finally {
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

export const listenTogether = ListenTogetherClient.getInstance()
