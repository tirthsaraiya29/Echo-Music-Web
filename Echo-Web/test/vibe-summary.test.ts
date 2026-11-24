import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  vibeMoodSchema,
  vibeSummarySchema,
  vibeSummaryMetricsSchema,
  generateVibeFromHistoryRecords,
  recordVibeMetric,
  getVibeMetrics,
  resetVibeMetrics,
} from '../src/services/history/vibeSummaryService.ts'
import type { ListeningHistoryRecord } from '../src/services/db/echoDatabase.ts'

describe('Vibe Summary Service', () => {
  beforeEach(() => {
    resetVibeMetrics()
  })

  describe('Schemas', () => {
    it('validates a valid VibeSummary', () => {
      const summary = vibeSummarySchema.parse({
        archetype: 'Midnight Deep Diver',
        headline: 'Nocturnal Resonance',
        description: 'Immersed in late-night soundscapes.',
        dominantMood: 'chill',
        dominantTimeOfDay: 'night',
        totalTracksListened: 45,
        totalListeningMinutes: 180,
        completionRatePct: 85,
        timeDistribution: {
          morning: 10,
          afternoon: 20,
          evening: 30,
          night: 40,
        },
        topGenres: [
          { name: 'Electronic', percentage: 60 },
          { name: 'Ambient', percentage: 40 },
        ],
        topArtists: [
          { name: 'Daft Punk', count: 25 },
        ],
        topTracks: [
          { trackId: 't1', title: 'Solaris', artist: 'Photay', count: 10 },
        ],
        generatedAt: 1700000000000,
      })

      assert.equal(summary.archetype, 'Midnight Deep Diver')
      assert.equal(summary.dominantMood, 'chill')
      assert.equal(summary.totalTracksListened, 45)
    })

    it('validates VibeSummaryMetrics schema', () => {
      const m = vibeSummaryMetricsSchema.parse({
        summariesGeneratedCount: 12,
        vibesSharedCount: 4,
      })

      assert.equal(m.summariesGeneratedCount, 12)
      assert.equal(m.vibesSharedCount, 4)
    })
  })

  describe('Archetype Synthesis & Analysis', () => {
    it('returns default Curious Pioneer archetype when history is empty', () => {
      const summary = generateVibeFromHistoryRecords([])
      assert.equal(summary.archetype, 'Curious Pioneer')
      assert.equal(summary.totalTracksListened, 0)
      assert.equal(summary.totalListeningMinutes, 0)
    })

    it('synthesizes Midnight Deep Diver for nocturnal high-completion listeners', () => {
      const nocturnalRecords: ListeningHistoryRecord[] = Array.from({ length: 10 }).map((_, i) => ({
        trackId: `track_${i}`,
        trackTitle: `Night Ambience ${i}`,
        artistName: 'Tycho',
        playedAt: 1700000000000 + i * 180000,
        durationPlayedMs: 180000,
        trackDurationMs: 180000,
        completed: true,
        skipped: false,
        timeOfDay: 'night',
      }))

      const summary = generateVibeFromHistoryRecords(nocturnalRecords)
      assert.equal(summary.archetype, 'Midnight Deep Diver')
      assert.equal(summary.dominantTimeOfDay, 'night')
      assert.equal(summary.dominantMood, 'chill')
      assert.equal(summary.completionRatePct, 100)
      assert.equal(summary.topArtists[0]?.name, 'Tycho')
    })

    it('synthesizes Devoted Discophile when listening is heavily focused on one artist', () => {
      const devotedRecords: ListeningHistoryRecord[] = Array.from({ length: 10 }).map((_, i) => ({
        trackId: `daft_${i}`,
        trackTitle: `Song ${i}`,
        artistName: 'Daft Punk',
        playedAt: 1700000000000 + i * 180000,
        durationPlayedMs: 180000,
        trackDurationMs: 180000,
        completed: true,
        skipped: false,
        timeOfDay: 'afternoon',
      }))

      const summary = generateVibeFromHistoryRecords(devotedRecords)
      assert.equal(summary.archetype, 'Devoted Discophile')
      assert.ok(summary.headline.includes('Daft Punk'))
      assert.equal(summary.topArtists[0]?.name, 'Daft Punk')
    })

    it('synthesizes Sound Nomad when completion rate is low due to frequent skips', () => {
      const nomadRecords: ListeningHistoryRecord[] = Array.from({ length: 10 }).map((_, i) => ({
        trackId: `skip_${i}`,
        trackTitle: `Track ${i}`,
        artistName: `Artist ${i}`,
        playedAt: 1700000000000 + i * 30000,
        durationPlayedMs: 30000,
        trackDurationMs: 180000,
        completed: false,
        skipped: true,
        timeOfDay: 'afternoon',
      }))

      const summary = generateVibeFromHistoryRecords(nomadRecords)
      assert.equal(summary.archetype, 'Sound Nomad')
      assert.equal(summary.dominantMood, 'eclectic')
      assert.ok(summary.completionRatePct < 50)
    })
  })

  describe('Telemetry & Metrics', () => {
    it('records and resets vibe metrics', () => {
      recordVibeMetric('summariesGeneratedCount', 3)
      recordVibeMetric('vibesSharedCount', 1)

      const m = getVibeMetrics()
      assert.equal(m.summariesGeneratedCount, 3)
      assert.equal(m.vibesSharedCount, 1)

      resetVibeMetrics()
      const reset = getVibeMetrics()
      assert.equal(reset.summariesGeneratedCount, 0)
      assert.equal(reset.vibesSharedCount, 0)
    })
  })
})
