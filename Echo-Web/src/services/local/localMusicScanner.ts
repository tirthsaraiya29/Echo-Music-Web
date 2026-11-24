import { z } from 'zod'
import { db, type LocalFileRecord } from '../db/echoDatabase.ts'
import type { Track } from '../../types/domain'
import { getLocalArtworkUrl, revokeLocalArtwork } from './objectUrlRegistry.ts'

export { getLocalArtworkUrl, revokeLocalArtwork }

export const localFileInputSchema = z.object({
  fileName: z.string().min(1),
  fileSize: z.number().int().nonnegative().max(1024 * 1024 * 500),
  mimeType: z.string().optional(),
})

export const localFileRecordSchema = z.object({
  id: z.string().min(1),
  fileName: z.string().min(1),
  title: z.string().min(1),
  artist: z.string().min(1),
  album: z.string().min(1),
  durationSeconds: z.number().nonnegative(),
  year: z.string().optional(),
  genre: z.string().optional(),
  mimeType: z.string(),
  addedAt: z.number().positive(),
  fileSize: z.number().nonnegative(),
})

export const localMusicMetricsSchema = z.object({
  filesImported: z.number().nonnegative(),
  filesRejected: z.number().nonnegative(),
  filesDeleted: z.number().nonnegative(),
  lastError: z.string().nullable(),
})

export type LocalMusicMetrics = z.infer<typeof localMusicMetricsSchema>

const localMusicMetrics: LocalMusicMetrics = {
  filesImported: 0,
  filesRejected: 0,
  filesDeleted: 0,
  lastError: null,
}

export function getLocalMusicMetrics(): LocalMusicMetrics {
  return { ...localMusicMetrics }
}

export function resetLocalMusicMetrics(): void {
  localMusicMetrics.filesImported = 0
  localMusicMetrics.filesRejected = 0
  localMusicMetrics.filesDeleted = 0
  localMusicMetrics.lastError = null
}

export interface ParsedAudioMeta {
  title: string
  artist: string
  album: string
  year?: string | undefined
  genre?: string | undefined
  artworkBlob?: Blob | undefined
}

export const ID3V1_GENRES: readonly string[] = [
  'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop',
  'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock',
  'Techno', 'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack',
  'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance',
  'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise',
  'AlternRock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop',
  'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial', 'Electronic',
  'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta',
  'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave',
  'Psychadelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz',
  'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock',
]

function normalizeGenre(genreStr: string): string {
  const match = genreStr.match(/^\(?(\d+)\)?$/)
  if (match && match[1]) {
    const idx = parseInt(match[1], 10)
    if (idx >= 0 && idx < ID3V1_GENRES.length && ID3V1_GENRES[idx]) {
      return ID3V1_GENRES[idx]!
    }
  }
  return genreStr
}

function decodeTextFrame(view: DataView, offset: number, size: number): string {
  if (size <= 1) return ''
  const encoding = view.getUint8(offset)
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset + 1, size - 1)

  try {
    if (encoding === 0) {
      return new TextDecoder('latin1').decode(bytes).replace(/\0/g, '').trim()
    } else if (encoding === 1 || encoding === 2) {
      return new TextDecoder('utf-16').decode(bytes).replace(/\0/g, '').trim()
    } else {
      return new TextDecoder('utf-8').decode(bytes).replace(/\0/g, '').trim()
    }
  } catch {
    return ''
  }
}

function extractApicPicture(view: DataView, offset: number, size: number): Blob | null {
  try {
    let p = offset + 1
    let mimeType = ''
    while (p < offset + size) {
      const b = view.getUint8(p++)
      if (b === 0) break
      mimeType += String.fromCharCode(b)
    }

    if (!mimeType) mimeType = 'image/jpeg'
    p++ // skip picture type

    while (p < offset + size) {
      const b = view.getUint8(p++)
      if (b === 0) break
    }

    const imgArrayBuffer = view.buffer.slice(view.byteOffset + p, view.byteOffset + offset + size)
    if (imgArrayBuffer.byteLength > 0) {
      return new Blob([imgArrayBuffer as ArrayBuffer], { type: mimeType })
    }
  } catch {
    // Ignore picture extraction failure
  }
  return null
}

