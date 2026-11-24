import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  LyricsExporter,
  lyricsExporter,
  formatLrcTimestamp,
  formatTTMLTimestamp,
  formatDurationMMSS,
  lyricsExportOptionsSchema,
  lyricsExportResultSchema,
  getLyricsExportMetrics,
  resetLyricsExportMetrics,
} from '../src/services/lyrics/LyricsExporter.ts'
import type { Track } from '../src/types/domain.ts'
import type { SynchronizedLyrics } from '../src/types/lyrics.ts'

const sampleTrack: Track = {
  id: 'track-test-123',
  title: 'Starboy',
  artistName: 'The Weeknd, Daft Punk',
  albumTitle: 'Starboy (Deluxe)',
  durationSeconds: 230,
}

const sampleLyrics: SynchronizedLyrics = {
  provider: 'LRCLIB',
  isSynced: true,
  isWordSynced: true,
  lines: [
    {
      startTimeMs: 15200,
      endTimeMs: 18500,
      text: "I'm tryna put you in the worst mood, ah",
      translatedText: "J'essaie de te mettre de mauvaise humeur, ah",
      words: [
        { text: "I'm", startTimeMs: 15200, endTimeMs: 15600 },
        { text: 'tryna', startTimeMs: 15600, endTimeMs: 16100 },
        { text: 'put', startTimeMs: 16100, endTimeMs: 16500 },
        { text: 'you', startTimeMs: 16500, endTimeMs: 16900 },
      ],
    },
    {
      startTimeMs: 19100,
      endTimeMs: 22400,
      text: 'P1 cleaner than your church shoes, ah',
      isBackground: true,
    },
  ],
}

test('Lyrics Export: timestamp formatting produces valid standard tokens [FEATURE-058]', () => {
  // LRC format: [mm:ss.xx]
  assert.strictEqual(formatLrcTimestamp(0), '[00:00.00]')
  assert.strictEqual(formatLrcTimestamp(15234), '[00:15.23]')
  assert.strictEqual(formatLrcTimestamp(75320), '[01:15.32]')
  assert.strictEqual(formatLrcTimestamp(3661450), '[61:01.45]')

  // TTML format: mm:ss.xxx
  assert.strictEqual(formatTTMLTimestamp(0), '00:00.000')
  assert.strictEqual(formatTTMLTimestamp(15234), '00:15.234')
  assert.strictEqual(formatTTMLTimestamp(75320), '01:15.320')

  // Duration: mm:ss
  assert.strictEqual(formatDurationMMSS(230), '03:50')
  assert.strictEqual(formatDurationMMSS(0), '00:00')
})

test('Lyrics Export: schemas validate options and result payloads [FEATURE-058]', () => {
  const options = lyricsExportOptionsSchema.parse({
    format: 'lrc',
    encoding: 'UTF-8',
    offsetMs: 500,
  })
  assert.strictEqual(options.format, 'lrc')
  assert.strictEqual(options.encoding, 'UTF-8')
  assert.strictEqual(options.includeMetadata, true)
  assert.strictEqual(options.offsetMs, 500)

  const res = lyricsExporter.exportLyrics(sampleTrack, sampleLyrics, options)
  assert.strictEqual(lyricsExportResultSchema.safeParse(res).success, true)
  assert.strictEqual(res.format, 'lrc')
  assert.strictEqual(res.metadata.title, 'Starboy')
  assert.strictEqual(res.metadata.artist, 'The Weeknd, Daft Punk')
})

