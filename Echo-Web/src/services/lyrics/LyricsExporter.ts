/**
 * Lyrics Export & Serialization Service.
 *
 * Responsibilities:
 * - Exports synchronized, word-synced, and plain lyrics with complete track metadata
 *   and explicit character encoding tags.
 * - Supports standardized formats: Enhanced LRC (.lrc), Timed Text Markup Language (.ttml),
 *   structured JSON (.json), and cleaned Plain Text (.txt).
 * - Full metadata preservation: Title, Artist, Album, Duration, Provider, Offset, Software,
 *   Encoding, and Export Timestamp.
 * - Syllable/word-level timing preservation in Enhanced LRC (<mm:ss.xx>) and TTML (<span begin="" end="">).
 * - Optional dual-track AI translation inclusion ({trans} or TTML translation role).
 * - Telemetry metrics instrumentation and runtime schema validation via Zod.
 */

import { z } from 'zod'
import type { Track } from '../../types/domain.ts'
import type { SynchronizedLyrics } from '../../types/lyrics.ts'

export type LyricsExportFormat = 'lrc' | 'ttml' | 'json' | 'txt'

export const lyricsExportFormatSchema = z.enum(['lrc', 'ttml', 'json', 'txt'])

export const lyricsExportOptionsSchema = z.object({
  format: lyricsExportFormatSchema.default('lrc'),
  includeMetadata: z.boolean().default(true),
  includeTranslation: z.boolean().default(true),
  includeWordTimings: z.boolean().default(true),
  encoding: z.enum(['UTF-8', 'UTF-8-BOM']).default('UTF-8'),
  offsetMs: z.number().int().default(0),
  lineBreak: z.enum(['LF', 'CRLF']).default('LF'),
})

export type LyricsExportOptions = z.infer<typeof lyricsExportOptionsSchema>

export const lyricsExportResultSchema = z.object({
  format: lyricsExportFormatSchema,
  content: z.string(),
  mimeType: z.string(),
  encoding: z.enum(['UTF-8', 'UTF-8-BOM']),
  lineCount: z.number().int().nonnegative(),
  characterCount: z.number().int().nonnegative(),
  metadata: z.object({
    title: z.string(),
    artist: z.string(),
    album: z.string().optional(),
    durationSeconds: z.number().nonnegative().optional(),
    provider: z.string(),
    encoding: z.string(),
    software: z.string(),
    exportedAt: z.string(),
  }),
})

export type LyricsExportResult = z.infer<typeof lyricsExportResultSchema>

export const lyricsDownloadResultSchema = z.object({
  success: z.boolean(),
  fileName: z.string(),
  format: lyricsExportFormatSchema,
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  exportedAt: z.string(),
  error: z.string().optional(),
})

export type LyricsDownloadResult = z.infer<typeof lyricsDownloadResultSchema>

export const lyricsExportMetricsSchema = z.object({
  totalExports: z.number().int().nonnegative(),
  exportsByFormat: z.record(z.string(), z.number().int().nonnegative()),
  metadataIncludedCount: z.number().int().nonnegative(),
  translationsIncludedCount: z.number().int().nonnegative(),
  wordTimingsIncludedCount: z.number().int().nonnegative(),
  totalDownloads: z.number().int().nonnegative(),
  downloadsByFormat: z.record(z.string(), z.number().int().nonnegative()),
})

export type LyricsExportMetrics = z.infer<typeof lyricsExportMetricsSchema>

let exportMetrics: LyricsExportMetrics = {
  totalExports: 0,
  exportsByFormat: {
    lrc: 0,
    ttml: 0,
    json: 0,
    txt: 0,
  },
  metadataIncludedCount: 0,
  translationsIncludedCount: 0,
  wordTimingsIncludedCount: 0,
  totalDownloads: 0,
  downloadsByFormat: {
    lrc: 0,
    ttml: 0,
    json: 0,
    txt: 0,
  },
}

export function getLyricsExportMetrics(): LyricsExportMetrics {
  return {
    ...exportMetrics,
    exportsByFormat: { ...exportMetrics.exportsByFormat },
    downloadsByFormat: { ...exportMetrics.downloadsByFormat },
  }
}

export function resetLyricsExportMetrics(): void {
  exportMetrics = {
    totalExports: 0,
    exportsByFormat: {
      lrc: 0,
      ttml: 0,
      json: 0,
      txt: 0,
    },
    metadataIncludedCount: 0,
    translationsIncludedCount: 0,
    wordTimingsIncludedCount: 0,
    totalDownloads: 0,
    downloadsByFormat: {
      lrc: 0,
      ttml: 0,
      json: 0,
      txt: 0,
    },
  }
}

