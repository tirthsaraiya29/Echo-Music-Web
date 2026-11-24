import { Hono, type Context } from 'hono'
import { randomUUID, randomBytes } from 'node:crypto'
import { getConnInfo } from '@hono/node-server/conninfo'

export const listenTogetherRouter = new Hono()

export interface RoomMember {
  id: string
  name: string
  isHost: boolean
  lastSeen: number
  isBuffering: boolean
  // Secret per-participant token; sync requests must present it to act as this member
  token: string
}

export interface RoomState {
  code: string
  hostId: string
  createdAt: number
  track: unknown | null
  isPlaying: boolean
  playbackPositionSeconds: number
  lastUpdatedServerTime: number // playback anchor timestamp
  lastActiveServerTime: number // room heartbeat/activity timestamp
  members: Map<string, RoomMember>
  logs: Array<{ id: string; time: number; message: string }>
}

export interface RoomStore {
  get(code: string): Promise<RoomState | undefined> | RoomState | undefined
  set(code: string, room: RoomState): Promise<void> | void
  delete(code: string): Promise<boolean> | boolean
  has(code: string): Promise<boolean> | boolean
  size(): Promise<number> | number
  cleanup(staleThresholdMs: number): Promise<number> | number
}

export class MemoryRoomStore implements RoomStore {
  private rooms = new Map<string, RoomState>()

  get(code: string): RoomState | undefined {
    return this.rooms.get(code)
  }

  set(code: string, room: RoomState): void {
    this.rooms.set(code, room)
  }

  delete(code: string): boolean {
    return this.rooms.delete(code)
  }

  has(code: string): boolean {
    return this.rooms.has(code)
  }

  size(): number {
    return this.rooms.size
  }

  cleanup(staleThresholdMs: number): number {
    const now = Date.now()
    let pruned = 0
    for (const [code, room] of this.rooms.entries()) {
      const host = room.members.get(room.hostId)
      const hasActiveHost = Boolean(host && now - host.lastSeen < 60000)
      const isRecentlyActive = now - room.lastActiveServerTime <= staleThresholdMs
      // Room is preserved if recently active or host is currently connected/heartbeating
      if (!hasActiveHost && !isRecentlyActive) {
        this.rooms.delete(code)
        pruned++
      }
    }
    return pruned
  }
}

let globalRoomStore: RoomStore = new MemoryRoomStore()

export function getRoomStore(): RoomStore {
  return globalRoomStore
}

export function setRoomStore(store: RoomStore): void {
  globalRoomStore = store
}

// Fixed-window rate limiting per IP to blunt code guessing and sync spam
const joinAttemptsByIp = new Map<string, { windowStart: number; count: number }>()
const JOIN_LIMIT_PER_WINDOW = 20
const JOIN_WINDOW_MS = 10 * 60 * 1000

export function isJoinRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = joinAttemptsByIp.get(ip)
  if (!entry || now - entry.windowStart > JOIN_WINDOW_MS) {
    joinAttemptsByIp.set(ip, { windowStart: now, count: 1 })
    if (joinAttemptsByIp.size > 10000) {
      for (const [key, value] of joinAttemptsByIp.entries()) {
        if (now - value.windowStart > JOIN_WINDOW_MS) joinAttemptsByIp.delete(key)
      }
    }
    return false
  }
  entry.count++
  return entry.count > JOIN_LIMIT_PER_WINDOW
}

export function resetJoinRateLimits(): void {
  joinAttemptsByIp.clear()
}

// Fixed-window rate limiting per IP for room creation to prevent resource exhaustion
const createAttemptsByIp = new Map<string, { windowStart: number; count: number }>()
const CREATE_LIMIT_PER_WINDOW = 10
const CREATE_WINDOW_MS = 10 * 60 * 1000

export function isCreateRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = createAttemptsByIp.get(ip)
  if (!entry || now - entry.windowStart > CREATE_WINDOW_MS) {
    createAttemptsByIp.set(ip, { windowStart: now, count: 1 })
    if (createAttemptsByIp.size > 10000) {
      for (const [key, value] of createAttemptsByIp.entries()) {
        if (now - value.windowStart > CREATE_WINDOW_MS) createAttemptsByIp.delete(key)
      }
    }
    return false
  }
  entry.count++
  return entry.count > CREATE_LIMIT_PER_WINDOW
}

