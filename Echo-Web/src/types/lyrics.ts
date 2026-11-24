export interface LyricWord {
  text: string
  startTimeMs: number
  endTimeMs: number
}

export interface LyricLine {
  startTimeMs: number
  endTimeMs?: number | undefined
  text: string
  translatedText?: string | undefined
  words?: LyricWord[] | undefined
  agent?: string | undefined
  isBackground?: boolean | undefined
}

export type LyricsProviderType = 'BETTER_LYRICS' | 'LRCLIB' | 'KUGOU' | 'YOUTUBE'

export interface SynchronizedLyrics {
  provider: LyricsProviderType
  isSynced: boolean
  isWordSynced: boolean
  lines: LyricLine[]
}
