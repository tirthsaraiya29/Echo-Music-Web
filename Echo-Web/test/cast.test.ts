import test from 'node:test'
import assert from 'node:assert'
import { castService } from '../src/services/cast/castService.ts'

test('Cast Service: methods have valid signatures and handle disconnected states gracefully [BUG-13]', async () => {
  assert.strictEqual(castService.getIsConnected(), false)

  let lastConnectedState: boolean | null = null
  const unsubscribe = castService.subscribe((connected) => {
    lastConnectedState = connected
  })
  assert.strictEqual(lastConnectedState, false)

  // Calling playback operations while disconnected returns false or acts safely without throwing
  const track = { id: 'track-1', title: 'Cast Track', artistName: 'Artist', durationSeconds: 200 }
  const castRes = await castService.castTrack(track, 'https://example.com/audio.mp4', 0)
  assert.strictEqual(castRes, false)

  assert.doesNotThrow(() => {
    castService.play()
    castService.pause()
    castService.seek(15)
  })

  unsubscribe()
})