export function resetCreateRateLimits(): void {
  createAttemptsByIp.clear()
}

/**
 * Derives the trusted client IP for rate limiting. Untrusted forwarded headers
 * (like X-Forwarded-For) are ignored by default to prevent rate-limit evasion,
 * unless TRUST_PROXY is explicitly enabled by platform configuration.
 */
export function getClientIp(c: Context): string {
  const trustProxy = process.env['TRUST_PROXY'] === 'true' || process.env['TRUST_PROXY'] === '1'
  if (trustProxy) {
    const cfIp = c.req.header('cf-connecting-ip')?.trim()
    if (cfIp) return cfIp
    const xRealIp = c.req.header('x-real-ip')?.trim()
    if (xRealIp) return xRealIp
    const forwarded = c.req.header('x-forwarded-for')
    if (forwarded) {
      const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean)
      if (parts.length > 0 && parts[0]) {
        return parts[0]
      }
    }
  }

  // Use platform socket connection info
  try {
    const connInfo = getConnInfo(c)
    if (connInfo?.remote?.address) {
      return connInfo.remote.address
    }
  } catch {
    // Context does not support getConnInfo
  }

  const envRemote = (c.env as Record<string, unknown> | undefined)?.['remoteAddress']
  if (typeof envRemote === 'string' && envRemote.trim()) {
    return envRemote.trim()
  }

  return '127.0.0.1'
}

// Cleanup stale rooms every 5 minutes
const cleanupTimer = setInterval(
  async () => {
    await globalRoomStore.cleanup(30 * 60 * 1000)
  },
  5 * 60 * 1000,
)

if (typeof cleanupTimer?.unref === 'function') {
  cleanupTimer.unref()
}

// Room code contract: standard 6-character room codes from unambiguous alphabet.
// Accepts 6 to 8 alphanumeric characters for client validation compatibility.
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 32 symbols
export const ROOM_CODE_LENGTH = 6

export function isValidRoomCode(code: string): boolean {
  if (typeof code !== 'string') return false
  const clean = code.trim().toUpperCase()
  return (clean.length === 6 || clean.length === 8) && /^[A-Z0-9]+$/.test(clean)
}

export function generateRoomCode(): string {
  const bytes = randomBytes(ROOM_CODE_LENGTH)
  let result = ''
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    // 256 is an exact multiple of 32 (8 * 32 = 256), yielding uniform distribution without modulo bias
    const idx = bytes[i]! % ROOM_CODE_ALPHABET.length
    result += ROOM_CODE_ALPHABET.charAt(idx)
  }
  return result
}

// Public room view: never exposes hostId or member tokens
export const MAX_GLOBAL_ROOMS = 1000
export const MAX_ROOM_MEMBERS = 50
export const MAX_ROOM_LOGS = 50
export const MAX_NAME_LENGTH = 32
export const MAX_TRACK_STRING_LENGTH = 256
export const MAX_TRACK_URL_LENGTH = 1024
export const MAX_PLAYBACK_POSITION_SECONDS = 86400 // 24 hours

export function appendRoomLog(room: RoomState, message: string): void {
  const cleanMessage = (message || '').trim().slice(0, 120)
  room.logs.push({
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    time: Date.now(),
    message: cleanMessage,
  })
  if (room.logs.length > MAX_ROOM_LOGS) {
    room.logs.splice(0, room.logs.length - MAX_ROOM_LOGS)
  }
}

export function sanitizeName(raw: unknown, defaultName: string): string {
  if (typeof raw !== 'string') return defaultName
  const trimmed = raw.trim()
  if (!trimmed) return defaultName
  return trimmed.slice(0, MAX_NAME_LENGTH)
}

