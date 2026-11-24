/**
 * LyricsPlus (YouLyPlus / KPoe) synchronized lyrics provider.
 *
 * Upstream parity:
 * - Matches upstream Android YouLyPlus / KPoe API client implementation
 *   (echo.music.iad1tya.lyrics.YouLyPlusLyricsProvider & com.music.youlyplus.YouLyPlus).
 * - Queries community-hosted mirrors with automated fast-path winning mirror promotion.
 * - Parses rich syllable-level word timings ('syllabus') and background vocals ('{bg}' / 'isBackground').
 * - Parses standard and extended timestamped LRC lines (<mm:ss.xxx> syllables).
 * - Full schema validation, telemetry metrics tracking, and error resilience.
 */

import { z } from 'zod'
import type { LyricLine, LyricWord, SynchronizedLyrics } from '../../types/lyrics.ts'

export const DEFAULT_LYRICS_PLUS_SERVERS: readonly string[] = [
  'https://lyricsplus.prjktla.my.id',
  'https://lyricsplus.atomix.one',
  'https://lyricsplus.binimum.org',
  'https://lyricsplus.prjktla.workers.dev',
  'https://lyricsplus-seven.vercel.app',
  'https://lyrics-plus-backend.vercel.app',
] as const

// --- Zod Schemas ---

export const lyricsPlusSyllableSchema = z.object({
  text: z.string().optional().default(''),
  time: z.number().nonnegative().optional(),
  duration: z.number().nonnegative().optional(),
  isBackground: z.boolean().optional().default(false),
})

export type LyricsPlusSyllable = z.infer<typeof lyricsPlusSyllableSchema>

export const lyricsPlusItemSchema = z.object({
  text: z.string().optional(),
  time: z.number().nonnegative().optional(),
  duration: z.number().nonnegative().optional(),
  syllabus: z.array(lyricsPlusSyllableSchema).optional(),
})

export type LyricsPlusItem = z.infer<typeof lyricsPlusItemSchema>

export const lyricsPlusResponseSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  syncedLyrics: z.string().nullable().optional(),
  plainLyrics: z.string().nullable().optional(),
  lyrics: z.array(lyricsPlusItemSchema).nullable().optional(),
  type: z.string().optional(),
  trackName: z.string().optional(),
  artistName: z.string().optional(),
  albumName: z.string().optional(),
  duration: z.number().optional(),
})

export type LyricsPlusResponse = z.infer<typeof lyricsPlusResponseSchema>

export const lyricsPlusMetricsSchema = z.object({
  totalRequests: z.number().int().nonnegative(),
  successfulRequests: z.number().int().nonnegative(),
  failedRequests: z.number().int().nonnegative(),
  mirrorFailovers: z.number().int().nonnegative(),
  wordSyncedHits: z.number().int().nonnegative(),
  lineSyncedHits: z.number().int().nonnegative(),
  plainHits: z.number().int().nonnegative(),
  lastWinningMirror: z.string().nullable(),
  avgLatencyMs: z.number().nonnegative(),
})

export type LyricsPlusMetrics = z.infer<typeof lyricsPlusMetricsSchema>

// Module-level telemetry metrics
let lyricsPlusMetrics: LyricsPlusMetrics = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  mirrorFailovers: 0,
  wordSyncedHits: 0,
  lineSyncedHits: 0,
  plainHits: 0,
  lastWinningMirror: null,
  avgLatencyMs: 0,
}

let totalLatencyAccumulator = 0
let lastWorkingServer: string | null = null

export function getLyricsPlusMetrics(): LyricsPlusMetrics {
  return { ...lyricsPlusMetrics }
}

export function resetLyricsPlusMetrics(): void {
  lyricsPlusMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    mirrorFailovers: 0,
    wordSyncedHits: 0,
    lineSyncedHits: 0,
    plainHits: 0,
    lastWinningMirror: null,
    avgLatencyMs: 0,
  }
  totalLatencyAccumulator = 0
  lastWorkingServer = null
}

export function getLastWorkingServer(): string | null {
  return lastWorkingServer
}

export function setLastWorkingServer(server: string | null): void {
  lastWorkingServer = server
  if (server) {
    lyricsPlusMetrics.lastWinningMirror = server
  }
}

/**
 * Parses syllable timestamp tags (<mm:ss.xxx>) embedded within an LRC line.
 */
