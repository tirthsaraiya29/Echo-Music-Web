import {
  sessionMomentumContextSchema,
  type MomentumSignal,
  type SessionMomentumContext,
  type SessionMomentumState,
  type EchoBrainTelemetry,
  type EchoBrainOptions,
} from './echoBrainTypes.ts'
import type { Track } from '../../types/audio.ts'

export class EchoBrainService {
  private recentSignals: MomentumSignal[] = []
  private readonly maxSignalsWindow = 20

  private telemetry: EchoBrainTelemetry = {
    momentumEvaluations: 0,
    momentumInjections: 0,
    skipsDetected: 0,
    completionsDetected: 0,
    recoveryTriggers: 0,
    lastMomentumState: 'neutral',
    lastGeneratedCount: 0,
    lastDurationMs: 0,
  }

  public recordSignal(signal: MomentumSignal): void {
    if (signal.skipped) {
      this.telemetry.skipsDetected++
    }
    if (signal.completed) {
      this.telemetry.completionsDetected++
    }

    this.recentSignals.unshift(signal)
    if (this.recentSignals.length > this.maxSignalsWindow) {
      this.recentSignals.pop()
    }
  }

  public getRecentSignals(): ReadonlyArray<MomentumSignal> {
    return [...this.recentSignals]
  }

  public clearSignals(): void {
    this.recentSignals = []
  }

  public getTelemetry(): Readonly<EchoBrainTelemetry> {
    return { ...this.telemetry }
  }

  public resetTelemetry(): void {
    this.telemetry = {
      momentumEvaluations: 0,
      momentumInjections: 0,
      skipsDetected: 0,
      completionsDetected: 0,
      recoveryTriggers: 0,
      lastMomentumState: 'neutral',
      lastGeneratedCount: 0,
      lastDurationMs: 0,
    }
  }

  /**
   * Analyzes session velocity and determines the momentum state
   */
  public analyzeMomentum(
    signals: MomentumSignal[] = this.recentSignals,
    windowSize = 5,
  ): SessionMomentumState {
    const window = signals.slice(0, windowSize)
    if (window.length === 0) return 'neutral'

    let rapidSkips = 0
    let totalSkips = 0
    let completions = 0
    let likes = 0

    for (let i = 0; i < window.length; i++) {
      const s = window[i]!
      if (s.skipped) {
        totalSkips++
        if (s.durationPlayedMs < 30000) {
          rapidSkips++
        }
      }
      if (s.completed) {
        completions++
      }
      if (s.liked) {
        likes++
      }
    }

    const skipRate = totalSkips / window.length
    const completionRate = completions / window.length

    // Restless: multiple rapid skips or high skip rate indicating user is hunting for music
    if (rapidSkips >= 2 || (window.length >= 3 && skipRate >= 0.6)) {
      return 'restless'
    }

    // Focused: high completion rate and deep listening
    if (completionRate >= 0.6 && completions >= 2) {
      return 'focused'
    }

    // Exploring: user is engaged with likes or active varied listens
    if (likes > 0 || (completions >= 1 && totalSkips <= 1)) {
      return 'exploring'
    }

    return 'neutral'
  }

  /**
   * Scores candidate tracks against the current session momentum and listening context
   */
  public scoreCandidates(
    candidates: Track[],
    rawContext: SessionMomentumContext,
    momentum: SessionMomentumState,
  ): Array<{ track: Track; score: number }> {
    const context = sessionMomentumContextSchema.parse(rawContext)
    const excludedSet = new Set(context.excludedTrackIds)
    const likedSet = new Set(context.likedTrackIds)

    const recentSkippedArtists = new Set<string>()
    const recentCompletedArtists = new Set<string>()

    for (const s of context.recentSignals.slice(0, 5)) {
      if (s.skipped && s.artistName) {
        recentSkippedArtists.add(s.artistName.toLowerCase())
      }
      if (s.completed && s.artistName) {
        recentCompletedArtists.add(s.artistName.toLowerCase())
      }
    }

    const currentArtist = context.currentTrack?.artistName?.toLowerCase()

    return candidates
      .filter((t) => !excludedSet.has(t.id))
      .map((track) => {
        let score = 10.0
        const trackArtist = track.artistName?.toLowerCase() || ''
        const isLiked = likedSet.has(track.id)

        // Baseline affinity
        if (isLiked) {
          score += 5.0
        }

        switch (momentum) {
          case 'restless': {
            // Palate cleanser mode: heavily favor proven liked tracks & familiar artists
            if (isLiked) {
              score += 12.0
            }
            if (track.playCount && track.playCount > 2) {
              score += 6.0
            }
            // Penalize artists that were recently skipped in this session
            if (recentSkippedArtists.has(trackArtist)) {
              score -= 10.0
            }
            // Penalize very long tracks when restless (> 5 minutes)
            const durationSec = track.durationSeconds || (track.durationMs ? track.durationMs / 1000 : 0)
            if (durationSec > 300) {
              score -= 4.0
            }
            break
          }
          case 'focused': {
            // Flow continuation: favor matching/completed artist tracks
            if (currentArtist && trackArtist === currentArtist) {
              score += 8.0
            } else if (recentCompletedArtists.has(trackArtist)) {
              score += 5.0
            }
            // Mild bonus for unplayed novelty within the flow
            if (!track.playCount || track.playCount === 0) {
              score += 3.0
            }
            break
          }
          case 'exploring': {
            // Balanced discovery
            if (isLiked) {
              score += 4.0
            }
            if (!track.playCount || track.playCount === 0) {
              score += 5.0
            }
            break
          }
          case 'neutral':
          default: {
            if (isLiked) {
              score += 3.0
            }
            break
          }
        }

        return { track, score }
      })
      .sort((a, b) => b.score - a.score)
  }

  /**
   * Generates a momentum-tailored queue of tracks
   */
  public generateMomentumQueue(
    candidates: Track[],
    rawContext: SessionMomentumContext,
    options?: EchoBrainOptions,
  ): Track[] {
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now()
    this.telemetry.momentumEvaluations++

    const windowSize = options?.momentumWindowSize ?? 5
    const targetSize = options?.targetQueueSize ?? 10

    const momentum = this.analyzeMomentum(rawContext.recentSignals, windowSize)
    this.telemetry.lastMomentumState = momentum

    if (momentum === 'restless') {
      this.telemetry.recoveryTriggers++
    }

    const scored = this.scoreCandidates(candidates, rawContext, momentum)
    const selected = scored.slice(0, targetSize).map((s) => s.track)

    const duration = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start
    this.telemetry.lastDurationMs = duration
    this.telemetry.lastGeneratedCount = selected.length

    return selected
  }

  /**
   * Injects momentum tracks into the provided radio/dynamic queue,
   * guaranteeing that user-queued (upNext) tracks are NEVER overwritten.
   */
  public injectMomentumTracks(
    existingUpNext: Track[],
    existingRadioQueue: Track[],
    momentumTracks: Track[],
    targetMax = 10,
  ): Track[] {
    const existingIds = new Set<string>()
    for (const t of existingUpNext) existingIds.add(t.id)
    for (const t of existingRadioQueue) existingIds.add(t.id)

    const uniqueNewTracks = momentumTracks.filter((t) => !existingIds.has(t.id))
    const merged = [...existingRadioQueue, ...uniqueNewTracks].slice(0, targetMax)

    this.telemetry.momentumInjections++
    return merged
  }
}

export const echoBrainService = new EchoBrainService()