test('Lyrics Export: LRC generation includes metadata tags, word timings, and translations [FEATURE-058]', () => {
  resetLyricsExportMetrics()

  const res = lyricsExporter.exportLyrics(sampleTrack, sampleLyrics, {
    format: 'lrc',
    includeMetadata: true,
    includeTranslation: true,
    includeWordTimings: true,
    offsetMs: 1000,
  })

  const content = res.content
  // Verify metadata tags
  assert.ok(content.includes('[ti:Starboy]'))
  assert.ok(content.includes('[ar:The Weeknd, Daft Punk]'))
  assert.ok(content.includes('[al:Starboy (Deluxe)]'))
  assert.ok(content.includes('[length:03:50]'))
  assert.ok(content.includes('[provider:LRCLIB]'))
  assert.ok(content.includes('[encoding:UTF-8]'))
  assert.ok(content.includes('[offset:+1000]'))

  // Verify offset shifted timing: 15200 + 1000 = 16200ms -> [00:16.20]
  assert.ok(content.includes('[00:16.20]'))

  // Verify word-by-word timing tokens
  assert.ok(content.includes('<00:16.20>'))

  // Verify background vocal tag
  assert.ok(content.includes('{bg} P1 cleaner than your church shoes, ah'))

  // Verify AI translation inclusion
  assert.ok(content.includes("{trans} J'essaie de te mettre de mauvaise humeur, ah"))

  const metrics = getLyricsExportMetrics()
  assert.strictEqual(metrics.totalExports, 1)
  assert.strictEqual(metrics.exportsByFormat.lrc, 1)
  assert.strictEqual(metrics.metadataIncludedCount, 1)
  assert.strictEqual(metrics.translationsIncludedCount, 1)
  assert.strictEqual(metrics.wordTimingsIncludedCount, 1)
})

test('Lyrics Export: TTML generation creates valid XML with metadata head [FEATURE-058]', () => {
  const res = lyricsExporter.exportLyrics(sampleTrack, sampleLyrics, {
    format: 'ttml',
    includeMetadata: true,
    includeTranslation: true,
    includeWordTimings: true,
  })

  const content = res.content
  assert.ok(content.includes('<?xml version="1.0" encoding="utf-8"?>'))
  assert.ok(content.includes('<ttm:title>Starboy</ttm:title>'))
  assert.ok(content.includes('<ttm:agent type="person">The Weeknd, Daft Punk</ttm:agent>'))
  assert.ok(content.includes('<ttm:item type="album">Starboy (Deluxe)</ttm:item>'))
  assert.ok(content.includes('<ttm:item type="provider">LRCLIB</ttm:item>'))
  assert.ok(content.includes('<ttm:item type="encoding">UTF-8</ttm:item>'))

  // Verify paragraphs and span tokens
  assert.ok(content.includes('<p begin="00:15.200" end="00:18.500">'))
  assert.ok(content.includes('<span begin="00:15.200" end="00:15.600">I&apos;m</span>'))

  // Verify translation paragraph
  assert.ok(content.includes('ttm:role="x-translation"'))
})

test('Lyrics Export: JSON and Plain Text generation formats correctly [FEATURE-058]', () => {
  // JSON
  const jsonRes = lyricsExporter.exportLyrics(sampleTrack, sampleLyrics, {
    format: 'json',
    includeMetadata: true,
  })
  const parsed = JSON.parse(jsonRes.content)
  assert.strictEqual(parsed.metadata.title, 'Starboy')
  assert.strictEqual(parsed.metadata.provider, 'LRCLIB')
  assert.strictEqual(parsed.lines.length, 2)

  // Plain Text
  const txtRes = lyricsExporter.exportLyrics(sampleTrack, sampleLyrics, {
    format: 'txt',
    includeMetadata: true,
    includeTranslation: true,
  })
  assert.ok(txtRes.content.includes('# Title: Starboy'))
  assert.ok(txtRes.content.includes('# Provider: LRCLIB'))
  assert.ok(txtRes.content.includes("I'm tryna put you in the worst mood, ah"))
})

test('Lyrics Export: UTF-8 BOM encoding prepends byte order mark [FEATURE-058]', () => {
  const bomRes = lyricsExporter.exportLyrics(sampleTrack, sampleLyrics, {
    format: 'lrc',
    encoding: 'UTF-8-BOM',
  })
  assert.strictEqual(bomRes.content.startsWith('\uFEFF'), true)
  assert.strictEqual(bomRes.encoding, 'UTF-8-BOM')
})

test('Lyrics Export: documentation artifact exists [FEATURE-058]', () => {
  const docPath = 'docs/lyrics-export-metadata.md'
  assert.strictEqual(fs.existsSync(docPath), true, 'lyrics-export-metadata.md must exist')
})