export function parseSyllableWords(rawLine: string, _lineStartTimeMs?: number): { text: string; words: LyricWord[] } {
  const syllableRegex = /<(\d{1,2}):(\d{1,2})(?:\.(\d{2,3}))?>([^<]+)/g
  const words: LyricWord[] = []
  let match: RegExpExecArray | null
  syllableRegex.lastIndex = 0

  while ((match = syllableRegex.exec(rawLine)) !== null) {
    const minutes = parseInt(match[1] || '0', 10)
    const seconds = parseInt(match[2] || '0', 10)
    const fractionStr = match[3] || '0'
    const fractionMs = fractionStr.length === 2 ? parseInt(fractionStr, 10) * 10 : parseInt(fractionStr, 10)
    const startMs = minutes * 60 * 1000 + seconds * 1000 + fractionMs
    const wordText = (match[4] || '').trim()

    if (wordText) {
      words.push({
        text: wordText,
        startTimeMs: startMs,
        endTimeMs: startMs + 400, // estimated until next word or line end
      })
    }
  }

  // Adjust end times based on next word
  for (let i = 0; i < words.length; i++) {
    const current = words[i]
    if (!current) continue
    const next = words[i + 1]
    if (next) {
      current.endTimeMs = next.startTimeMs
    }
  }

  // Strip syllable tags to get pure clean text
  const cleanText = rawLine.replace(/<\d{1,2}:\d{1,2}(?:\.\d{2,3})?>/g, '').trim()

  return {
    text: cleanText,
    words: words.length > 0 ? words : [],
  }
}

/**
 * Parses raw LRC string with support for background markers {bg} and syllable timestamps.
 */
export function parseLyricsPlusLrc(lrcContent: string): LyricLine[] {
  if (!lrcContent || typeof lrcContent !== 'string') return []

  const lines = lrcContent.split(/\r?\n/)
  const parsedLines: LyricLine[] = []
  const timeRegex = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{2,3}))?\]/g

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue

    const timestamps: number[] = []
    let match: RegExpExecArray | null
    timeRegex.lastIndex = 0

    while ((match = timeRegex.exec(trimmed)) !== null) {
      const minutes = parseInt(match[1] || '0', 10)
      const seconds = parseInt(match[2] || '0', 10)
      const fractionStr = match[3] || '0'
      const fractionMs = fractionStr.length === 2 ? parseInt(fractionStr, 10) * 10 : parseInt(fractionStr, 10)
      const timeMs = minutes * 60 * 1000 + seconds * 1000 + fractionMs
      timestamps.push(timeMs)
    }

    if (timestamps.length === 0) continue

    let contentAfterTime = trimmed.replace(timeRegex, '').trim()
    const isBackground = contentAfterTime.startsWith('{bg}') || contentAfterTime.endsWith('{bg}')
    if (isBackground) {
      contentAfterTime = contentAfterTime.replace(/\{bg\}/g, '').trim()
    }

    const { text, words } = parseSyllableWords(contentAfterTime, timestamps[0] || 0)
    if (!text && words.length === 0) continue

    for (const timeMs of timestamps) {
      parsedLines.push({
        startTimeMs: timeMs,
        text,
        isBackground,
        ...(words.length > 0 ? { words } : {}),
      })
    }
  }

  parsedLines.sort((a, b) => a.startTimeMs - b.startTimeMs)

  for (let i = 0; i < parsedLines.length; i++) {
    const current = parsedLines[i]
    if (!current) continue
    const next = parsedLines[i + 1]
    if (next) {
      current.endTimeMs = next.startTimeMs
      if (current.words && current.words.length > 0) {
        const lastWord = current.words[current.words.length - 1]
        if (lastWord && lastWord.endTimeMs > next.startTimeMs) {
          lastWord.endTimeMs = next.startTimeMs
        }
      }
    }
  }

  return parsedLines
}

/**
 * Converts KPoe style array of `LyricsItem` to `LyricLine[]` with precise word-by-word timing.
 */
export function parseLyricsPlusItems(items: LyricsPlusItem[]): LyricLine[] {
  if (!items || items.length === 0) return []

  const lines: LyricLine[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    const lineTime = item.time ?? 0
    const lineDuration = item.duration ?? 0
    const lineEndTime = lineTime + (lineDuration > 0 ? lineDuration : 3500)

    const syllabus = item.syllabus || []
    const isBackground = syllabus.some((s) => s.isBackground)

    const words: LyricWord[] = []
    let synthesizedText = ''

    if (syllabus.length > 0) {
      for (const syl of syllabus) {
        const sylText = syl.text || ''
        synthesizedText += sylText
        const trimmedSyl = sylText.trim()
        if (trimmedSyl) {
          const sylStart = syl.time ?? lineTime
          const sylDuration = syl.duration ?? 300
          words.push({
            text: trimmedSyl,
            startTimeMs: sylStart,
            endTimeMs: sylStart + sylDuration,
          })
        }
      }
    }

    const finalLineText = (item.text || synthesizedText).trim()
    if (!finalLineText && words.length === 0) continue

    lines.push({
      startTimeMs: lineTime,
      endTimeMs: lineEndTime,
      text: finalLineText,
      isBackground,
      ...(words.length > 0 ? { words } : {}),
    })
  }

  lines.sort((a, b) => a.startTimeMs - b.startTimeMs)

  // Ensure consecutive monotonic end times
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i]
    if (!current) continue
    const next = lines[i + 1]
    if (next && (!current.endTimeMs || current.endTimeMs > next.startTimeMs)) {
      current.endTimeMs = next.startTimeMs
    }
  }

  return lines
}