/**
 * Sanitizes a string for use in filenames across Windows, macOS, and Linux.
 * Strips invalid characters: \ / : * ? " < > | and ASCII/Unicode control characters.
 */
export function sanitizeFileName(name: string): string {
  if (!name) return ''
  return name
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[\x00-\x1f\x80-\x9f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
}

/**
 * Builds standard lyrics filename based on track and export format:
 * "${Artist} - ${Title}.${ext}" or "${Title}.${ext}" or "lyrics.${ext}".
 */
export function buildLyricsFileName(track: Track, format: LyricsExportFormat): string {
  const cleanArtist = sanitizeFileName(track.artistName || '')
  const cleanTitle = sanitizeFileName(track.title || '')
  const ext = format.toLowerCase()

  if (cleanArtist && cleanTitle) {
    return `${cleanArtist} - ${cleanTitle}.${ext}`
  } else if (cleanTitle) {
    return `${cleanTitle}.${ext}`
  } else if (cleanArtist) {
    return `${cleanArtist} - lyrics.${ext}`
  } else {
    return `lyrics.${ext}`
  }
}

/**
 * Formats a millisecond timestamp into standard LRC time tag: [mm:ss.xx]
 */
export function formatLrcTimestamp(ms: number): string {
  const clampedMs = Math.max(0, Math.round(ms))
  const totalSeconds = Math.floor(clampedMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const hundredths = Math.floor((clampedMs % 1000) / 10)

  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  const xx = String(hundredths).padStart(2, '0')

  return `[${mm}:${ss}.${xx}]`
}

/**
 * Formats a millisecond timestamp into standard TTML time tag: mm:ss.xxx
 */
export function formatTTMLTimestamp(ms: number): string {
  const clampedMs = Math.max(0, Math.round(ms))
  const totalSeconds = Math.floor(clampedMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const millis = clampedMs % 1000

  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  const mmm = String(millis).padStart(3, '0')

  return `${mm}:${ss}.${mmm}`
}

/**
 * Formats total seconds into standard mm:ss
 */
export function formatDurationMMSS(durationSeconds?: number): string {
  if (!durationSeconds || durationSeconds <= 0) return '00:00'
  const min = Math.floor(durationSeconds / 60)
  const sec = Math.floor(durationSeconds % 60)
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export class LyricsExporter {
  private static instance: LyricsExporter | null = null

  public static getInstance(): LyricsExporter {
    if (!LyricsExporter.instance) {
      LyricsExporter.instance = new LyricsExporter()
    }
    return LyricsExporter.instance
  }

  /**
   * Main export dispatcher. Generates formatted string and metadata description.
   */
  public exportLyrics(
    track: Track,
    lyrics: SynchronizedLyrics,
    options?: Partial<LyricsExportOptions>,
  ): LyricsExportResult {
    const validOptions = lyricsExportOptionsSchema.parse(options || {})
    const lb = validOptions.lineBreak === 'CRLF' ? '\r\n' : '\n'
    const exportedAt = new Date().toISOString()
    const software = 'Echo Music Web'

    let content = ''
    let mimeType = 'text/plain'

    switch (validOptions.format) {
      case 'lrc':
        content = this.generateLrc(track, lyrics, validOptions, lb, exportedAt)
        mimeType = 'application/x-subrip'
        break
      case 'ttml':
        content = this.generateTTML(track, lyrics, validOptions, lb, exportedAt)
        mimeType = 'application/ttml+xml'
        break
      case 'json':
        content = this.generateJson(track, lyrics, validOptions, exportedAt)
        mimeType = 'application/json'
        break
      case 'txt':
      default:
        content = this.generatePlainText(track, lyrics, validOptions, lb, exportedAt)
        mimeType = 'text/plain'
        break
    }

    // Apply UTF-8 BOM if requested
    if (validOptions.encoding === 'UTF-8-BOM') {
      content = '\uFEFF' + content
    }

    // Instrumentation
    exportMetrics.totalExports++
    exportMetrics.exportsByFormat[validOptions.format] =
      (exportMetrics.exportsByFormat[validOptions.format] || 0) + 1
    if (validOptions.includeMetadata) exportMetrics.metadataIncludedCount++
    if (validOptions.includeTranslation) exportMetrics.translationsIncludedCount++
    if (validOptions.includeWordTimings) exportMetrics.wordTimingsIncludedCount++

    const lines = content.split(/\r\n|\r|\n/)

    return {
      format: validOptions.format,
      content,
      mimeType,
      encoding: validOptions.encoding,
      lineCount: lines.length,
      characterCount: content.length,
      metadata: {
        title: track.title,
        artist: track.artistName,
        album: track.albumTitle,
        durationSeconds: track.durationSeconds,
        provider: lyrics.provider,
        encoding: validOptions.encoding,
        software,
        exportedAt,
      },
    }
  }

  /**
   * Generates lyrics and triggers local file download in browser or creates blob.
   */
  public downloadLyrics(
    track: Track,
    lyrics: SynchronizedLyrics,
    options?: Partial<LyricsExportOptions>,
  ): LyricsDownloadResult {
    const exportResult = this.exportLyrics(track, lyrics, options)
    const fileName = buildLyricsFileName(track, exportResult.format)

    try {
      const mimeType = exportResult.mimeType
      let blobSize = 0

      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        const blob = new Blob([exportResult.content], { type: `${mimeType};charset=utf-8` })
        blobSize = blob.size

        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      } else if (typeof Blob !== 'undefined') {
        const blob = new Blob([exportResult.content], { type: `${mimeType};charset=utf-8` })
        blobSize = blob.size
      } else {
        blobSize = new TextEncoder().encode(exportResult.content).length
      }

      exportMetrics.totalDownloads++
      exportMetrics.downloadsByFormat[exportResult.format] =
        (exportMetrics.downloadsByFormat[exportResult.format] || 0) + 1

      return lyricsDownloadResultSchema.parse({
        success: true,
        fileName,
        format: exportResult.format,
        mimeType,
        sizeBytes: blobSize,
        exportedAt: exportResult.metadata.exportedAt,
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        fileName,
        format: exportResult.format,
        mimeType: exportResult.mimeType,
        sizeBytes: 0,
        exportedAt: exportResult.metadata.exportedAt,
        error: errorMsg,
      }
    }
  }

  /**
   * Generates Standard or Enhanced LRC with ID3/LRC metadata tags.
   */
  private generateLrc(
    track: Track,
    lyrics: SynchronizedLyrics,
    options: LyricsExportOptions,
    lb: string,
    exportedAt: string,
  ): string {
    const lines: string[] = []

    if (options.includeMetadata) {
      lines.push(`[ti:${track.title}]`)
      lines.push(`[ar:${track.artistName}]`)
      if (track.albumTitle) lines.push(`[al:${track.albumTitle}]`)
      if (track.durationSeconds) lines.push(`[length:${formatDurationMMSS(track.durationSeconds)}]`)
      lines.push(`[by:Echo Music Web Client]`)
      lines.push(`[re:Echo Music]`)
      lines.push(`[ve:2.0.0]`)
      lines.push(`[encoding:${options.encoding}]`)
      lines.push(`[provider:${lyrics.provider}]`)
      lines.push(`[exportedAt:${exportedAt}]`)
      if (options.offsetMs !== 0) {
        lines.push(`[offset:${options.offsetMs > 0 ? '+' : ''}${options.offsetMs}]`)
      }
      lines.push('')
    }

    for (const line of lyrics.lines) {
      const lineTime = line.startTimeMs + options.offsetMs
      const timeTag = formatLrcTimestamp(lineTime)

      let lineText = line.text || ''
      if (line.isBackground) {
        lineText = `{bg} ${lineText}`
      }

      if (options.includeWordTimings && line.words && line.words.length > 0) {
        // Enhanced LRC syllable format
        const wordTokens = line.words.map((w) => {
          const wordTime = w.startTimeMs + options.offsetMs
          return `<${formatLrcTimestamp(wordTime).slice(1, -1)}> ${w.text}`
        })
        lines.push(`${timeTag} ${wordTokens.join(' ')}`.trim())
      } else {
        lines.push(`${timeTag} ${lineText}`)
      }

      // Secondary AI translation line if present
      if (options.includeTranslation && line.translatedText && line.translatedText.trim()) {
        lines.push(`${timeTag} {trans} ${line.translatedText.trim()}`)
      }
    }

    return lines.join(lb)
  }

  /**
   * Generates W3C Timed Text Markup Language (TTML) XML with metadata head.
   */
  private generateTTML(
    track: Track,
    lyrics: SynchronizedLyrics,
    options: LyricsExportOptions,
    lb: string,
    exportedAt: string,
  ): string {
    const xmlEscape = (str: string) =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')

    const lines: string[] = []
    lines.push(`<?xml version="1.0" encoding="utf-8"?>`)
    lines.push(
      `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xml:lang="en">`,
    )
    lines.push(`  <head>`)

    if (options.includeMetadata) {
      lines.push(`    <metadata>`)
      lines.push(`      <ttm:title>${xmlEscape(track.title)}</ttm:title>`)
      lines.push(`      <ttm:agent type="person">${xmlEscape(track.artistName)}</ttm:agent>`)
      if (track.albumTitle) {
        lines.push(`      <ttm:item type="album">${xmlEscape(track.albumTitle)}</ttm:item>`)
      }
      if (track.durationSeconds) {
        lines.push(`      <ttm:item type="duration">${track.durationSeconds}s</ttm:item>`)
      }
      lines.push(`      <ttm:item type="provider">${xmlEscape(lyrics.provider)}</ttm:item>`)
      lines.push(`      <ttm:item type="encoding">${options.encoding}</ttm:item>`)
      lines.push(`      <ttm:item type="exportedAt">${exportedAt}</ttm:item>`)
      lines.push(`      <ttm:desc>Exported by Echo Music Web</ttm:desc>`)
      lines.push(`    </metadata>`)
    }

    lines.push(`  </head>`)
    lines.push(`  <body>`)
    lines.push(`    <div>`)

    for (const line of lyrics.lines) {
      const beginTime = line.startTimeMs + options.offsetMs
      const endTime = line.endTimeMs
        ? line.endTimeMs + options.offsetMs
        : beginTime + 3000

      const beginTag = formatTTMLTimestamp(beginTime)
      const endTag = formatTTMLTimestamp(endTime)

      if (options.includeWordTimings && line.words && line.words.length > 0) {
        lines.push(`      <p begin="${beginTag}" end="${endTag}">`)
        for (const word of line.words) {
          const wBegin = formatTTMLTimestamp(word.startTimeMs + options.offsetMs)
          const wEnd = formatTTMLTimestamp(word.endTimeMs + options.offsetMs)
          lines.push(
            `        <span begin="${wBegin}" end="${wEnd}">${xmlEscape(word.text)}</span>`,
          )
        }
        lines.push(`      </p>`)
      } else {
        lines.push(
          `      <p begin="${beginTag}" end="${endTag}">${xmlEscape(line.text)}</p>`,
        )
      }

      if (options.includeTranslation && line.translatedText && line.translatedText.trim()) {
        lines.push(
          `      <p begin="${beginTag}" end="${endTag}" ttm:role="x-translation">${xmlEscape(
            line.translatedText.trim(),
          )}</p>`,
        )
      }
    }

    lines.push(`    </div>`)
    lines.push(`  </body>`)
    lines.push(`</tt>`)

    return lines.join(lb)
  }

  /**
   * Generates structured JSON representation with track metadata.
   */
  private generateJson(
    track: Track,
    lyrics: SynchronizedLyrics,
    options: LyricsExportOptions,
    exportedAt: string,
  ): string {
    const payload = {
      version: '1.0',
      format: 'echo-lyrics',
      metadata: options.includeMetadata
        ? {
            title: track.title,
            artist: track.artistName,
            album: track.albumTitle || undefined,
            durationSeconds: track.durationSeconds || undefined,
            provider: lyrics.provider,
            encoding: options.encoding,
            offsetMs: options.offsetMs,
            software: 'Echo Music Web',
            exportedAt,
          }
        : undefined,
      isSynced: lyrics.isSynced,
      isWordSynced: lyrics.isWordSynced,
      lines: lyrics.lines.map((l) => ({
        startTimeMs: l.startTimeMs + options.offsetMs,
        endTimeMs: l.endTimeMs ? l.endTimeMs + options.offsetMs : undefined,
        text: l.text,
        translatedText: options.includeTranslation ? l.translatedText : undefined,
        isBackground: l.isBackground,
        words:
          options.includeWordTimings && l.words
            ? l.words.map((w) => ({
                text: w.text,
                startTimeMs: w.startTimeMs + options.offsetMs,
                endTimeMs: w.endTimeMs + options.offsetMs,
              }))
            : undefined,
      })),
    }

    return JSON.stringify(payload, null, 2)
  }

  /**
   * Generates Plain Text representation with optional metadata header comments.
   */
  private generatePlainText(
    track: Track,
    lyrics: SynchronizedLyrics,
    options: LyricsExportOptions,
    lb: string,
    exportedAt: string,
  ): string {
    const lines: string[] = []

    if (options.includeMetadata) {
      lines.push(`# Title: ${track.title}`)
      lines.push(`# Artist: ${track.artistName}`)
      if (track.albumTitle) lines.push(`# Album: ${track.albumTitle}`)
      if (track.durationSeconds) {
        lines.push(`# Duration: ${formatDurationMMSS(track.durationSeconds)}`)
      }
      lines.push(`# Provider: ${lyrics.provider}`)
      lines.push(`# Encoding: ${options.encoding}`)
      lines.push(`# Exported: ${exportedAt}`)
      lines.push('')
    }

    for (const line of lyrics.lines) {
      lines.push(line.text)
      if (options.includeTranslation && line.translatedText && line.translatedText.trim()) {
        lines.push(`  (${line.translatedText.trim()})`)
      }
    }

    return lines.join(lb)
  }
}

export const lyricsExporter = LyricsExporter.getInstance()
