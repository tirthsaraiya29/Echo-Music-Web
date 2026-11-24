import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EchoBrainService } from '../src/services/recommendations/echoBrainService.ts'
import {
  momentumSignalSchema,
  sessionMomentumContextSchema,
  type MomentumSignal,
} from '../src/services/recommendations/echoBrainTypes.ts'
import type { Track } from '../src/types/audio.ts'

function createMockTrack(id: string, title: string, artistName = 'Artist', durationSeconds = 200, playCount = 0): Track {
  return {
    id,
    title,
    artistName,
    albumTitle: 'Album',
    durationSeconds,
    durationMs: durationSeconds * 1000,
    playCount,
  }
}

describe('Echo Brain Momentum Queue [FEATURE-017]', () => {
  it('schemas: validates momentum signals and session contexts', () => {
    const signal: MomentumSignal = {
      trackId: 't1',
      trackTitle: 'Track 1',
      artistName: 'Artist A',
      completed: true,
      skipped: false,
      durationPlayedMs: 180000,
      trackDurationMs: 180000,
      liked: true,
      timestamp: Date.now(),
    }
    const parsedSignal = momentumSignalSchema.parse(signal)
    assert.equal(parsedSignal.trackId, 't1')
    assert.equal(parsedSignal.completed, true)

    const context = sessionMomentumContextSchema.parse({
      recentSignals: [signal],
      likedTrackIds: ['t1'],
      excludedTrackIds: ['bad_track'],
    })
    assert.equal(context.recentSignals.length, 1)
    assert.equal(context.likedTrackIds[0], 't1')
  })

  it('analyzeMomentum: detects restless state on consecutive rapid skips', () => {
    const service = new EchoBrainService()
    const now = Date.now()

    const rapidSkips: MomentumSignal[] = [
      {
        trackId: 's1',
        trackTitle: 'Skipped 1',
        artistName: 'Random A',
        completed: false,
        skipped: true,
        durationPlayedMs: 8000, // <30s
        trackDurationMs: 200000,
        liked: false,
        timestamp: now - 10000,
      },
      {
        trackId: 's2',
        trackTitle: 'Skipped 2',
        artistName: 'Random B',
        completed: false,
        skipped: true,
        durationPlayedMs: 12000, // <30s
        trackDurationMs: 180000,
        liked: false,
        timestamp: now,
      },
    ]

    const momentum = service.analyzeMomentum(rapidSkips)
    assert.equal(momentum, 'restless')
  })

  it('analyzeMomentum: detects focused state on consecutive completions', () => {
    const service = new EchoBrainService()
    const now = Date.now()

    const completions: MomentumSignal[] = [
      {
        trackId: 'c1',
        trackTitle: 'Complete 1',
        artistName: 'Favorite Artist',
        completed: true,
        skipped: false,
        durationPlayedMs: 240000,
        trackDurationMs: 240000,
        liked: false,
        timestamp: now - 300000,
      },
      {
        trackId: 'c2',
        trackTitle: 'Complete 2',
        artistName: 'Favorite Artist',
        completed: true,
        skipped: false,
        durationPlayedMs: 210000,
        trackDurationMs: 210000,
        liked: false,
        timestamp: now,
      },
    ]

    const momentum = service.analyzeMomentum(completions)
    assert.equal(momentum, 'focused')
  })

  it('scoreCandidates: in restless state, prioritizes liked and familiar palate-cleansers', () => {
    const service = new EchoBrainService()
    const candidates = [
      createMockTrack('unfamiliar-long', 'Obscure Long Track', 'Unknown Artist', 480, 0),
      createMockTrack('liked-familiar', 'Beloved Hit', 'Known Artist', 200, 5),
      createMockTrack('neutral-track', 'Average Track', 'Another Artist', 180, 1),
    ]

    const scored = service.scoreCandidates(
      candidates,
      {
        recentSignals: [
          {
            trackId: 's1',
            trackTitle: 'Skip',
            artistName: 'Unknown Artist',
            completed: false,
            skipped: true,
            durationPlayedMs: 10000,
            trackDurationMs: 200000,
            liked: false,
            timestamp: Date.now(),
          },
          {
            trackId: 's2',
            trackTitle: 'Skip 2',
            artistName: 'Unknown Artist',
            completed: false,
            skipped: true,
            durationPlayedMs: 15000,
            trackDurationMs: 200000,
            liked: false,
            timestamp: Date.now(),
          },
        ],
        likedTrackIds: ['liked-familiar'],
        excludedTrackIds: [],
      },
      'restless',
    )

    // Liked familiar track must rank highest by far
    assert.equal(scored[0]?.track.id, 'liked-familiar')
    // Unfamiliar long track with skipped artist must rank lowest
    assert.equal(scored[scored.length - 1]?.track.id, 'unfamiliar-long')
  })

  it('scoreCandidates: in focused state, boosts current and completed artist continuity', () => {
    const service = new EchoBrainService()
    const candidates = [
      createMockTrack('artist-deepcut', 'Deep Cut', 'Current Band', 220, 0),
      createMockTrack('unrelated', 'Random Track', 'Different Band', 200, 0),
    ]

    const scored = service.scoreCandidates(
      candidates,
      {
        recentSignals: [],
        currentTrack: createMockTrack('now-playing', 'Playing Now', 'Current Band'),
        likedTrackIds: [],
        excludedTrackIds: [],
      },
      'focused',
    )

    assert.equal(scored[0]?.track.id, 'artist-deepcut')
    assert.ok(scored[0]!.score > scored[1]!.score)
  })

  it('injectMomentumTracks: preserves upNext queue and deduplicates properly', () => {
    const service = new EchoBrainService()
    const upNext = [createMockTrack('user-1', 'User Manual Pick 1'), createMockTrack('user-2', 'User Manual Pick 2')]
    const existingRadio = [createMockTrack('radio-1', 'Existing Radio 1')]

    const candidates = [
      createMockTrack('user-1', 'Duplicate of user track'),
      createMockTrack('radio-1', 'Duplicate of radio track'),
      createMockTrack('momentum-1', 'Fresh Injected Track 1'),
      createMockTrack('momentum-2', 'Fresh Injected Track 2'),
    ]

    const result = service.injectMomentumTracks(upNext, existingRadio, candidates, 10)

    // UpNext is untouched
    assert.equal(upNext.length, 2)
    assert.equal(upNext[0]?.id, 'user-1')

    // Result preserves existing radio and adds only unique momentum tracks
    assert.equal(result.length, 3)
    assert.equal(result[0]?.id, 'radio-1')
    assert.equal(result[1]?.id, 'momentum-1')
    assert.equal(result[2]?.id, 'momentum-2')
    assert.equal(service.getTelemetry().momentumInjections, 1)
  })
})