export function sanitizeTrackPayload(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const id = typeof obj['id'] === 'string' ? obj['id'].trim().slice(0, 128) : ''
  const title = typeof obj['title'] === 'string' ? obj['title'].trim().slice(0, MAX_TRACK_STRING_LENGTH) : ''
  const artist = typeof obj['artist'] === 'string' ? obj['artist'].trim().slice(0, MAX_TRACK_STRING_LENGTH) : ''
  const album = typeof obj['album'] === 'string' ? obj['album'].trim().slice(0, MAX_TRACK_STRING_LENGTH) : undefined
  const artwork = typeof obj['artwork'] === 'string' ? obj['artwork'].trim().slice(0, MAX_TRACK_URL_LENGTH) : undefined
  const artworkUrl = typeof obj['artworkUrl'] === 'string' ? obj['artworkUrl'].trim().slice(0, MAX_TRACK_URL_LENGTH) : artwork

  let durationMs: number | undefined
  if (typeof obj['durationMs'] === 'number' && Number.isFinite(obj['durationMs'])) {
    durationMs = Math.max(0, Math.min(obj['durationMs'], 86400000))
  } else if (typeof obj['duration'] === 'number' && Number.isFinite(obj['duration'])) {
    durationMs = Math.max(0, Math.min(obj['duration'] * 1000, 86400000))
  }

  // At least id or title must be non-empty for a valid track payload
  if (!id && !title) return null

  const sanitized: Record<string, unknown> = {
    id: id || `track_${Date.now()}`,
    title: title || 'Unknown Title',
    artist: artist || 'Unknown Artist',
  }
  if (album) sanitized['album'] = album
  if (artworkUrl) {
    sanitized['artwork'] = artworkUrl
    sanitized['artworkUrl'] = artworkUrl
  }
  if (durationMs !== undefined) {
    sanitized['durationMs'] = durationMs
    sanitized['duration'] = Math.round(durationMs / 1000)
  }
  if (typeof obj['source'] === 'string') sanitized['source'] = obj['source'].slice(0, 64)
  if (typeof obj['isExplicit'] === 'boolean') sanitized['isExplicit'] = obj['isExplicit']
  if (typeof obj['uri'] === 'string') sanitized['uri'] = obj['uri'].slice(0, MAX_TRACK_URL_LENGTH)

  return sanitized
}

// Public room view: never exposes hostId or member tokens
export function publicRoomView(room: RoomState, positionSeconds: number) {
  return {
    code: room.code,
    isPlaying: room.isPlaying,
    playbackPositionSeconds: positionSeconds,
    track: room.track,
    members: Array.from(room.members.values()).map(({ id, name, isHost, isBuffering }) => ({
      id,
      name,
      isHost,
      isBuffering,
    })),
    logs: room.logs.slice(-20),
  }
}

