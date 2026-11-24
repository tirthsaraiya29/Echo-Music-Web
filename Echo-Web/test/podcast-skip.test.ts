import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import {
  UPSTREAM_SKIP_BACK_MS,
  UPSTREAM_SKIP_FORWARD_MS,
  DEFAULT_SKIP_BACKWARD_SECONDS,
  DEFAULT_SKIP_FORWARD_SECONDS,
  DEFAULT_INTRO_SKIP_SECONDS,
  DEFAULT_OUTRO_SKIP_SECONDS,
  SKIP_BACKWARD_PRESETS,
  SKIP_FORWARD_PRESETS,
  INTRO_SKIP_PRESETS,
  OUTRO_SKIP_PRESETS,
  podcastSkipConfigSchema,
  skipOperationSchema,
  podcastSkipMetricsSchema,
  calculateSkipBackward,
  calculateSkipForward,
  shouldApplyIntroSkip,
  shouldApplyOutroSkip,
  recordPodcastSkipMetric,
  getPodcastSkipMetrics,
  resetPodcastSkipMetrics,
} from '../src/services/podcast/podcastSkipService.ts'

describe('FEATURE-036: Podcast Skip Controls', () => {
  beforeEach(() => {
    resetPodcastSkipMetrics()
  })

  describe('Upstream Architecture Constants & Presets', () => {
    it('matches upstream Echo Music PodcastProgress.kt skip constants', () => {
      assert.strictEqual(UPSTREAM_SKIP_BACK_MS, 15_000)
      assert.strictEqual(UPSTREAM_SKIP_FORWARD_MS, 30_000)
      assert.strictEqual(DEFAULT_SKIP_BACKWARD_SECONDS, 15)
      assert.strictEqual(DEFAULT_SKIP_FORWARD_SECONDS, 30)
      assert.strictEqual(DEFAULT_INTRO_SKIP_SECONDS, 0)
      assert.strictEqual(DEFAULT_OUTRO_SKIP_SECONDS, 0)
    })

    it('provides standard seek and intro/outro presets', () => {
      assert.ok(SKIP_BACKWARD_PRESETS.includes(15))
      assert.ok(SKIP_FORWARD_PRESETS.includes(30))
      assert.ok(INTRO_SKIP_PRESETS.includes(0))
      assert.ok(INTRO_SKIP_PRESETS.includes(30))
      assert.ok(OUTRO_SKIP_PRESETS.includes(0))
      assert.ok(OUTRO_SKIP_PRESETS.includes(30))
    })
  })

  describe('Zod Schemas', () => {
    it('validates default podcast skip configuration', () => {
      const parsed = podcastSkipConfigSchema.parse({})
      assert.strictEqual(parsed.skipBackwardSeconds, 15)
      assert.strictEqual(parsed.skipForwardSeconds, 30)
      assert.strictEqual(parsed.introSkipSeconds, 0)
      assert.strictEqual(parsed.outroSkipSeconds, 0)
    })

    it('accepts valid custom configurations and rejects out-of-bound values', () => {
      const valid = podcastSkipConfigSchema.parse({
        skipBackwardSeconds: 10,
        skipForwardSeconds: 45,
        introSkipSeconds: 60,
        outroSkipSeconds: 30,
      })
      assert.strictEqual(valid.skipBackwardSeconds, 10)
      assert.strictEqual(valid.skipForwardSeconds, 45)

      assert.throws(() =>
        podcastSkipConfigSchema.parse({ skipBackwardSeconds: 1 }),
      )
      assert.throws(() =>
        podcastSkipConfigSchema.parse({ introSkipSeconds: 500 }),
      )
    })

    it('validates skip operation records', () => {
      const op = skipOperationSchema.parse({
        direction: 'forward',
        offsetSeconds: 30,
        fromPosition: 120,
        toPosition: 150,
        duration: 3600,
        timestamp: Date.now(),
      })
      assert.strictEqual(op.direction, 'forward')
      assert.strictEqual(op.offsetSeconds, 30)
    })

    it('validates telemetry metrics schema', () => {
      const valid = podcastSkipMetricsSchema.parse({
        skipBackwardCount: 4,
        skipForwardCount: 12,
        introSkipCount: 1,
        outroSkipCount: 1,
        totalSecondsSkipped: 390,
      })
      assert.strictEqual(valid.totalSecondsSkipped, 390)
    })
  })

  describe('calculateSkipBackward', () => {
    it('rewinds position by default 15 seconds', () => {
      assert.strictEqual(calculateSkipBackward(100), 85)
      assert.strictEqual(calculateSkipBackward(30), 15)
    })

    it('clamps to zero when remaining duration is less than skip amount', () => {
      assert.strictEqual(calculateSkipBackward(10), 0)
      assert.strictEqual(calculateSkipBackward(0), 0)
    })

    it('respects custom skip intervals', () => {
      assert.strictEqual(calculateSkipBackward(100, 30), 70)
      assert.strictEqual(calculateSkipBackward(100, 5), 95)
    })

    it('handles negative or NaN positions safely', () => {
      assert.strictEqual(calculateSkipBackward(-5), 0)
      assert.strictEqual(calculateSkipBackward(NaN), 0)
    })
  })

  describe('calculateSkipForward', () => {
    it('advances position by default 30 seconds', () => {
      assert.strictEqual(calculateSkipForward(100, 3600), 130)
      assert.strictEqual(calculateSkipForward(0, 3600), 30)
    })

    it('clamps to total duration when approaching track end', () => {
      assert.strictEqual(calculateSkipForward(3585, 3600, 30), 3600)
      assert.strictEqual(calculateSkipForward(3600, 3600, 30), 3600)
    })

    it('respects custom skip intervals', () => {
      assert.strictEqual(calculateSkipForward(50, 500, 15), 65)
      assert.strictEqual(calculateSkipForward(50, 500, 60), 110)
    })

    it('returns raw target when duration is unknown or zero', () => {
      assert.strictEqual(calculateSkipForward(100, 0, 30), 130)
    })
  })

  describe('shouldApplyIntroSkip', () => {
    it('triggers intro skip at cold start (pos <= 2s) when introSkipSeconds > 0', () => {
      const res1 = shouldApplyIntroSkip(0, 30, 3600)
      assert.strictEqual(res1.shouldSkip, true)
      assert.strictEqual(res1.targetPosition, 30)

      const res2 = shouldApplyIntroSkip(1.2, 45, 1800)
      assert.strictEqual(res2.shouldSkip, true)
      assert.strictEqual(res2.targetPosition, 45)
    })

    it('does not trigger intro skip when position > 2s (already listening)', () => {
      const res = shouldApplyIntroSkip(10, 30, 3600)
      assert.strictEqual(res.shouldSkip, false)
      assert.strictEqual(res.targetPosition, 10)
    })

    it('does not trigger when introSkipSeconds is 0 or negative', () => {
      assert.strictEqual(shouldApplyIntroSkip(0, 0, 3600).shouldSkip, false)
      assert.strictEqual(shouldApplyIntroSkip(0, -15, 3600).shouldSkip, false)
    })

    it('does not trigger if track duration is shorter than intro skip plus safety margin', () => {
      assert.strictEqual(shouldApplyIntroSkip(0, 30, 32).shouldSkip, false)
    })
  })

  describe('shouldApplyOutroSkip', () => {
    it('triggers outro skip when within configured remaining seconds', () => {
      const res = shouldApplyOutroSkip(975, 1000, 30)
      assert.strictEqual(res.shouldSkip, true)
      assert.strictEqual(res.remainingSeconds, 25)
    })

    it('does not trigger when further away than outroSkipSeconds', () => {
      const res = shouldApplyOutroSkip(950, 1000, 30)
      assert.strictEqual(res.shouldSkip, false)
      assert.strictEqual(res.remainingSeconds, 50)
    })

    it('does not trigger when outroSkipSeconds is 0', () => {
      assert.strictEqual(shouldApplyOutroSkip(990, 1000, 0).shouldSkip, false)
    })

    it('does not trigger for very short clips where duration <= outro * 2', () => {
      assert.strictEqual(shouldApplyOutroSkip(25, 40, 30).shouldSkip, false)
    })
  })

  describe('Telemetry Tracking', () => {
    it('records skip metrics accurately and supports reset', () => {
      recordPodcastSkipMetric('skipBackwardCount')
      recordPodcastSkipMetric('skipBackwardCount')
      recordPodcastSkipMetric('skipForwardCount')
      recordPodcastSkipMetric('introSkipCount')
      recordPodcastSkipMetric('outroSkipCount')
      recordPodcastSkipMetric('totalSecondsSkipped', 75)

      const metrics = getPodcastSkipMetrics()
      assert.strictEqual(metrics.skipBackwardCount, 2)
      assert.strictEqual(metrics.skipForwardCount, 1)
      assert.strictEqual(metrics.introSkipCount, 1)
      assert.strictEqual(metrics.outroSkipCount, 1)
      assert.strictEqual(metrics.totalSecondsSkipped, 75)

      resetPodcastSkipMetrics()
      const reset = getPodcastSkipMetrics()
      assert.strictEqual(reset.skipBackwardCount, 0)
      assert.strictEqual(reset.totalSecondsSkipped, 0)
    })
  })
})
