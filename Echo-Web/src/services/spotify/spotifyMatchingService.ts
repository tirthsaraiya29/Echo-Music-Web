import { InnerTubeClient } from '../innertube/client.ts'
import type { Track } from '../../types/domain.ts'
import {
  spotifyTrackTargetSchema,
  matchingBatchOptionsSchema,
  recordSpotifyMatchingMetric,
  type SpotifyTrackTarget,
  type TrackMatch,
  type MatchingBatchOptions,
} from './spotifyMatchingTypes.ts'

export const MIN_ACCEPTABLE_SCORE = 45

const VERSION_KEYWORDS = [
  'remix',
  'live',
  'acoustic',
  'instrumental',
  'karaoke',
  'cover',
  'slowed',
  'reverb',
  'sped up',
  'radio edit',
  'extended',
]

function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripSecondaryMetadata(text: string): string {
  return text
    .replace(/\(feat\..*?\)/gi, '')
    .replace(/\[feat\..*?\]/gi, '')
    .replace(/\(ft\..*?\)/gi, '')
    .replace(/\[ft\..*?\]/gi, '')
    .replace(/\(with.*?\)/gi, '')
    .replace(/\[with.*?\]/gi, '')
    .replace(/\(remaster.*?\)/gi, '')
    .replace(/\[remaster.*?\]/gi, '')
    .replace(/\(official.*?\)/gi, '')
    .replace(/\[official.*?\]/gi, '')
    .replace(/\(audio.*?\)/gi, '')
    .replace(/\[audio.*?\]/gi, '')
    .replace(/\(video.*?\)/gi, '')
    .replace(/\[video.*?\]/gi, '')
    .trim()
}

export function scoreCandidate(target: SpotifyTrackTarget, candidate: Track): number {
  const targetParse = spotifyTrackTargetSchema.safeParse(target)
  const safeTarget = targetParse.success ? targetParse.data : target

  // If ISRCs match exactly, instant 100
  if (
    safeTarget.isrc &&
    candidate.isrc &&
    safeTarget.isrc.trim().toUpperCase() === candidate.isrc.trim().toUpperCase()
  ) {
    recordSpotifyMatchingMetric('isrcExactMatches')
    return 100
  }

  let score = 0
  const targetTitleNorm = normalizeText(safeTarget.title)
  const candidateTitleNorm = normalizeText(candidate.title || '')

  const targetTitleCore = normalizeText(stripSecondaryMetadata(safeTarget.title))
  const candidateTitleCore = normalizeText(stripSecondaryMetadata(candidate.title || ''))

  // 1. Title match (up to 40 points)
  if (targetTitleNorm === candidateTitleNorm) {
    score += 40
  } else if (targetTitleCore && targetTitleCore === candidateTitleCore) {
    score += 35
  } else if (targetTitleCore && candidateTitleNorm.includes(targetTitleCore)) {
    score += 25
  } else if (candidateTitleCore && targetTitleNorm.includes(candidateTitleCore)) {
    score += 20
  } else {
    // Token overlap
    const targetWords = new Set(targetTitleCore.split(' ').filter(Boolean))
    const candWords = new Set(candidateTitleCore.split(' ').filter(Boolean))
    let intersection = 0
    for (const w of targetWords) {
      if (candWords.has(w)) intersection++
    }
    const union = new Set([...targetWords, ...candWords]).size
    if (union > 0) {
      score += Math.round((intersection / union) * 20)
    }
  }

  // 2. Artist match (up to 30 points)
  const targetArtistNorm = normalizeText(safeTarget.artist)
  const candidateArtistNorm = normalizeText(candidate.artistName || '')

  if (targetArtistNorm === candidateArtistNorm) {
    score += 30
  } else if (
    (targetArtistNorm && candidateArtistNorm.includes(targetArtistNorm)) ||
    (candidateArtistNorm && targetArtistNorm.includes(candidateArtistNorm))
  ) {
    score += 25
  } else {
    const targetPrimary = targetArtistNorm.split(/\band\b|&|,|\bfeat\b|\bft\b/)[0]?.trim()
    const candidatePrimary = candidateArtistNorm.split(/\band\b|&|,|\bfeat\b|\bft\b/)[0]?.trim()
    if (
      targetPrimary &&
      candidatePrimary &&
      (targetPrimary === candidatePrimary || candidateArtistNorm.includes(targetPrimary))
    ) {
      score += 20
    }
  }

  // 3. Duration match (up to 20 points, or penalty)
  const targetDurationSec =
    safeTarget.durationMs && safeTarget.durationMs > 0 ? safeTarget.durationMs / 1000 : undefined
  const candidateDurationSec =
    candidate.durationSeconds ||
    (candidate.durationMs && candidate.durationMs > 0 ? candidate.durationMs / 1000 : undefined)

  if (
    targetDurationSec !== undefined &&
    candidateDurationSec !== undefined &&
    targetDurationSec > 0 &&
    candidateDurationSec > 0
  ) {
    const delta = Math.abs(targetDurationSec - candidateDurationSec)
    if (delta <= 3) {
      score += 20
    } else if (delta <= 8) {
      score += 15
    } else if (delta <= 15) {
      score += 10
    } else if (delta <= 30) {
      score += 5
    } else if (delta > 60) {
      score -= 30
    }
  }

  // 4. Version Keyword Consistency Check
  for (const kw of VERSION_KEYWORDS) {
    const targetHasKw = targetTitleNorm.includes(kw)
    const candidateHasKw = candidateTitleNorm.includes(kw)

    if (!targetHasKw && candidateHasKw) {
      score -= 35
    } else if (targetHasKw && !candidateHasKw) {
      score -= 20
    } else if (targetHasKw && candidateHasKw) {
      score += 10
    }
  }

  return Math.max(0, score)
}

