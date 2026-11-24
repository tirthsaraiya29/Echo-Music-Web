import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { QueueManager, QueueSnapshotSchema } from '../src/engine/QueueManager.ts'
import type { Track } from '../src/types/audio.ts'

function createMockTrack(id: string, title: string): Track {
  return {
    id,
    title,
    artistName: 'Artist',
    albumTitle: 'Album',
    durationSeconds: 200,
    durationMs: 200000,
    playCount: 0,
  }
}

describe('Queue Ownership Snapshots [FEATURE-014]', () => {
  it('QueueSnapshotSchema: parses ownership metadata properly', () => {
    const rawSnapshot = {
      id: 'snapshot_1',
      timestamp: Date.now(),
      owner: 'music-flow',
      ownerToken: 'token_123',
      history: [],
      currentTrack: createMockTrack('t1', 'Track 1'),
      upNext: [],
      sourceQueue: [createMockTrack('t1', 'Track 1')],
      radioQueue: [],
      shuffledSourceQueue: [],
      currentTime: 42,
      activeDeck: 'A',
      repeatMode: 'OFF',
      isShuffle: false,
      pauseAtEndOfItems: false,
      currentSourceIndex: 0,
      activeTrackSource: 'sourceQueue',
    }

    const parsed = QueueSnapshotSchema.parse(rawSnapshot)
    assert.equal(parsed.owner, 'music-flow')
    assert.equal(parsed.ownerToken, 'token_123')
  })

  it('QueueManager: registers and manages ownership leases', () => {
    const qm = new QueueManager()
    assert.equal(qm.getOwnership().isOwned, false)

    const token = qm.takeOwnership('music-flow')
    assert.ok(token.startsWith('owner_music-flow_'))
    assert.equal(qm.getOwnership().isOwned, true)
    assert.equal(qm.getOwnership().owner, 'music-flow')
    assert.equal(qm.isOwnershipValid(token), true)
    assert.equal(qm.isOwnershipValid('wrong_token'), false)

    qm.revokeOwnership('USER_ACTION')
    assert.equal(qm.getOwnership().isOwned, false)
    assert.equal(qm.isOwnershipValid(token), false)
  })

  it('QueueManager: restores queue when ownership lease remains valid', () => {
    const qm = new QueueManager()
    const t1 = createMockTrack('t1', 'Initial Track')
    const t2 = createMockTrack('t2', 'Second Track')
    qm.setSourceQueue([t1, t2], 0)

    // Take ownership and snapshot
    const token = qm.takeOwnership('music-flow')
    const snapshot = qm.snapshotQueue(15, 'music-flow', token)

    assert.equal(snapshot.owner, 'music-flow')
    assert.equal(snapshot.ownerToken, token)

    // Flow is still active and calls restore
    const restored = qm.restoreQueue(snapshot, { ownerToken: token })
    assert.equal(restored?.id, 't1')
    assert.equal(qm.getMetrics().ownershipViolationsBlocked, 0)
    assert.equal(qm.getMetrics().snapshotsRestored, 1)
  })

  it('QueueManager: blocks restore when ownership has been revoked by user playback override', () => {
    const qm = new QueueManager()
    const t1 = createMockTrack('t1', 'Original Track')
    qm.setSourceQueue([t1], 0)

    const token = qm.takeOwnership('music-flow')
    const snapshot = qm.snapshotQueue(30, 'music-flow', token)

    // User navigates away and clicks a completely new album
    const newTrack = createMockTrack('new-1', 'User Clicked Track')
    qm.setSourceQueue([newTrack], 0)

    // setSourceQueue should have revoked ownership
    assert.equal(qm.isOwnershipValid(token), false)
    assert.equal(qm.currentTrack?.id, 'new-1')

    // Music Flow exits and attempts to restore the old snapshot
    const restored = qm.restoreQueue(snapshot, { ownerToken: token })

    // Must be blocked! Active track must NOT be reverted
    assert.equal(restored, null)
    assert.equal(qm.currentTrack?.id, 'new-1')
    assert.equal(qm.getMetrics().ownershipViolationsBlocked, 1)
  })

  it('QueueManager: allows forced restore to bypass revoked ownership if requested', () => {
    const qm = new QueueManager()
    const t1 = createMockTrack('t1', 'Track 1')
    qm.setSourceQueue([t1], 0)

    const token = qm.takeOwnership('test')
    const snapshot = qm.snapshotQueue(0, 'test', token)

    qm.revokeOwnership()
    assert.equal(qm.isOwnershipValid(token), false)

    // Normal restore fails
    const blocked = qm.restoreQueue(snapshot, { ownerToken: token })
    assert.equal(blocked, null)

    // Forced restore succeeds
    const forced = qm.restoreQueue(snapshot, { ownerToken: token, force: true })
    assert.equal(forced?.id, 't1')
  })
})
