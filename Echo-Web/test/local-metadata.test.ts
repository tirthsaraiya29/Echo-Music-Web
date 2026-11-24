import test from 'node:test'
import assert from 'node:assert'
import {
  parseAudioMetadata,
  ID3V1_GENRES,
} from '../src/services/local/localMusicScanner.ts'

function createId3v1Tag(fields: {
  title?: string
  artist?: string
  album?: string
  year?: string
  comment?: string
  genre?: number
}): Uint8Array {
  const buf = new Uint8Array(128)
  // 'TAG'
  buf[0] = 0x54
  buf[1] = 0x41
  buf[2] = 0x47

  const writeString = (str: string, offset: number, maxLen: number) => {
    for (let i = 0; i < maxLen && i < str.length; i++) {
      buf[offset + i] = str.charCodeAt(i)
    }
  }

  if (fields.title) writeString(fields.title, 3, 30)
  if (fields.artist) writeString(fields.artist, 33, 30)
  if (fields.album) writeString(fields.album, 63, 30)
  if (fields.year) writeString(fields.year, 93, 4)
  if (fields.comment) writeString(fields.comment, 97, 30)
  if (fields.genre !== undefined) buf[127] = fields.genre

  return buf
}

test('ID3v1 metadata parsing: extracts title, artist, album, year, and genre [BUG-28]', async () => {
  const dummyAudio = new Uint8Array(100) // 100 bytes of mock audio
  const id3v1 = createId3v1Tag({
    title: 'Retro Classic',
    artist: 'Vintage Band',
    album: 'Nostalgia LP',
    year: '1998',
    genre: 17, // 'Rock'
  })

  const fullFile = new Uint8Array(dummyAudio.length + id3v1.length)
  fullFile.set(dummyAudio, 0)
  fullFile.set(id3v1, dummyAudio.length)

  const file = new File([fullFile], 'track01.mp3', { type: 'audio/mpeg' })
  const meta = await parseAudioMetadata(file)

  assert.strictEqual(ID3V1_GENRES[17], 'Rock')
  assert.strictEqual(meta.title, 'Retro Classic')
  assert.strictEqual(meta.artist, 'Vintage Band')
  assert.strictEqual(meta.album, 'Nostalgia LP')
  assert.strictEqual(meta.year, '1998')
  assert.strictEqual(meta.genre, 'Rock')
})