export function findBestTrackMatch(
  target: SpotifyTrackTarget,
  candidates: Track[],
  minAcceptableScore = MIN_ACCEPTABLE_SCORE,
): TrackMatch | null {
  recordSpotifyMatchingMetric('matchesEvaluated')

  if (!candidates || candidates.length === 0) {
    recordSpotifyMatchingMetric('rejectedMatches')
    return null
  }

  let bestMatch: TrackMatch | null = null

  for (const candidate of candidates) {
    const score = scoreCandidate(target, candidate)
    if (!bestMatch || score > bestMatch.score) {
      const confidence: 'high' | 'medium' | 'low' =
        score >= 70 ? 'high' : score >= minAcceptableScore ? 'medium' : 'low'
      bestMatch = { track: candidate, score, confidence }
    }
  }

  if (bestMatch && bestMatch.score >= minAcceptableScore) {
    if (bestMatch.confidence === 'high') {
      recordSpotifyMatchingMetric('highConfidenceMatches')
    } else if (bestMatch.confidence === 'medium') {
      recordSpotifyMatchingMetric('mediumConfidenceMatches')
    } else {
      recordSpotifyMatchingMetric('lowConfidenceMatches')
    }
    return bestMatch
  }

  recordSpotifyMatchingMetric('rejectedMatches')
  return null
}

const matchCache = new Map<string, TrackMatch | null>()
const inFlightMatchPromises = new Map<string, Promise<TrackMatch | null>>()
const MAX_MATCH_CACHE = 500

export function clearSpotifyMatchingCache(): void {
  matchCache.clear()
  inFlightMatchPromises.clear()
}

export interface MatchSingleTrackOptions {
  signal?: AbortSignal | undefined
  timeoutMs?: number | undefined
  candidates?: Track[] | undefined
  minAcceptableScore?: number | undefined
}

