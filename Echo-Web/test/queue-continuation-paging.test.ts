import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { QueueManager, continuationPagingStateSchema } from '../src/engine/QueueManager.ts'
import type { Track } from '../src/types/audio.ts'

function createMockTrack(id: string, title: string): Track {
  return {
    id,
    title,
    artistName: 'Artist',
    albumTitle: 'Album',
    durationSeconds: 190,
    durationMs: 190000,
    playCount: 0,
  }
}

describe('Queue Continuation Paging [FEATURE-015]', () => {
  it('continuationPagingStateSchema: validates continuation state schema', () => {
    const valid = continuationPagingStateSchema.parse({
      continuationToken: 'token_page_1',
      pageIndex: 1,
      hasMore: true,
      lastFetchedAt: Date.now(),
    })
    assert.equal(valid.continuationToken, 'token_page_1')
    assert.equal(valid.pageIndex, 1)
    assert.equal(valid.hasMore, true)
  })

  it('QueueManager: advances continuation paging across multiple batches', () => {
    const qm = new QueueManager()
    const initial = qm.getContinuationState()
    assert.equal(initial.pageIndex, 0)
    assert.equal(initial.continuationToken, null)
    assert.equal(initial.hasMore, true)

    // First page of radio tracks arrives with continuation token
    const page1 = [createMockTrack('r1', 'Radio 1'), createMockTrack('r2', 'Radio 2')]
    qm.addRadioTracks(page1, 'token_for_page_2')

    let state = qm.getContinuationState()
    assert.equal(state.pageIndex, 1)
    assert.equal(state.continuationToken, 'token_for_page_2')
    assert.equal(state.hasMore, true)
    assert.equal(qm.radioQueue.length, 2)

    // Second page arrives with token for page 3
    const page2 = [createMockTrack('r3', 'Radio 3')]
    qm.addRadioTracks(page2, 'token_for_page_3')

    state = qm.getContinuationState()
    assert.equal(state.pageIndex, 2)
    assert.equal(state.continuationToken, 'token_for_page_3')
    assert.equal(state.hasMore, true)
    assert.equal(qm.radioQueue.length, 3)

    // Third page arrives with no further continuation (end of stream)
    const page3 = [createMockTrack('r4', 'Radio 4')]
    qm.addRadioTracks(page3, null)

    state = qm.getContinuationState()
    assert.equal(state.pageIndex, 3)
    assert.equal(state.continuationToken, null)
    assert.equal(state.hasMore, false)
    assert.equal(qm.radioQueue.length, 4)
  })

  it('QueueManager: deduplicates tracks across continuation batches', () => {
    const qm = new QueueManager()
    const active = createMockTrack('active-1', 'Active Track')
    qm.setSourceQueue([active], 0)

    // Page 1 returns active track and new track
    qm.addRadioTracks([active, createMockTrack('r1', 'Radio 1')], 'token_2')
    // Active track should be deduplicated
    assert.equal(qm.radioQueue.length, 1)
    assert.equal(qm.radioQueue[0]?.id, 'r1')

    // Page 2 returns duplicate of r1 and new track r2
    qm.addRadioTracks([createMockTrack('r1', 'Radio 1'), createMockTrack('r2', 'Radio 2')], 'token_3')
    assert.equal(qm.radioQueue.length, 2)
    assert.equal(qm.radioQueue[1]?.id, 'r2')
  })

  it('QueueManager: snapshots and restores continuation paging state faithfully', () => {
    const qm = new QueueManager()
    const t1 = createMockTrack('t1', 'Track 1')
    qm.setSourceQueue([t1], 0)

    qm.addRadioTracks([createMockTrack('r1', 'Radio 1')], 'persisted_token_42')
    const stateBefore = qm.getContinuationState()
    assert.equal(stateBefore.continuationToken, 'persisted_token_42')
    assert.equal(stateBefore.pageIndex, 1)

    // Snapshot queue
    const snapshot = qm.snapshotQueue(10)
    assert.ok(snapshot.continuationState)
    assert.equal(snapshot.continuationState.continuationToken, 'persisted_token_42')
    assert.equal(snapshot.continuationState.pageIndex, 1)

    // Mutate queue
    qm.clearRadioQueue()
    assert.equal(qm.getContinuationState().continuationToken, null)
    assert.equal(qm.getContinuationState().pageIndex, 0)

    // Restore queue
    qm.restoreQueue(snapshot)
    const stateAfter = qm.getContinuationState()
    assert.equal(stateAfter.continuationToken, 'persisted_token_42')
    assert.equal(stateAfter.pageIndex, 1)
    assert.equal(stateAfter.hasMore, true)
    assert.equal(qm.radioQueue.length, 1)
  })

  it('QueueManager: resets continuation paging when source queue changes', () => {
    const qm = new QueueManager()
    qm.addRadioTracks([createMockTrack('r1', 'Radio 1')], 'token_x')
    assert.equal(qm.getContinuationState().pageIndex, 1)

    // User plays new album
    qm.setSourceQueue([createMockTrack('a1', 'Album 1')], 0)
    const state = qm.getContinuationState()
    assert.equal(state.pageIndex, 0)
    assert.equal(state.continuationToken, null)
    assert.equal(state.hasMore, true)
  })
})