test('ID3v2.2 parsing: extracts 3-char frames and PIC cover artwork [BUG-28]', async () => {
  // ID3v2.2 header: "ID3" (3 bytes), version 2 (1 byte), rev 0 (1 byte), flags 0 (1 byte), size (4 bytes synchsafe)
  const frames: number[] = []

  // Helper to append a v2.2 text frame (3-char ID, 3-byte size, encoding 0, text)
  const addV22TextFrame = (id: string, text: string) => {
    for (let i = 0; i < 3; i++) frames.push(id.charCodeAt(i))
    const size = text.length + 1
    frames.push((size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff)
    frames.push(0) // latin1 encoding
    for (let i = 0; i < text.length; i++) frames.push(text.charCodeAt(i))
  }

  addV22TextFrame('TT2', 'v2.2 Title')
  addV22TextFrame('TP1', 'v2.2 Artist')
  addV22TextFrame('TAL', 'v2.2 Album')
  addV22TextFrame('TYE', '2001')
  addV22TextFrame('TCO', 'Dance')

  // PIC frame: 3 chars 'PIC', 3-byte size: encoding (1) + format 'JPG' (3) + picType (1) + desc (1 null) + image (4 bytes)
  frames.push(0x50, 0x49, 0x43) // 'PIC'
  const picPayload = [0, 0x4a, 0x50, 0x47, 3, 0, 0xff, 0xd8, 0xff, 0xd9]
  frames.push((picPayload.length >> 16) & 0xff, (picPayload.length >> 8) & 0xff, picPayload.length & 0xff)
  frames.push(...picPayload)

  const tagSize = frames.length
  const header = [
    0x49, 0x44, 0x33, // "ID3"
    2, 0, 0,          // v2.2
    (tagSize >> 21) & 0x7f,
    (tagSize >> 14) & 0x7f,
    (tagSize >> 7) & 0x7f,
    tagSize & 0x7f,
  ]

  const totalBuffer = new Uint8Array([...header, ...frames, 0, 0, 0, 0])
  const file = new File([totalBuffer], 'v22.mp3', { type: 'audio/mpeg' })
  const meta = await parseAudioMetadata(file)

  assert.strictEqual(meta.title, 'v2.2 Title')
  assert.strictEqual(meta.artist, 'v2.2 Artist')
  assert.strictEqual(meta.album, 'v2.2 Album')
  assert.strictEqual(meta.year, '2001')
  assert.strictEqual(meta.genre, 'Dance')
  assert.ok(meta.artworkBlob)
  assert.strictEqual(meta.artworkBlob?.type, 'image/jpeg')
})

test('FLAC metadata parsing: extracts Vorbis comments and PICTURE block [BUG-28]', async () => {
  // Magic: 'fLaC' (4 bytes)
  const magic = [0x66, 0x4c, 0x61, 0x43]

  // Vorbis comments block (type 4):
  // Vendor length (4 bytes little-endian), vendor string, comment count (4 bytes LE)
  const comments = [
    'TITLE=FLAC High Res Song',
    'ARTIST=Audiophile Artist',
    'ALBUM=Lossless Dreams',
    'DATE=2024',
    'GENRE=Jazz',
  ]
  const vcBytes: number[] = []
  // vendor: "EchoMusic"
  const vendor = 'EchoMusic'
  vcBytes.push(vendor.length, 0, 0, 0)
  for (let i = 0; i < vendor.length; i++) vcBytes.push(vendor.charCodeAt(i))
  // comment count
  vcBytes.push(comments.length, 0, 0, 0)
  for (const c of comments) {
    vcBytes.push(c.length, 0, 0, 0)
    for (let i = 0; i < c.length; i++) vcBytes.push(c.charCodeAt(i))
  }

  // Block 1: type 4, not last (0x04), 24-bit length
  const block1Header = [
    4,
    (vcBytes.length >> 16) & 0xff,
    (vcBytes.length >> 8) & 0xff,
    vcBytes.length & 0xff,
  ]

  // Picture block (type 6), isLast = true (0x80 | 6 = 0x86)
  const picBytes: number[] = []
  // Picture type (4 bytes BE): 3 (front cover)
  picBytes.push(0, 0, 0, 3)
  // MIME length (4 bytes BE)
  const mime = 'image/png'
  picBytes.push(0, 0, 0, mime.length)
  for (let i = 0; i < mime.length; i++) picBytes.push(mime.charCodeAt(i))
  // Desc length (4 bytes BE): 0
  picBytes.push(0, 0, 0, 0)
  // width (4), height (4), depth (4), colors (4)
  picBytes.push(0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 24, 0, 0, 0, 0)
  // data length (4 bytes BE): 4 bytes PNG signature
  const imgData = [0x89, 0x50, 0x4e, 0x47]
  picBytes.push(0, 0, 0, imgData.length)
  picBytes.push(...imgData)

  const block2Header = [
    0x86, // isLast = true, type = 6
    (picBytes.length >> 16) & 0xff,
    (picBytes.length >> 8) & 0xff,
    picBytes.length & 0xff,
  ]

  const flacBuffer = new Uint8Array([
    ...magic,
    ...block1Header,
    ...vcBytes,
    ...block2Header,
    ...picBytes,
  ])

  const file = new File([flacBuffer], 'song.flac', { type: 'audio/flac' })
  const meta = await parseAudioMetadata(file)

  assert.strictEqual(meta.title, 'FLAC High Res Song')
  assert.strictEqual(meta.artist, 'Audiophile Artist')
  assert.strictEqual(meta.album, 'Lossless Dreams')
  assert.strictEqual(meta.year, '2024')
  assert.strictEqual(meta.genre, 'Jazz')
  assert.ok(meta.artworkBlob)
  assert.strictEqual(meta.artworkBlob?.type, 'image/png')
})

test('Hybrid ID3v2 + ID3v1 fallback: ID3v1 fills in fields omitted in ID3v2 [BUG-28]', async () => {
  // ID3v2 has ONLY title
  const frames: number[] = []
  // TIT2 frame
  const titleText = 'ID3v2 Modern Title'
  frames.push(0x54, 0x49, 0x54, 0x32) // "TIT2"
  const frameSize = titleText.length + 1
  frames.push(0, 0, 0, frameSize)
  frames.push(0, 0) // flags
  frames.push(0) // encoding
  for (let i = 0; i < titleText.length; i++) frames.push(titleText.charCodeAt(i))

  const tagSize = frames.length
  const v2Header = [
    0x49, 0x44, 0x33, // "ID3"
    3, 0, 0,          // v2.3
    (tagSize >> 21) & 0x7f,
    (tagSize >> 14) & 0x7f,
    (tagSize >> 7) & 0x7f,
    tagSize & 0x7f,
  ]

  // Trailing ID3v1 tag has Artist, Album, Year, Genre
  const id3v1 = createId3v1Tag({
    title: 'ID3v1 Old Title',
    artist: 'Legacy Band',
    album: 'Golden Era',
    year: '1975',
    genre: 1, // 'Classic Rock'
  })

  const dummyAudio = new Uint8Array(200)
  const fullBytes = new Uint8Array(v2Header.length + frames.length + dummyAudio.length + id3v1.length)
  let p = 0
  fullBytes.set(v2Header, p); p += v2Header.length
  fullBytes.set(frames, p); p += frames.length
  fullBytes.set(dummyAudio, p); p += dummyAudio.length
  fullBytes.set(id3v1, p)

  const file = new File([fullBytes], 'hybrid.mp3', { type: 'audio/mpeg' })
  const meta = await parseAudioMetadata(file)

  // Title came from ID3v2
  assert.strictEqual(meta.title, 'ID3v2 Modern Title')
  // Missing fields came from ID3v1
  assert.strictEqual(meta.artist, 'Legacy Band')
  assert.strictEqual(meta.album, 'Golden Era')
  assert.strictEqual(meta.year, '1975')
  assert.strictEqual(meta.genre, 'Classic Rock')
})
