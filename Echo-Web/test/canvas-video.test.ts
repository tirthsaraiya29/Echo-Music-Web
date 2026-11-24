import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'

import {
  canvasVideoPropsSchema,
  canvasVideoMetricsSchema,
  getCanvasVideoMetrics,
  resetCanvasVideoMetrics,
  recordCanvasVideoMetric,
  isReducedMotionPreferred,
} from '../src/services/canvas/canvasVideoTypes.ts'

test('CanvasVideo: canvasVideoPropsSchema validates input properties and handles null track [SMALL-29]', () => {
  const validProps = {
    track: {
      id: 't-canvas-video-1',
      title: 'Midnight City',
      artistName: 'M83',
      artwork: 'https://example.com/art.jpg',
    },
    className: 'custom-canvas-class',
  }
  assert.strictEqual(canvasVideoPropsSchema.safeParse(validProps).success, true)

  // Null track passes
  const nullTrackProps = {
    track: null,
  }
  assert.strictEqual(canvasVideoPropsSchema.safeParse(nullTrackProps).success, true)
})

test('CanvasVideo: telemetry metrics record lifecycle and reset cleanly [SMALL-29]', () => {
  resetCanvasVideoMetrics()
  const initial = getCanvasVideoMetrics()

  assert.strictEqual(initial.renders, 0)
  assert.strictEqual(initial.videoLoadStarts, 0)
  assert.strictEqual(initial.videoLoadSuccesses, 0)
  assert.strictEqual(initial.videoLoadErrors, 0)
  assert.strictEqual(initial.reducedMotionSkips, 0)
  assert.strictEqual(canvasVideoMetricsSchema.safeParse(initial).success, true)

  recordCanvasVideoMetric('renders')
  recordCanvasVideoMetric('videoLoadStarts')
  recordCanvasVideoMetric('videoLoadSuccesses')
  recordCanvasVideoMetric('reducedMotionSkips')

  const updated = getCanvasVideoMetrics()
  assert.strictEqual(updated.renders, 1)
  assert.strictEqual(updated.videoLoadStarts, 1)
  assert.strictEqual(updated.videoLoadSuccesses, 1)
  assert.strictEqual(updated.reducedMotionSkips, 1)

  resetCanvasVideoMetrics()
  const afterReset = getCanvasVideoMetrics()
  assert.strictEqual(afterReset.renders, 0)
  assert.strictEqual(afterReset.videoLoadStarts, 0)
})

test('CanvasVideo: isReducedMotionPreferred defaults to false in Node environment [SMALL-29]', () => {
  assert.strictEqual(isReducedMotionPreferred(), false)
})

test('CanvasVideo: component source enforces reduced motion, bounded timeouts, and audio-less looping [SMALL-29]', () => {
  const code = fs.readFileSync('src/components/player/CanvasVideo.tsx', 'utf8')

  // Prefers reduced motion compliance
  assert.ok(code.includes('prefersReducedMotion'), 'Component must evaluate reduced motion preference')
  assert.ok(code.includes('reducedMotionSkips'), 'Component must track reduced motion skips in metrics')

  // Bounded video load timeout
  assert.ok(code.includes('8000'), 'Component must enforce an 8s timeout for video loading')
  assert.ok(code.includes('loadTimeoutRef'), 'Component must manage a timeout ref for cleanup')

  // Ambient artwork fallback
  assert.ok(code.includes('canvas-artwork-layer'), 'Component must render fallback artwork layer')
  assert.ok(code.includes('aria-hidden="true"'), 'Background canvas must be aria-hidden')

  // Looping video element properties
  assert.ok(code.includes('autoPlay'), 'Video element must have autoPlay')
  assert.ok(code.includes('muted'), 'Video element must be muted')
  assert.ok(code.includes('loop'), 'Video element must loop')
  assert.ok(code.includes('playsInline'), 'Video element must play inline')
})
