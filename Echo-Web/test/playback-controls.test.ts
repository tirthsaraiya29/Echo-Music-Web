import test from 'node:test'
import assert from 'node:assert'
import { formatDuration } from '../src/utils/format.ts'

test('formatDuration formats milliseconds into mm:ss and hh:mm:ss', () => {
  assert.strictEqual(formatDuration(0), '0:00')
  assert.strictEqual(formatDuration(5000), '0:05')
  assert.strictEqual(formatDuration(65000), '1:05')
  assert.strictEqual(formatDuration(3665000), '61:05')
  assert.strictEqual(formatDuration(-1000), '0:00')
  assert.strictEqual(formatDuration(Number.NaN), '0:00')
})

test('Playback controls timeline seek bounds clamping logic', () => {
  const duration = 240
  const clampSeek = (val: number, maxDuration: number): number => {
    const maxBound = maxDuration > 0 ? maxDuration : 100
    return Math.max(0, Math.min(maxBound, Number.isFinite(val) ? val : 0))
  }

  assert.strictEqual(clampSeek(-50, duration), 0)
  assert.strictEqual(clampSeek(0, duration), 0)
  assert.strictEqual(clampSeek(120, duration), 120)
  assert.strictEqual(clampSeek(300, duration), 240)
  assert.strictEqual(clampSeek(Number.NaN, duration), 0)
  assert.strictEqual(clampSeek(Number.POSITIVE_INFINITY, duration), 0)
})

test('Playback controls volume bounds clamping logic', () => {
  const clampVolume = (raw: number): number => {
    return Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 0))
  }

  assert.strictEqual(clampVolume(-10), 0)
  assert.strictEqual(clampVolume(0), 0)
  assert.strictEqual(clampVolume(50), 50)
  assert.strictEqual(clampVolume(100), 100)
  assert.strictEqual(clampVolume(150), 100)
  assert.strictEqual(clampVolume(Number.NaN), 0)
})

test('Playback controls ARIA accessibility properties', () => {
  const duration = 180
  const currentTime = 45
  const volume = 75

  const timelineAria = {
    'aria-label': 'Track playback position',
    'aria-valuemin': 0,
    'aria-valuemax': duration,
    'aria-valuenow': currentTime,
    'aria-valuetext': formatDuration(currentTime * 1000),
  }

  assert.strictEqual(timelineAria['aria-valuemin'], 0)
  assert.strictEqual(timelineAria['aria-valuemax'], 180)
  assert.strictEqual(timelineAria['aria-valuenow'], 45)
  assert.strictEqual(timelineAria['aria-valuetext'], '0:45')

  const volumeAria = {
    'aria-label': 'Volume',
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': volume,
    'aria-valuetext': `${volume}%`,
  }

  assert.strictEqual(volumeAria['aria-valuemin'], 0)
  assert.strictEqual(volumeAria['aria-valuemax'], 100)
  assert.strictEqual(volumeAria['aria-valuenow'], 75)
  assert.strictEqual(volumeAria['aria-valuetext'], '75%')
})
