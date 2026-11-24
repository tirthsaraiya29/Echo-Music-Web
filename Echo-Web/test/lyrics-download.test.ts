import test from 'node:test'
import assert from 'node:assert/strict'

import {
  lyricsExporter,
  sanitizeFileName,
  buildLyricsFileName,
  lyricsDownloadResultSchema,
  getLyricsExportMetrics,
  resetLyricsExportMetrics,
} from '../src/services/lyrics/LyricsExporter.ts'
import type { Track } from '../src/types/domain.ts'
import type { SynchronizedLyrics } from '../src/types/lyrics.ts'

const testTrack: Track = {
  id: 'track-download-99',
  title: 'Blinding Lights / After Hours?',
  artistName: 'The Weeknd: XO',
  albumTitle: 'After Hours <Deluxe>',
  durationSeconds: 200,
}

const testLyrics: SynchronizedLyrics = {
  provider: 'LRCLIB',
  isSynced: true,
  isWordSynced: true,
  lines: [
    {
      startTimeMs: 12000,
      endTimeMs: 15500,
      text: "I've been on my own for long enough",
      words: [
        { text: "I've", startTimeMs: 12000, endTimeMs: 12500 },
        { text: 'been', startTimeMs: 12500, endTimeMs: 13000 },
      ],
    },
    {
      startTimeMs: 16000,
      endTimeMs: 19500,
      text: 'Maybe you can show me how to love, maybe',
    },
  ],
}

test('Lyrics Download: sanitizeFileName removes OS-illegal characters and control codes [FEATURE-059]', () => {
  assert.strictEqual(sanitizeFileName('Clean Title'), 'Clean Title')
  assert.strictEqual(sanitizeFileName('Illegal/Slash\\Back:Colon*Star?Question"Quote<Less>Greater|Pipe'), 'IllegalSlashBackColonStarQuestionQuoteLessGreaterPipe')
  assert.strictEqual(sanitizeFileName('  Trailing and   multiple    spaces   '), 'Trailing and multiple spaces')
  assert.strictEqual(sanitizeFileName('...dots.at.edges...'), 'dots.at.edges')
  assert.strictEqual(sanitizeFileName('Control\x00Code\x1FTest'), 'ControlCodeTest')
  assert.strictEqual(sanitizeFileName(''), '')
})

test('Lyrics Download: buildLyricsFileName constructs sanitized, formatted filenames [FEATURE-059]', () => {
  const fileNameLrc = buildLyricsFileName(testTrack, 'lrc')
  assert.strictEqual(fileNameLrc, 'The Weeknd XO - Blinding Lights After Hours.lrc')

  const fileNameTtml = buildLyricsFileName(testTrack, 'ttml')
  assert.strictEqual(fileNameTtml, 'The Weeknd XO - Blinding Lights After Hours.ttml')

  // Partial metadata fallbacks
  const noArtistTrack: Track = { id: 't2', title: 'Only Title', artistName: '' }
  assert.strictEqual(buildLyricsFileName(noArtistTrack, 'json'), 'Only Title.json')

  const noTitleTrack: Track = { id: 't3', title: '', artistName: 'Only Artist' }
  assert.strictEqual(buildLyricsFileName(noTitleTrack, 'txt'), 'Only Artist - lyrics.txt')

  const blankTrack: Track = { id: 't4', title: '', artistName: '' }
  assert.strictEqual(buildLyricsFileName(blankTrack, 'lrc'), 'lyrics.lrc')
})

test('Lyrics Download: downloadLyrics generates validated result and updates telemetry [FEATURE-059]', () => {
  resetLyricsExportMetrics()

  const result = lyricsExporter.downloadLyrics(testTrack, testLyrics, {
    format: 'lrc',
    includeMetadata: true,
    includeWordTimings: true,
  })

  // Validate with schema
  const parsed = lyricsDownloadResultSchema.safeParse(result)
  assert.strictEqual(parsed.success, true)
  assert.strictEqual(result.success, true)
  assert.strictEqual(result.format, 'lrc')
  assert.strictEqual(result.fileName, 'The Weeknd XO - Blinding Lights After Hours.lrc')
  assert.strictEqual(result.mimeType, 'application/x-subrip')
  assert.ok(result.sizeBytes > 0)
  assert.ok(result.exportedAt.length > 0)

  // Validate TTML download
  const ttmlResult = lyricsExporter.downloadLyrics(testTrack, testLyrics, {
    format: 'ttml',
  })
  assert.strictEqual(ttmlResult.format, 'ttml')
  assert.strictEqual(ttmlResult.mimeType, 'application/ttml+xml')
  assert.ok(ttmlResult.sizeBytes > 0)

  // Validate JSON download
  const jsonResult = lyricsExporter.downloadLyrics(testTrack, testLyrics, {
    format: 'json',
  })
  assert.strictEqual(jsonResult.format, 'json')
  assert.strictEqual(jsonResult.mimeType, 'application/json')
  assert.ok(jsonResult.sizeBytes > 0)

  // Validate TXT download
  const txtResult = lyricsExporter.downloadLyrics(testTrack, testLyrics, {
    format: 'txt',
  })
  assert.strictEqual(txtResult.format, 'txt')
  assert.strictEqual(txtResult.mimeType, 'text/plain')
  assert.ok(txtResult.sizeBytes > 0)

  // Verify Metrics
  const metrics = getLyricsExportMetrics()
  assert.strictEqual(metrics.totalDownloads, 4)
  assert.strictEqual(metrics.downloadsByFormat.lrc, 1)
  assert.strictEqual(metrics.downloadsByFormat.ttml, 1)
  assert.strictEqual(metrics.downloadsByFormat.json, 1)
  assert.strictEqual(metrics.downloadsByFormat.txt, 1)
})