function extractPicPicture(view: DataView, offset: number, size: number): Blob | null {
  try {
    if (size < 6) return null
    let fmt = ''
    for (let i = 1; i <= 3; i++) {
      fmt += String.fromCharCode(view.getUint8(offset + i))
    }
    const mimeType = fmt.toUpperCase() === 'PNG' ? 'image/png' : 'image/jpeg'
    let p = offset + 5
    while (p < offset + size) {
      const b = view.getUint8(p++)
      if (b === 0) break
    }
    const imgArrayBuffer = view.buffer.slice(view.byteOffset + p, view.byteOffset + offset + size)
    if (imgArrayBuffer.byteLength > 0) {
      return new Blob([imgArrayBuffer as ArrayBuffer], { type: mimeType })
    }
  } catch {
    // Ignore
  }
  return null
}

function parseVorbisComments(
  view: DataView,
  offset: number,
  length: number,
  meta: ParsedAudioMeta,
): void {
  try {
    let p = offset
    const maxOffset = offset + length
    if (p + 4 > maxOffset) return
    const vendorLength = view.getUint32(p, true)
    p += 4 + vendorLength
    if (p + 4 > maxOffset) return
    const commentCount = view.getUint32(p, true)
    p += 4

    const decoder = new TextDecoder('utf-8')
    for (let i = 0; i < commentCount && p + 4 <= maxOffset; i++) {
      const commentLen = view.getUint32(p, true)
      p += 4
      if (p + commentLen > maxOffset) break
      const commentBytes = new Uint8Array(view.buffer, view.byteOffset + p, commentLen)
      const commentStr = decoder.decode(commentBytes)
      p += commentLen

      const eqIdx = commentStr.indexOf('=')
      if (eqIdx !== -1) {
        const key = commentStr.slice(0, eqIdx).toUpperCase().trim()
        const val = commentStr.slice(eqIdx + 1).trim()
        if (key === 'TITLE' && val) {
          meta.title = val
        } else if (key === 'ARTIST' && val) {
          meta.artist = val
        } else if (key === 'ALBUM' && val) {
          meta.album = val
        } else if ((key === 'DATE' || key === 'YEAR') && val) {
          meta.year = val
        } else if (key === 'GENRE' && val) {
          meta.genre = normalizeGenre(val)
        }
      }
    }
  } catch {
    // Ignore
  }
}

function extractFlacPicture(view: DataView, offset: number, length: number): Blob | null {
  try {
    let p = offset
    const maxOffset = offset + length
    if (p + 8 > maxOffset) return null
    p += 4 // Skip picture type
    const mimeLen = view.getUint32(p, false)
    p += 4
    if (p + mimeLen + 4 > maxOffset) return null
    let mimeType = ''
    for (let i = 0; i < mimeLen; i++) {
      mimeType += String.fromCharCode(view.getUint8(p + i))
    }
    p += mimeLen
    const descLen = view.getUint32(p, false)
    p += 4 + descLen
    p += 16 // Skip width, height, depth, colors
    if (p + 4 > maxOffset) return null
    const dataLen = view.getUint32(p, false)
    p += 4
    if (p + dataLen <= maxOffset && dataLen > 0) {
      const imgBuffer = view.buffer.slice(view.byteOffset + p, view.byteOffset + p + dataLen)
      return new Blob([imgBuffer as ArrayBuffer], { type: mimeType || 'image/jpeg' })
    }
  } catch {
    // Ignore
  }
  return null
}

function parseFlacMetadata(view: DataView, headerBuffer: ArrayBuffer, meta: ParsedAudioMeta): void {
  try {
    let offset = 4 // skip 'fLaC'
    const totalBytes = headerBuffer.byteLength
    while (offset + 4 <= totalBytes) {
      const b0 = view.getUint8(offset)
      const isLast = (b0 & 0x80) !== 0
      const blockType = b0 & 0x7f
      const blockLength =
        (view.getUint8(offset + 1) << 16) |
        (view.getUint8(offset + 2) << 8) |
        view.getUint8(offset + 3)

      const blockDataOffset = offset + 4
      if (blockDataOffset + blockLength > totalBytes) {
        break
      }

      if (blockType === 4) {
        parseVorbisComments(view, blockDataOffset, blockLength, meta)
      } else if (blockType === 6) {
        const pic = extractFlacPicture(view, blockDataOffset, blockLength)
        if (pic) {
          meta.artworkBlob = pic
        }
      }

      offset = blockDataOffset + blockLength
      if (isLast) break
    }
  } catch {
    // Ignore
  }
}

