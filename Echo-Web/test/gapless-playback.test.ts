import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { QueueManager } from '../src/engine/QueueManager.ts'
import { userPreferencesSchema } from '../src/services/settings/settingsTypes.ts'
import type { Track } from '../src/types/audio.ts'

function createMockTrack(id: string, title: string): Track {
  return {
    id,
    title,
    artistName: 'Artist',
    albumTitle: 'Album',
    durationSeconds: 210,
    durationMs: 210000,
    playCount: 0,
  }
}

describe('Gapless Playback [FEATURE-012]', () => {
  it('userPreferencesSchema: gaplessPlayback defaults to true and validates boolean values', () => {
    const defaultParsed = userPreferencesSchema.parse({})
    assert.equal(defaultParsed.gaplessPlayback, true)

    const disabledParsed = userPreferencesSchema.parse({ gaplessPlayback: false })
    assert.equal(disabledParsed.gaplessPlayback, false)

    const enabledParsed = userPreferencesSchema.parse({ gaplessPlayback: true })
    assert.equal(enabledParsed.gaplessPlayback, true)
  })

  it('QueueManager: handles atomic promotion for gapless track transitions', () => {
    const qm = new QueueManager()
    const t1 = createMockTrack('t1', 'Movement 1')
    const t2 = createMockTrack('t2', 'Movement 2')
    const t3 = createMockTrack('t3', 'Movement 3')

    qm.setSourceQueue([t1, t2, t3], 0)
    assert.equal(qm.currentTrack?.id, 't1')
    assert.equal(qm.currentIndex, 0)

    // Prebuffered standby track is t2
    const standby = qm.peekNext()
    assert.equal(standby?.id, 't2')

    // Gapless handoff occurs
    const { promoted } = qm.promoteStandbyTrack(standby)
    assert.equal(promoted?.id, 't2')
    assert.equal(qm.currentTrack?.id, 't2')
    assert.equal(qm.currentIndex, 1)

    // Commit handoff
    qm.commitPromotion()
    assert.equal(qm.hasPendingPromotion(), false)
    assert.equal(qm.history.length, 1)
    assert.equal(qm.history[0]?.id, 't1')

    // Next track ready for prebuffering is t3
    const nextStandby = qm.peekNext()
    assert.equal(nextStandby?.id, 't3')
  })

  it('QueueManager: supports consecutive gapless transitions across an entire sequence', () => {
    const qm = new QueueManager()
    const tracks = [
      createMockTrack('m1', 'Track 1'),
      createMockTrack('m2', 'Track 2'),
      createMockTrack('m3', 'Track 3'),
      createMockTrack('m4', 'Track 4'),
    ]

    qm.setSourceQueue(tracks, 0)

    // Transition 1 -> 2
    let next = qm.peekNext()
    assert.equal(next?.id, 'm2')
    qm.promoteStandbyTrack(next)
    qm.commitPromotion()
    assert.equal(qm.currentTrack?.id, 'm2')
    assert.equal(qm.history.length, 1)

    // Transition 2 -> 3
    next = qm.peekNext()
    assert.equal(next?.id, 'm3')
    qm.promoteStandbyTrack(next)
    qm.commitPromotion()
    assert.equal(qm.currentTrack?.id, 'm3')
    assert.equal(qm.history.length, 2)

    // Transition 3 -> 4
    next = qm.peekNext()
    assert.equal(next?.id, 'm4')
    qm.promoteStandbyTrack(next)
    qm.commitPromotion()
    assert.equal(qm.currentTrack?.id, 'm4')
    assert.equal(qm.history.length, 3)
    assert.deepEqual(
      qm.history.map((t) => t.id),
      ['m1', 'm2', 'm3'],
    )

    // End of queue reached: no next track
    assert.equal(qm.peekNext(), null)
  })

  it('QueueManager: handles user-queued items seamlessly in gapless transitions', () => {
    const qm = new QueueManager()
    const t1 = createMockTrack('t1', 'Album Track 1')
    const t2 = createMockTrack('t2', 'Album Track 2')
    const priorityTrack = createMockTrack('priority-1', 'Bonus Live Track')

    qm.setSourceQueue([t1, t2], 0)
    qm.addToQueue(priorityTrack)

    // Prioritized item must be picked up for gapless transition
    const standby = qm.peekNext()
    assert.equal(standby?.id, 'priority-1')

    qm.promoteStandbyTrack(standby)
    qm.commitPromotion()

    assert.equal(qm.currentTrack?.id, 'priority-1')
    assert.equal(qm.history[0]?.id, 't1')

    // Subsequent gapless handoff returns to album flow
    const returnStandby = qm.peekNext()
    assert.equal(returnStandby?.id, 't2')
  })
})
