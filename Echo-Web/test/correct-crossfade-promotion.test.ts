import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { QueueManager } from '../src/engine/QueueManager.ts'
import type { Track } from '../src/types/audio.ts'

function createMockTrack(id: string, title: string): Track {
  return {
    id,
    title,
    artistName: 'Artist',
    albumTitle: 'Album',
    durationSeconds: 180,
    durationMs: 180000,
    playCount: 0,
  }
}

describe('Correct Crossfade Promotion [FEATURE-011]', () => {
  it('QueueManager: tracks pending promotion and commits cleanly on success', () => {
    const qm = new QueueManager()
    const t1 = createMockTrack('t1', 'Track 1')
    const t2 = createMockTrack('t2', 'Track 2')
    const t3 = createMockTrack('t3', 'Track 3')

    qm.setSourceQueue([t1, t2, t3], 0)
    assert.equal(qm.currentTrack?.id, 't1')
    assert.equal(qm.hasPendingPromotion(), false)

    const standby = qm.peekNext()
    assert.equal(standby?.id, 't2')

    const { promoted } = qm.promoteStandbyTrack(standby)
    assert.equal(promoted?.id, 't2')
    assert.equal(qm.currentTrack?.id, 't2')
    assert.equal(qm.hasPendingPromotion(), true)

    // Commit promotion when crossfade completes
    qm.commitPromotion()
    assert.equal(qm.hasPendingPromotion(), false)
    assert.equal(qm.currentTrack?.id, 't2')
    assert.equal(qm.history.length, 1)
    assert.equal(qm.history[0]?.id, 't1')
  })

  it('QueueManager: rollback restores exact queue state when crossfade fails', () => {
    const qm = new QueueManager()
    const t1 = createMockTrack('t1', 'Track 1')
    const u1 = createMockTrack('u1', 'User Queued Track')

    qm.setSourceQueue([t1], 0)
    qm.addToQueue(u1)

    const standby = qm.peekNext()
    assert.equal(standby?.id, 'u1')

    const { rollback } = qm.promoteStandbyTrack(standby)
    assert.equal(qm.currentTrack?.id, 'u1')
    assert.equal(qm.hasPendingPromotion(), true)

    // Crossfade failed -> invoke rollback
    rollback()
    assert.equal(qm.hasPendingPromotion(), false)
    assert.equal(qm.currentTrack?.id, 't1')
    assert.equal(qm.getDetailedQueue().upNext[0]?.id, 'u1')
    assert.equal(qm.history.length, 0)
  })

  it('QueueManager: promotes user queued track directly without history duplication', () => {
    const qm = new QueueManager()
    const t1 = createMockTrack('t1', 'Track 1')
    const t2 = createMockTrack('t2', 'Track 2')
    const u1 = createMockTrack('u1', 'Explicit UpNext')

    qm.setSourceQueue([t1, t2], 0)
    qm.addToQueue(u1)

    const standby = qm.peekNext()
    assert.equal(standby?.id, 'u1')

    const { promoted } = qm.promoteStandbyTrack(standby)
    assert.equal(promoted?.id, 'u1')
    assert.equal(qm.currentTrack?.id, 'u1')
    assert.equal(qm.history.length, 1)
    assert.equal(qm.history[0]?.id, 't1')

    // Commit promotion
    qm.commitPromotion()
    assert.equal(qm.hasPendingPromotion(), false)
  })
})