function parseOggMetadata(view: DataView, headerBuffer: ArrayBuffer, meta: ParsedAudioMeta): void {
  try {
    const bytes = new Uint8Array(headerBuffer)
    const total = bytes.length
    for (let i = 0; i < total - 8; i++) {
      if (
        bytes[i] === 0x03 &&
        bytes[i + 1] === 0x76 &&
        bytes[i + 2] === 0x6f &&
        bytes[i + 3] === 0x72 &&
        bytes[i + 4] === 0x62 &&
        bytes[i + 5] === 0x69 &&
        bytes[i + 6] === 0x73
      ) {
        parseVorbisComments(view, i + 7, total - (i + 7), meta)
        return
      }
      if (
        bytes[i] === 0x4f &&
        bytes[i + 1] === 0x70 &&
        bytes[i + 2] === 0x75 &&
        bytes[i + 3] === 0x73 &&
        bytes[i + 4] === 0x54 &&
        bytes[i + 5] === 0x61 &&
        bytes[i + 6] === 0x67 &&
        bytes[i + 7] === 0x73
      ) {
        parseVorbisComments(view, i + 8, total - (i + 8), meta)
        return
      }
    }
  } catch {
    // Ignore
  }
}

function parseId3v2(
  view: DataView,
  headerBuffer: ArrayBuffer,
  meta: ParsedAudioMeta,
): void {
  try {
    const version = view.getUint8(3)
    const tagSize =
      ((view.getUint8(6) & 0x7f) << 21) |
      ((view.getUint8(7) & 0x7f) << 14) |
      ((view.getUint8(8) & 0x7f) << 7) |
      (view.getUint8(9) & 0x7f)

    let offset = 10
    const maxOffset = Math.min(tagSize + 10, headerBuffer.byteLength)

    if (version === 2) {
      // ID3v2.2
      while (offset + 6 <= maxOffset) {
        let frameId = ''
        for (let i = 0; i < 3; i++) {
          const c = view.getUint8(offset + i)
          if (c >= 32 && c <= 126) frameId += String.fromCharCode(c)
        }
        if (frameId.length < 3 || /[^A-Z0-9]/.test(frameId)) break

        const frameSize =
          (view.getUint8(offset + 3) << 16) |
          (view.getUint8(offset + 4) << 8) |
          view.getUint8(offset + 5)

        if (frameSize <= 0 || offset + 6 + frameSize > headerBuffer.byteLength) break
        const frameDataOffset = offset + 6

        if (frameId === 'TT2') {
          const val = decodeTextFrame(view, frameDataOffset, frameSize)
          if (val) meta.title = val
        } else if (frameId === 'TP1') {
          const val = decodeTextFrame(view, frameDataOffset, frameSize)
          if (val) meta.artist = val
        } else if (frameId === 'TAL') {
          const val = decodeTextFrame(view, frameDataOffset, frameSize)
          if (val) meta.album = val
        } else if (frameId === 'TYE') {
          const val = decodeTextFrame(view, frameDataOffset, frameSize)
          if (val) meta.year = val
        } else if (frameId === 'TCO') {
          const val = decodeTextFrame(view, frameDataOffset, frameSize)
          if (val) meta.genre = normalizeGenre(val)
        } else if (frameId === 'PIC') {
          const pic = extractPicPicture(view, frameDataOffset, frameSize)
          if (pic) meta.artworkBlob = pic
        }

        offset += 6 + frameSize
      }
    } else {
      // ID3v2.3 & ID3v2.4
      while (offset + 10 <= maxOffset) {
        let frameId = ''
        for (let i = 0; i < 4; i++) {
          const c = view.getUint8(offset + i)
          if (c >= 32 && c <= 126) frameId += String.fromCharCode(c)
        }
        if (frameId.length < 4 || /[^A-Z0-9]/.test(frameId)) break

        let frameSize = 0
        if (version === 4) {
          frameSize =
            ((view.getUint8(offset + 4) & 0x7f) << 21) |
            ((view.getUint8(offset + 5) & 0x7f) << 14) |
            ((view.getUint8(offset + 6) & 0x7f) << 7) |
            (view.getUint8(offset + 7) & 0x7f)
        } else {
          frameSize = view.getUint32(offset + 4)
        }

        if (frameSize <= 0 || offset + 10 + frameSize > headerBuffer.byteLength) break
        const frameDataOffset = offset + 10

        if (frameId === 'TIT2') {
          const val = decodeTextFrame(view, frameDataOffset, frameSize)
          if (val) meta.title = val
        } else if (frameId === 'TPE1') {
          const val = decodeTextFrame(view, frameDataOffset, frameSize)
          if (val) meta.artist = val
        } else if (frameId === 'TALB') {
          const val = decodeTextFrame(view, frameDataOffset, frameSize)
          if (val) meta.album = val
        } else if (frameId === 'TYER' || frameId === 'TDRC') {
          const val = decodeTextFrame(view, frameDataOffset, frameSize)
          if (val) meta.year = val
        } else if (frameId === 'TCON') {
          const val = decodeTextFrame(view, frameDataOffset, frameSize)
          if (val) meta.genre = normalizeGenre(val)
        } else if (frameId === 'APIC') {
          const pic = extractApicPicture(view, frameDataOffset, frameSize)
          if (pic) meta.artworkBlob = pic
        }

        offset += 10 + frameSize
      }
    }
  } catch {
    // Ignore
  }
}