export class LyricsPlusProvider {
  /**
   * Returns prioritized server list with last working server promoted to front.
   */
  public static getServers(customServers?: string[]): string[] {
    const base = customServers && customServers.length > 0 ? customServers : [...DEFAULT_LYRICS_PLUS_SERVERS]
    if (!lastWorkingServer || !base.includes(lastWorkingServer)) {
      return base
    }
    return [lastWorkingServer, ...base.filter((s) => s !== lastWorkingServer)]
  }

  /**
   * Fetches lyrics across community mirrors with fallback cascade and winning mirror promotion.
   */
  public static async fetchLyrics(
    title: string,
    artist: string,
    album?: string,
    durationSeconds?: number,
    id?: string,
    signal?: AbortSignal,
    customServers?: string[],
  ): Promise<SynchronizedLyrics | null> {
    if (!title || !artist) return null

    lyricsPlusMetrics.totalRequests++
    const startTime = performance.now()
    const servers = this.getServers(customServers)

    let mirrorIndex = 0

    for (const server of servers) {
      if (signal?.aborted) break

      if (mirrorIndex > 0) {
        lyricsPlusMetrics.mirrorFailovers++
      }
      mirrorIndex++

      try {
        const url = new URL(server.endsWith('/') ? `${server}v2/lyrics/get` : `${server}/v2/lyrics/get`)
        url.searchParams.set('title', title)
        url.searchParams.set('artist', artist)
        if (durationSeconds && durationSeconds > 0) {
          url.searchParams.set('duration', Math.round(durationSeconds).toString())
        }
        if (album) {
          url.searchParams.set('album', album)
        }
        if (id) {
          url.searchParams.set('id', id)
        }

        const res = await fetch(url.toString(), {
          ...(signal ? { signal } : {}),
          headers: {
            Accept: 'application/json, text/plain, */*',
            'User-Agent': 'Echo-Music/1.0.0 (https://github.com/tirthsaraiya29/Echo-Music-Web)',
          },
        })

        if (!res.ok) {
          continue
        }

        const rawJson: unknown = await res.json()
        const parsed = lyricsPlusResponseSchema.safeParse(rawJson)
        if (!parsed.success) {
          continue
        }

        const data = parsed.data

        // 1. KPoe structured items (primary - word-by-word syllables)
        if (data.lyrics && data.lyrics.length > 0) {
          const lines = parseLyricsPlusItems(data.lyrics)
          if (lines.length > 0) {
            const hasWords = lines.some((l) => Boolean(l.words && l.words.length > 0))
            setLastWorkingServer(server)
            lyricsPlusMetrics.successfulRequests++
            if (hasWords) {
              lyricsPlusMetrics.wordSyncedHits++
            } else {
              lyricsPlusMetrics.lineSyncedHits++
            }
            this.recordLatency(performance.now() - startTime)

            return {
              provider: 'LYRICS_PLUS',
              isSynced: true,
              isWordSynced: hasWords,
              lines,
            }
          }
        }

        // 2. Synced LRC string
        if (data.syncedLyrics && data.syncedLyrics.trim().length > 0) {
          const lines = parseLyricsPlusLrc(data.syncedLyrics)
          if (lines.length > 0) {
            const hasWords = lines.some((l) => Boolean(l.words && l.words.length > 0))
            setLastWorkingServer(server)
            lyricsPlusMetrics.successfulRequests++
            if (hasWords) {
              lyricsPlusMetrics.wordSyncedHits++
            } else {
              lyricsPlusMetrics.lineSyncedHits++
            }
            this.recordLatency(performance.now() - startTime)

            return {
              provider: 'LYRICS_PLUS',
              isSynced: true,
              isWordSynced: hasWords,
              lines,
            }
          }
        }

        // 3. Plain unsynced lyrics fallback
        if (data.plainLyrics && data.plainLyrics.trim().length > 0) {
          const plainLines: LyricLine[] = data.plainLyrics
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l.length > 0)
            .map((text, idx) => ({
              startTimeMs: idx * 4000,
              endTimeMs: (idx + 1) * 4000,
              text,
            }))

          if (plainLines.length > 0) {
            setLastWorkingServer(server)
            lyricsPlusMetrics.successfulRequests++
            lyricsPlusMetrics.plainHits++
            this.recordLatency(performance.now() - startTime)

            return {
              provider: 'LYRICS_PLUS',
              isSynced: false,
              isWordSynced: false,
              lines: plainLines,
            }
          }
        }
      } catch {
        // Network timeout, CORS error, or parse error on this mirror; proceed to next mirror
      }
    }

    lyricsPlusMetrics.failedRequests++
    this.recordLatency(performance.now() - startTime)
    return null
  }

  private static recordLatency(latencyMs: number): void {
    totalLatencyAccumulator += latencyMs
    lyricsPlusMetrics.avgLatencyMs = Math.round(
      totalLatencyAccumulator / (lyricsPlusMetrics.totalRequests || 1),
    )
  }
}
