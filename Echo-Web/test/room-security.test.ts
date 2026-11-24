import test from 'node:test'
import assert from 'node:assert'

import {
  roomLimitsSchema,
  roomSecurityMetricsSchema,
  calculateCodeEntropy,
  isSafeArtworkUrl,
  getRoomSecurityMetrics,
  resetRoomSecurityMetrics,
  recordRoomSecurityMetric,
  DEFAULT_ROOM_LIMITS,
} from '../server/routes/roomSecurity.ts'

import {
  listenTogetherRouter,
  isJoinRateLimited,
  isCreateRateLimited,
  resetJoinRateLimits,
  resetCreateRateLimits,
  sanitizeTrackPayload,
} from '../server/routes/listenTogether.ts'

test('Room Security: schemas validate system limits and metric structures [SMALL-38]', () => {
  const limits = roomLimitsSchema.parse({})
  assert.strictEqual(limits.maxGlobalRooms, 1000)
  assert.strictEqual(limits.maxRoomMembers, 50)
  assert.strictEqual(limits.maxRoomLogs, 50)
  assert.strictEqual(limits.maxNameLength, 32)
  assert.strictEqual(limits.maxPlaybackPositionSeconds, 86400)
})

test('Room Security: calculateCodeEntropy computes Shannon entropy correctly [SMALL-38]', () => {
  // 6 characters from 32-symbol alphabet = 6 * log2(32) = 6 * 5 = 30 bits
  assert.strictEqual(calculateCodeEntropy(6, 32), 30)
  // 8 characters from 32-symbol alphabet = 8 * 5 = 40 bits
  assert.strictEqual(calculateCodeEntropy(8, 32), 40)
  assert.strictEqual(calculateCodeEntropy(0, 32), 0)
  assert.strictEqual(calculateCodeEntropy(6, 1), 0)
})

test('Room Security: isSafeArtworkUrl enforces safe URL schemes [SMALL-38]', () => {
  assert.strictEqual(isSafeArtworkUrl('https://images.example.com/cover.jpg'), true)
  assert.strictEqual(isSafeArtworkUrl('http://images.example.com/cover.jpg'), true)

  // Disallow unsafe schemes and bad URLs
  assert.strictEqual(isSafeArtworkUrl('javascript:alert(1)'), false)
  assert.strictEqual(isSafeArtworkUrl('file:///etc/passwd'), false)
  assert.strictEqual(isSafeArtworkUrl('data:text/html;base64,PHNjcmlwdD4='), false)
  assert.strictEqual(isSafeArtworkUrl('not-a-url'), false)
  assert.strictEqual(isSafeArtworkUrl('https://example.com/' + 'a'.repeat(2000)), false)
})

test('Room Security: security metrics record and reset cleanly [SMALL-38]', () => {
  resetRoomSecurityMetrics()
  const initial = getRoomSecurityMetrics()
  assert.strictEqual(initial.rateLimitedJoins, 0)
  assert.strictEqual(initial.tokenAuthFailures, 0)

  recordRoomSecurityMetric('rateLimitedJoins')
  recordRoomSecurityMetric('rateLimitedCreations')
  recordRoomSecurityMetric('tokenAuthFailures')
  recordRoomSecurityMetric('payloadClampedOperations')
  recordRoomSecurityMetric('oversizedTrackSanitizations')

  const updated = getRoomSecurityMetrics()
  assert.strictEqual(updated.rateLimitedJoins, 1)
  assert.strictEqual(updated.rateLimitedCreations, 1)
  assert.strictEqual(updated.tokenAuthFailures, 1)
  assert.strictEqual(updated.payloadClampedOperations, 1)
  assert.strictEqual(updated.oversizedTrackSanitizations, 1)

  resetRoomSecurityMetrics()
  assert.strictEqual(getRoomSecurityMetrics().rateLimitedJoins, 0)
})

test('Room Security: /api/listen-together/security-audit exposes limits and metrics [SMALL-38]', async () => {
  resetRoomSecurityMetrics()
  recordRoomSecurityMetric('tokenAuthFailures')

  const res = await listenTogetherRouter.request('/security-audit')
  assert.strictEqual(res.status, 200)
  const data = (await res.json()) as { ok: boolean; limits: typeof DEFAULT_ROOM_LIMITS; metrics: Record<string, number> }
  assert.strictEqual(data.ok, true)
  assert.strictEqual(data.limits.maxGlobalRooms, 1000)
  assert.strictEqual(data.metrics['tokenAuthFailures'], 1)
})

test('Room Security: rate limiter records metrics upon threshold breach [SMALL-38]', () => {
  resetJoinRateLimits()
  resetRoomSecurityMetrics()

  const ip = '198.51.100.99'
  for (let i = 0; i < 20; i++) {
    assert.strictEqual(isJoinRateLimited(ip), false)
  }
  // 21st call breaches threshold
  assert.strictEqual(isJoinRateLimited(ip), true)
  assert.strictEqual(getRoomSecurityMetrics().rateLimitedJoins, 1)

  resetJoinRateLimits()
})

test('Room Security: track sanitization rejects dangerous schemes and records oversized metrics [SMALL-38]', () => {
  resetRoomSecurityMetrics()

  const dangerousTrack = {
    id: 'trk_x',
    title: 'Suspicious Song',
    artist: 'Hacker',
    artworkUrl: 'javascript:alert(document.cookie)',
    durationMs: 999999999, // > 24 hours
  }

  const sanitized = sanitizeTrackPayload(dangerousTrack)
  assert.ok(sanitized)
  assert.strictEqual(sanitized['artworkUrl'], undefined, 'Unsafe javascript: scheme artwork must be dropped')
  assert.strictEqual(sanitized['durationMs'], 86400000, 'Duration clamped to 24h')

  const metrics = getRoomSecurityMetrics()
  assert.ok(metrics.oversizedTrackSanitizations > 0)
})