async function parseId3v1(
  file: File,
  meta: ParsedAudioMeta,
  fallbackTitle: string,
): Promise<void> {
  if (file.size < 128) return
  try {
    const trailingBuffer = await file.slice(file.size - 128).arrayBuffer()
    const view = new DataView(trailingBuffer)

    // Check "TAG" (0x54, 0x41, 0x47)
    if (
      view.getUint8(0) === 0x54 &&
      view.getUint8(1) === 0x41 &&
      view.getUint8(2) === 0x47
    ) {
      const latin1 = new TextDecoder('latin1')
      const decodeField = (start: number, len: number): string => {
        const bytes = new Uint8Array(trailingBuffer, start, len)
        let s = latin1.decode(bytes)
        const nullIdx = s.indexOf('\0')
        if (nullIdx !== -1) s = s.slice(0, nullIdx)
        return s.trim()
      }

      const v1Title = decodeField(3, 30)
      const v1Artist = decodeField(33, 30)
      const v1Album = decodeField(63, 30)
      const v1Year = decodeField(93, 4)
      const genreIndex = view.getUint8(127)

      if (v1Title && (meta.title === fallbackTitle || !meta.title)) {
        meta.title = v1Title
      }
      if (v1Artist && (meta.artist === 'Local Artist' || !meta.artist)) {
        meta.artist = v1Artist
      }
      if (v1Album && (meta.album === 'Local Music' || !meta.album)) {
        meta.album = v1Album
      }
      if (v1Year && !meta.year && /^\d{4}$/.test(v1Year)) {
        meta.year = v1Year
      }
      if (!meta.genre && genreIndex < ID3V1_GENRES.length && ID3V1_GENRES[genreIndex]) {
        meta.genre = ID3V1_GENRES[genreIndex]
      }
    }
  } catch {
    // Ignore ID3v1 parsing error
  }
}

/**
 * Lightweight, format-aware metadata parser supporting ID3v1, ID3v2.2, ID3v2.3, ID3v2.4,
 * and FLAC/Vorbis comments and pictures.
 */
export async function parseAudioMetadata(file: File): Promise<ParsedAudioMeta> {
  const fallbackTitle = file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ')
  const meta: ParsedAudioMeta = {
    title: fallbackTitle,
    artist: 'Local Artist',
    album: 'Local Music',
  }

  try {
    const readSize = Math.min(262144, file.size)
    if (readSize >= 4) {
      const headerBuffer = await file.slice(0, readSize).arrayBuffer()
      const view = new DataView(headerBuffer)

      if (
        view.getUint8(0) === 0x49 &&
        view.getUint8(1) === 0x44 &&
        view.getUint8(2) === 0x33
      ) {
        parseId3v2(view, headerBuffer, meta)
      } else if (
        view.getUint8(0) === 0x66 &&
        view.getUint8(1) === 0x4c &&
        view.getUint8(2) === 0x61 &&
        view.getUint8(3) === 0x43
      ) {
        parseFlacMetadata(view, headerBuffer, meta)
      } else if (
        view.getUint8(0) === 0x4f &&
        view.getUint8(1) === 0x67 &&
        view.getUint8(2) === 0x67 &&
        view.getUint8(3) === 0x53
      ) {
        parseOggMetadata(view, headerBuffer, meta)
      }
    }

    await parseId3v1(file, meta, fallbackTitle)
  } catch {
    // Graceful fallback to defaults
  }

  return meta
}

