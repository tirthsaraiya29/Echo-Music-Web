import test from 'node:test'
import assert from 'node:assert'
import {
  parsedAudioMetaSchema,
  metadataParserMetricsSchema,
  getMetadataParserMetrics,
  resetMetadataParserMetrics,
  normalizeGenre,
  parseAudioMetadata,
  getAudioDuration,
} from '../src/services/local/localMusicScanner.ts'

test('Metadata Parser: parsedAudioMetaSchema validates required and optional tag fields', () => {
  const valid = {
    title: 'Instant Crush',
    artist: 'Daft Punk',
    album: 'Random Access Memories',
    year: '2013',
    genre: 'Electronic',
  }
  assert.strictEqual(parsedAudioMetaSchema.safeParse(valid).success, true)

  // Empty title fails
  assert.strictEqual(
    parsedAudioMetaSchema.safeParse({ ...valid, title: '' }).success,
    false,
  )

  // Empty artist fails
  assert.strictEqual(
    parsedAudioMetaSchema.safeParse({ ...valid, artist: '   ' }).success,
    false,
  )
})

test('Metadata Parser: normalizeGenre resolves ID3v1 numeric genres and passes through custom strings', () => {
  assert.strictEqual(normalizeGenre('0'), 'Blues')
  assert.strictEqual(normalizeGenre('(17)'), 'Rock')
  assert.strictEqual(normalizeGenre('17'), 'Rock')
  assert.strictEqual(normalizeGenre('(12)'), 'Other')
  assert.strictEqual(normalizeGenre('Hyperpop'), 'Hyperpop')
  assert.strictEqual(normalizeGenre('(999)'), '(999)')
})

test('Metadata Parser: parseAudioMetadata extracts ID3v1 tags and tracks metrics', async () => {
  resetMetadataParserMetrics()
  const initial = getMetadataParserMetrics()
  assert.strictEqual(initial.filesParsed, 0)
  assert.strictEqual(initial.id3v1Parsed, 0)
  assert.strictEqual(metadataParserMetricsSchema.safeParse(initial).success, true)

  // Construct a minimal 128-byte ID3v1 buffer
  const buffer = new Uint8Array(256)
  // TAG signature at offset (256 - 128) = 128
  buffer[128] = 0x54 // 'T'
  buffer[129] = 0x41 // 'A'
  buffer[130] = 0x47 // 'G'

  const latin1Encoder = new TextEncoder()
  const titleBytes = latin1Encoder.encode('ID3v1 Test Track')
  buffer.set(titleBytes, 131)

  const artistBytes = latin1Encoder.encode('ID3v1 Artist')
  buffer.set(artistBytes, 161)

  const albumBytes = latin1Encoder.encode('ID3v1 Album')
  buffer.set(albumBytes, 191)

  const yearBytes = latin1Encoder.encode('2024')
  buffer.set(yearBytes, 221)

  buffer[255] = 17 // Rock genre index

  const file = new File([buffer], 'test_track.mp3', { type: 'audio/mpeg' })
  const meta = await parseAudioMetadata(file)

  assert.strictEqual(meta.title, 'ID3v1 Test Track')
  assert.strictEqual(meta.artist, 'ID3v1 Artist')
  assert.strictEqual(meta.album, 'ID3v1 Album')
  assert.strictEqual(meta.year, '2024')
  assert.strictEqual(meta.genre, 'Rock')

  const metrics = getMetadataParserMetrics()
  assert.strictEqual(metrics.filesParsed, 1)
  assert.strictEqual(metrics.id3v1Parsed, 1)
})

test('Metadata Parser: signal cancellation and fallback recovery', async () => {
  const abortCtrl = new AbortController()
  abortCtrl.abort()

  const file = new File(['small dummy content'], 'my_favorite_song.mp3', { type: 'audio/mpeg' })
  const meta = await parseAudioMetadata(file, { signal: abortCtrl.signal })

  // Clean fallback from filename
  assert.strictEqual(meta.title, 'my favorite song')
  assert.strictEqual(meta.artist, 'Local Artist')

  const duration = await getAudioDuration(file, { signal: abortCtrl.signal })
  assert.strictEqual(duration, 0)

  // Reset metrics
  resetMetadataParserMetrics()
  const resetState = getMetadataParserMetrics()
  assert.strictEqual(resetState.filesParsed, 0)
  assert.strictEqual(resetState.id3v1Parsed, 0)
  assert.strictEqual(resetState.parseErrors, 0)
})