export async function matchSingleTrack(
  target: SpotifyTrackTarget,
  options: MatchSingleTrackOptions = {},
): Promise<TrackMatch | null> {
  const parsed = spotifyTrackTargetSchema.safeParse(target)
  if (!parsed.success) {
    recordSpotifyMatchingMetric('errors')
    throw new Error(`Invalid Spotify track target: ${parsed.error.issues[0]?.message}`)
  }

  const safeTarget = parsed.data
  const cacheKey = `${safeTarget.title}__${safeTarget.artist}__${safeTarget.durationMs || 0}__${safeTarget.isrc || ''}`.toLowerCase()

  if (matchCache.has(cacheKey)) {
    recordSpotifyMatchingMetric('cacheHits')
    return matchCache.get(cacheKey) ?? null
  }

  if (inFlightMatchPromises.has(cacheKey)) {
    recordSpotifyMatchingMetric('inFlightDeduplications')
    return inFlightMatchPromises.get(cacheKey)!
  }

  const execute = async (): Promise<TrackMatch | null> => {
    try {
      if (options.signal?.aborted) {
        throw new DOMException('Matching cancelled', 'AbortError')
      }

      let candidates = options.candidates
      if (!candidates) {
        const query = `${safeTarget.title} ${safeTarget.artist}`.trim()
        const timeoutMs = options.timeoutMs ?? 8000
        const timeoutCtrl = new AbortController()
        const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs)

        try {
          const searchCatalog = await InnerTubeClient.search(query, 'songs')
          candidates = searchCatalog.tracks || []
        } finally {
          clearTimeout(timer)
        }
      }

      const match = findBestTrackMatch(
        safeTarget,
        candidates,
        options.minAcceptableScore ?? MIN_ACCEPTABLE_SCORE,
      )

      matchCache.set(cacheKey, match)
      if (matchCache.size > MAX_MATCH_CACHE) {
        const oldest = matchCache.keys().next().value
        if (oldest !== undefined) matchCache.delete(oldest)
      }

      return match
    } catch (err: unknown) {
      if (options.signal?.aborted) {
        recordSpotifyMatchingMetric('cancellations')
      } else {
        recordSpotifyMatchingMetric('errors')
      }
      throw err
    } finally {
      inFlightMatchPromises.delete(cacheKey)
    }
  }

  const promise = execute()
  inFlightMatchPromises.set(cacheKey, promise)
  return promise
}

export type { SpotifyTrackTarget, TrackMatch }

export interface MatchBatchProgress {
  current: number
  total: number
  matchedCount: number
  currentTitle: string
}

export interface MatchTrackBatchOptions extends Partial<MatchingBatchOptions> {
  signal?: AbortSignal | undefined
  onProgress?: ((progress: MatchBatchProgress) => void) | undefined
  candidateProvider?: ((target: SpotifyTrackTarget) => Promise<Track[]>) | undefined
}

export async function matchTrackBatch(
  targets: SpotifyTrackTarget[],
  options: MatchTrackBatchOptions = {},
): Promise<{ matchedTracks: Track[]; unmatchedTitles: string[] }> {
  const parsedOptions = matchingBatchOptionsSchema.parse({
    concurrency: options.concurrency ?? 3,
    timeoutMs: options.timeoutMs ?? 8000,
    minAcceptableScore: options.minAcceptableScore ?? MIN_ACCEPTABLE_SCORE,
  })

  const total = targets.length
  const matchedTracks: Track[] = []
  const unmatchedTitles: string[] = []

  let index = 0
  const workers = Array.from({ length: parsedOptions.concurrency }, async () => {
    while (index < total) {
      if (options.signal?.aborted) {
        throw new DOMException('Batch matching cancelled', 'AbortError')
      }
      const currentIndex = index++
      const target = targets[currentIndex]!

      options.onProgress?.({
        current: currentIndex + 1,
        total,
        currentTitle: `${target.title} - ${target.artist}`,
        matchedCount: matchedTracks.length,
      })

      try {
        const candidates = options.candidateProvider
          ? await options.candidateProvider(target)
          : undefined

        const match = await matchSingleTrack(target, {
          signal: options.signal,
          timeoutMs: parsedOptions.timeoutMs,
          minAcceptableScore: parsedOptions.minAcceptableScore,
          candidates,
        })

        if (match) {
          matchedTracks.push(match.track)
        } else {
          unmatchedTitles.push(`${target.title} ${target.artist}`.trim())
        }
      } catch {
        if (options.signal?.aborted) throw new DOMException('Batch matching cancelled', 'AbortError')
        unmatchedTitles.push(`${target.title} ${target.artist}`.trim())
      }
    }
  })

  await Promise.all(workers)

  return { matchedTracks, unmatchedTitles }
}