export function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    if (typeof Audio === 'undefined') {
      resolve(0)
      return
    }
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    audio.preload = 'metadata'

    const cleanup = () => {
      URL.revokeObjectURL(url)
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('error', onError)
    }

    const onLoaded = () => {
      const dur = Math.round(audio.duration) || 0
      cleanup()
      resolve(dur)
    }

    const onError = () => {
      cleanup()
      resolve(0)
    }

    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('error', onError)
    audio.src = url
  })
}

export async function importLocalFile(
  file: File,
  options?: { signal?: AbortSignal },
): Promise<LocalFileRecord> {
  if (options?.signal?.aborted) {
    localMusicMetrics.filesRejected++
    localMusicMetrics.lastError = 'Import cancelled'
    throw new Error('Import cancelled')
  }

  const validation = localFileInputSchema.safeParse({
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
  })

  if (!validation.success) {
    localMusicMetrics.filesRejected++
    const msg = validation.error.issues[0]?.message || 'Invalid audio file'
    localMusicMetrics.lastError = msg
    throw new Error(msg)
  }

  const meta = await parseAudioMetadata(file)
  if (options?.signal?.aborted) {
    localMusicMetrics.filesRejected++
    localMusicMetrics.lastError = 'Import cancelled'
    throw new Error('Import cancelled')
  }

  const durationSeconds = await getAudioDuration(file)
  const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const record: LocalFileRecord = {
    id,
    fileName: file.name,
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    durationSeconds,
    year: meta.year,
    genre: meta.genre,
    artworkBlob: meta.artworkBlob,
    audioBlob: file,
    mimeType: file.type || 'audio/mpeg',
    addedAt: Date.now(),
    fileSize: file.size,
  }

  if (typeof indexedDB !== 'undefined') {
    await db.localFiles.put(record)
  }

  localMusicMetrics.filesImported++
  return record
}

export async function importLocalFiles(
  files: FileList | File[],
  onProgress?: (current: number, total: number, fileName: string) => void,
  options?: { signal?: AbortSignal },
): Promise<LocalFileRecord[]> {
  const validFiles = Array.from(files).filter((f) =>
    /\.(mp3|flac|wav|ogg|m4a|aac|webm)$/i.test(f.name),
  )

  const records: LocalFileRecord[] = []
  for (let i = 0; i < validFiles.length; i++) {
    if (options?.signal?.aborted) {
      localMusicMetrics.filesRejected += validFiles.length - i
      localMusicMetrics.lastError = 'Batch import cancelled'
      throw new Error('Batch import cancelled')
    }
    const file = validFiles[i]!
    onProgress?.(i + 1, validFiles.length, file.name)
    try {
      const rec = await importLocalFile(file, options)
      records.push(rec)
    } catch (err) {
      localMusicMetrics.filesRejected++
      localMusicMetrics.lastError = err instanceof Error ? err.message : String(err)
    }
  }

  return records
}

export async function deleteLocalTrack(id: string): Promise<void> {
  revokeLocalArtwork(id)
  localMusicMetrics.filesDeleted++
  if (typeof indexedDB !== 'undefined') {
    await db.localFiles.delete(id)
  }
}

export function localRecordToTrack(record: LocalFileRecord): Track {
  const artworkUrl = record.artworkBlob
    ? getLocalArtworkUrl(record.id, record.artworkBlob)
    : ''

  return {
    id: record.id,
    title: record.title,
    artistName: record.artist,
    artistId: `artist_local_${encodeURIComponent(record.artist)}`,
    albumId: `album_local_${encodeURIComponent(record.album)}`,
    albumTitle: record.album,
    albumImage: artworkUrl,
    artwork: artworkUrl,
    thumbnailUrl: artworkUrl,
    durationMs: record.durationSeconds * 1000,
    durationSeconds: record.durationSeconds,
    explicit: false,
    playCount: 0,
    videoId: record.id,
  }
}

export async function getAllLocalTracks(): Promise<Track[]> {
  if (typeof indexedDB === 'undefined') return []
  const records = await db.localFiles.orderBy('addedAt').reverse().toArray()
  return records.map(localRecordToTrack)
}
