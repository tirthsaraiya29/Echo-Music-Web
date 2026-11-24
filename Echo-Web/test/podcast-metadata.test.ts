import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import {
  parseEpisodeChapters,
  fetchEpisodeMetadata,
  recordPodcastMetadataMetric,
  getPodcastMetadataMetrics,
  resetPodcastMetadataMetrics,
  episodeChapterSchema,
  podcastEpisodeMetadataSchema,
} from '../src/services/podcast/podcastMetadataService.ts'

describe('podcastMetadataService', () => {
  beforeEach(() => {
    resetPodcastMetadataMetrics()
  })

  describe('parseEpisodeChapters', () => {
    it('returns empty array when description is missing or empty', () => {
      assert.deepStrictEqual(parseEpisodeChapters(undefined), [])
      assert.deepStrictEqual(parseEpisodeChapters(null), [])
      assert.deepStrictEqual(parseEpisodeChapters('   '), [])
    })

    it('returns empty array when fewer than 2 chapters are present', () => {
      const description = 'Here is only one chapter:\n00:00 Introduction\nSome other notes.'
      assert.deepStrictEqual(parseEpisodeChapters(description), [])
    })

    it('correctly parses minutes:seconds chapter markers', () => {
      const description = `
Episode 42 of the Podcast.
0:00 Introduction & Announcements
3:15 Deep Dive into Web Architecture
12:45 Performance Optimization
25:30 Listener Q&A
`
      const chapters = parseEpisodeChapters(description)
      assert.strictEqual(chapters.length, 4)
      assert.strictEqual(chapters[0]?.title, 'Introduction & Announcements')
      assert.strictEqual(chapters[0]?.startMs, 0)
      assert.strictEqual(chapters[1]?.title, 'Deep Dive into Web Architecture')
      assert.strictEqual(chapters[1]?.startMs, 3 * 60 * 1000 + 15 * 1000)
      assert.strictEqual(chapters[2]?.title, 'Performance Optimization')
      assert.strictEqual(chapters[2]?.startMs, 12 * 60 * 1000 + 45 * 1000)
      assert.strictEqual(chapters[3]?.title, 'Listener Q&A')
      assert.strictEqual(chapters[3]?.startMs, 25 * 60 * 1000 + 30 * 1000)
    })

    it('correctly parses hours:minutes:seconds chapter markers', () => {
      const description = `
1:00:00 Part 1
1:15:30 Part 2 - Break
2:00:00 Outro
`
      const chapters = parseEpisodeChapters(description)
      assert.strictEqual(chapters.length, 3)
      assert.strictEqual(chapters[0]?.startMs, 3600 * 1000)
      assert.strictEqual(chapters[1]?.startMs, (3600 + 15 * 60 + 30) * 1000)
      assert.strictEqual(chapters[2]?.startMs, 7200 * 1000)
    })

    it('rejects chapters that are not in strictly increasing chronological order', () => {
      const description = `
0:00 Introduction
10:00 Main Topic
5:00 Time Travel (Invalid order)
`
      const chapters = parseEpisodeChapters(description)
      assert.deepStrictEqual(chapters, [])
    })

    it('supports delimiter variations (dash, en-dash, colon, dot)', () => {
      const description = `
00:00 - Introduction
05:00 – Chapter Two
10:00: Chapter Three
15:00. Chapter Four
20:00 Chapter Five
`
      const chapters = parseEpisodeChapters(description)
      assert.strictEqual(chapters.length, 5)
      assert.strictEqual(chapters[0]?.title, 'Introduction')
      assert.strictEqual(chapters[1]?.title, 'Chapter Two')
      assert.strictEqual(chapters[2]?.title, 'Chapter Three')
      assert.strictEqual(chapters[3]?.title, 'Chapter Four')
      assert.strictEqual(chapters[4]?.title, 'Chapter Five')
    })
  })

  describe('fetchEpisodeMetadata', () => {
    it('throws when episode ID is empty', async () => {
      await assert.rejects(
        () => fetchEpisodeMetadata(''),
        /Episode ID is required/,
      )
    })

    it('returns structured episode metadata with fallback values', async () => {
      const metadata = await fetchEpisodeMetadata(
        'ep_12345',
        'Sample Tech Talk',
        'Tech Show',
      )
      assert.strictEqual(metadata.id, 'ep_12345')
      assert.strictEqual(metadata.title, 'Sample Tech Talk')
      assert.strictEqual(metadata.showTitle, 'Tech Show')
      assert.ok(metadata.description)
      assert.ok(metadata.chapters.length >= 0)
    })
  })

  describe('schemas and telemetry', () => {
    it('validates chapter schema correctly', () => {
      const parsed = episodeChapterSchema.parse({
        startMs: 60000,
        title: 'Middle section',
        formattedTime: '1:00',
      })
      assert.strictEqual(parsed.startMs, 60000)
      assert.strictEqual(parsed.title, 'Middle section')
    })

    it('records and resets telemetry metrics', () => {
      resetPodcastMetadataMetrics()
      recordPodcastMetadataMetric('metadataLoadsCount', 2)
      recordPodcastMetadataMetric('chapterJumpsCount', 1)

      const metrics = getPodcastMetadataMetrics()
      assert.strictEqual(metrics.metadataLoadsCount, 2)
      assert.strictEqual(metrics.chapterJumpsCount, 1)

      resetPodcastMetadataMetrics()
      const reset = getPodcastMetadataMetrics()
      assert.strictEqual(reset.metadataLoadsCount, 0)
      assert.strictEqual(reset.chapterJumpsCount, 0)
    })
  })
})