// Create a new listening room
listenTogetherRouter.post('/create', async (c) => {
  const ip = getClientIp(c)
  if (isCreateRateLimited(ip)) {
    return c.json({ error: 'Too many room creations. Try again later.' }, 429)
  }

  const currentRooms = await globalRoomStore.size()
  if (currentRooms >= MAX_GLOBAL_ROOMS) {
    await globalRoomStore.cleanup(5 * 60 * 1000)
    const afterCleanup = await globalRoomStore.size()
    if (afterCleanup >= MAX_GLOBAL_ROOMS) {
      return c.json({ error: 'Server room capacity reached. Please try again later.' }, 503)
    }
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    hostName?: string
  }
  const hostId = `host_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const hostToken = randomUUID()
  const hostName = sanitizeName(body.hostName, 'Host')

  let code = generateRoomCode()
  let attempts = 0
  while (await globalRoomStore.has(code)) {
    code = generateRoomCode()
    attempts++
    if (attempts > 50) {
      return c.json({ error: 'Failed to allocate unique room code' }, 503)
    }
  }

  const room: RoomState = {
    code,
    hostId,
    createdAt: Date.now(),
    track: null,
    isPlaying: false,
    playbackPositionSeconds: 0,
    lastUpdatedServerTime: Date.now(),
    lastActiveServerTime: Date.now(),
    members: new Map([
      [
        hostId,
        {
          id: hostId,
          name: hostName,
          isHost: true,
          lastSeen: Date.now(),
          isBuffering: false,
          token: hostToken,
        },
      ],
    ]),
    logs: [],
  }
  appendRoomLog(room, `Room created by ${hostName}`)

  await globalRoomStore.set(code, room)

  return c.json({
    code,
    userId: hostId,
    token: hostToken,
    room: publicRoomView(room, room.playbackPositionSeconds),
  })
})

// Join an existing room
listenTogetherRouter.post('/join', async (c) => {
  const ip = getClientIp(c)
  if (isJoinRateLimited(ip)) {
    return c.json({ error: 'Too many join attempts. Try again later.' }, 429)
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    code?: string
    userName?: string
  }
  const code = (body.code || '').trim().toUpperCase()
  if (!code || !isValidRoomCode(code)) {
    return c.json({ error: 'Please enter a valid room code (6 characters).' }, 400)
  }
  const room = await globalRoomStore.get(code)

  if (!room) {
    return c.json({ error: 'Room not found or expired' }, 404)
  }
  if (room.members.size >= MAX_ROOM_MEMBERS) {
    return c.json({ error: 'Room is full' }, 409)
  }

  const userId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const userToken = randomUUID()
  const userName = sanitizeName(body.userName, 'Guest')

  const member: RoomMember = {
    id: userId,
    name: userName,
    isHost: false,
    lastSeen: Date.now(),
    isBuffering: false,
    token: userToken,
  }

  room.members.set(userId, member)
  room.lastActiveServerTime = Date.now()
  appendRoomLog(room, `${userName} joined the room`)

  // Estimate current position if playing
  const elapsed = room.isPlaying ? (Date.now() - room.lastUpdatedServerTime) / 1000 : 0
  const estimatedPosition = room.playbackPositionSeconds + elapsed

  await globalRoomStore.set(code, room)

  return c.json({
    code: room.code,
    userId,
    isHost: false,
    token: userToken,
    room: publicRoomView(room, estimatedPosition),
  })
})

// Sync/Poll endpoint: receives host or member updates, returns current state
listenTogetherRouter.post('/sync', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    code?: string
    userId?: string
    token?: string
    action?: 'update_state' | 'heartbeat' | 'leave'
    track?: unknown
    isPlaying?: boolean
    playbackPositionSeconds?: number
    isBuffering?: boolean
  }

  const code = (body.code || '').trim().toUpperCase()
  if (!code || !isValidRoomCode(code)) {
    return c.json({ error: 'Invalid room code format' }, 400)
  }
  const room = await globalRoomStore.get(code)

  if (!room) {
    return c.json({ error: 'Room not found' }, 404)
  }

  const userId = body.userId || ''
  const member = room.members.get(userId)
  // Membership is authenticated: a request that does not present the secret token issued at
  // create/join time is not a member, so it cannot act for (or observe) the room.
  if (!member || member.token !== body.token) {
    return c.json({ error: 'Not a room member' }, 403)
  }

  member.lastSeen = Date.now()
  room.lastActiveServerTime = Date.now()
  if (typeof body.isBuffering === 'boolean') {
    member.isBuffering = body.isBuffering
  }

  if (body.action === 'leave') {
    room.members.delete(userId)
    appendRoomLog(room, `${member.name} left the room`)
    await globalRoomStore.set(code, room)
    return c.json({ status: 'left' })
  }

  // Only the authenticated host can push playback state
  if (userId === room.hostId && body.action === 'update_state') {
    if (body.track !== undefined) {
      room.track = sanitizeTrackPayload(body.track)
    }
    if (typeof body.isPlaying === 'boolean') {
      room.isPlaying = body.isPlaying
    }
    if (typeof body.playbackPositionSeconds === 'number' && Number.isFinite(body.playbackPositionSeconds)) {
      room.playbackPositionSeconds = Math.max(0, Math.min(body.playbackPositionSeconds, MAX_PLAYBACK_POSITION_SECONDS))
    }
    room.lastUpdatedServerTime = Date.now()
  }

  // Calculate current interpolated playback position
  const elapsed = room.isPlaying ? (Date.now() - room.lastUpdatedServerTime) / 1000 : 0
  const estimatedPosition = room.playbackPositionSeconds + elapsed

  // Prune inactive members (> 45s without sync)
  const now = Date.now()
  for (const [id, m] of room.members.entries()) {
    if (id !== room.hostId && now - m.lastSeen > 45000) {
      room.members.delete(id)
    }
  }

  await globalRoomStore.set(code, room)

  return c.json(publicRoomView(room, estimatedPosition))
})
