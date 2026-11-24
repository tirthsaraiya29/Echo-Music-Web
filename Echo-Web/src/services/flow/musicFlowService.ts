import type { Track } from '../../types/audio.ts'
import type { MusicFlowState, MusicFlowTelemetry } from '../../types/flow.ts'
import { AudioEngine } from '../../engine/AudioEngine.ts'
import { useEchoStore } from '../../stores/useEchoStore.ts'
import { InnerTubeClient } from '../innertube/client.ts'

export class MusicFlowService {
  private static instance: MusicFlowService | null = null

  private state: MusicFlowState = {
    isActive: false,
    isLoading: false,
    handoffStatus: 'idle',
    ownershipToken: null,
    savedSnapshot: null,
    feed: [],
    currentIndex: 0,
    telemetry: {
      swipesCount: 0,
      tracksListenedCount: 0,
      likesCount: 0,
      skipsCount: 0,
      feedsGeneratedCount: 0,
      restoresSucceededCount: 0,
      restoresBlockedCount: 0,
      mixesKeptCount: 0,
      lastSwipeDirection: null,
      lastSwipeTimestamp: null,
    },
  }

  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<(state: MusicFlowState) => void>()
  private isFetchingMore = false

  public constructor() {}

  public static getInstance(): MusicFlowService {
    if (!MusicFlowService.instance) {
      MusicFlowService.instance = new MusicFlowService()
    }
    return MusicFlowService.instance
  }

  public getState(): MusicFlowState {
    return {
      ...this.state,
      telemetry: { ...this.state.telemetry },
      feed: [...this.state.feed],
    }
  }

  public subscribe(listener: (state: MusicFlowState) => void): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    const s = this.getState()
    for (const listener of this.listeners) {
      listener(s)
    }
  }

  public getTelemetry(): Readonly<MusicFlowTelemetry> {
    return { ...this.state.telemetry }
  }

  public resetTelemetry(): void {
    this.state.telemetry = {
      swipesCount: 0,
      tracksListenedCount: 0,
      likesCount: 0,
      skipsCount: 0,
      feedsGeneratedCount: 0,
      restoresSucceededCount: 0,
      restoresBlockedCount: 0,
      mixesKeptCount: 0,
      lastSwipeDirection: null,
      lastSwipeTimestamp: null,
    }
    this.emit()
  }

  public recordLike(): void {
    this.state.telemetry.likesCount++
    this.emit()
  }

  /**
   * Enters Music Flow, taking ownership of playback with a queue snapshot.
   */
  public async enterFlow(initialFeed?: Track[]): Promise<void> {
    const engine = AudioEngine.getInstance()
    const token = `flow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // Snapshot current queue before taking over, bound to ownership token
    const snapshot = engine.snapshotQueue('music-flow', token)
    engine.takeQueueOwnership('music-flow', token)

    this.state.isActive = true
    this.state.isLoading = true
    this.state.handoffStatus = 'active'
    this.state.ownershipToken = token
    this.state.savedSnapshot = snapshot
    this.state.currentIndex = 0
    this.emit()

    let feed = initialFeed && initialFeed.length > 0 ? initialFeed : []
    if (feed.length === 0) {
      feed = await this.fetchDiscoveryFeed()
    }

    this.state.isLoading = false
    this.state.feed = feed
    this.state.telemetry.feedsGeneratedCount++
    this.emit()

    if (feed.length > 0 && feed[0]) {
      this.state.telemetry.tracksListenedCount++
      try {
        useEchoStore.getState().playQueue(feed, 0)
      } catch {
        // Non-fatal playback startup in testing environments
      }
    }
  }

  /**
   * Exits Music Flow, checking ownership lease token validity.
   * If restoreQueue is requested:
   *  - Restores previous queue only if ownership remained valid without external mutations.
   *  - If ownership was revoked (e.g. user manually queued tracks during flow), preserves current queue.
   */
  public async exitFlow(restoreQueue = true): Promise<boolean> {
    if (!this.state.isActive) return false

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    const { savedSnapshot, ownershipToken } = this.state
    const engine = AudioEngine.getInstance()

    this.state.isActive = false
    this.state.isLoading = false

    if (!restoreQueue) {
      this.state.handoffStatus = 'kept'
      this.state.telemetry.mixesKeptCount++
      if (ownershipToken) {
        engine.revokeQueueOwnership('USER_KEPT_MIX')
      }
      this.state.ownershipToken = null
      this.state.savedSnapshot = null
      this.state.feed = []
      this.state.currentIndex = 0
      this.emit()
      useEchoStore.getState().setToast('Flow mix kept in active queue')
      return true
    }

    if (savedSnapshot && ownershipToken) {
      const isOwnerValid = engine.isQueueOwnershipValid(ownershipToken)
      if (!isOwnerValid) {
        // Ownership was revoked during session
        this.state.handoffStatus = 'revoked'
        this.state.telemetry.restoresBlockedCount++
        this.state.ownershipToken = null
        this.state.savedSnapshot = null
        this.state.feed = []
        this.state.currentIndex = 0
        this.emit()
        useEchoStore.getState().setToast(
          'Queue was modified externally; preserving your current queue',
        )
        return false
      }

      // Valid ownership lease: perform restore
      const restored = await engine.restoreQueue(savedSnapshot, true, {
        ownerToken: ownershipToken,
      })
      engine.revokeQueueOwnership('FLOW_EXIT')

      if (restored) {
        this.state.handoffStatus = 'restored'
        this.state.telemetry.restoresSucceededCount++
        useEchoStore.getState().setToast('Restored previous queue')
      } else {
        this.state.handoffStatus = 'revoked'
        this.state.telemetry.restoresBlockedCount++
      }

      this.state.ownershipToken = null
      this.state.savedSnapshot = null
      this.state.feed = []
      this.state.currentIndex = 0
      this.emit()
      return restored
    }

    this.state.handoffStatus = 'idle'
    this.state.ownershipToken = null
    this.state.savedSnapshot = null
    this.state.feed = []
    this.state.currentIndex = 0
    this.emit()
    return true
  }

  /**
   * Selects a track in the flow feed with swipe debouncing (~280ms)
   * to prevent audio deck thrashing during rapid vertical navigation.
   */
  public selectTrack(index: number, debounceMs = 280): void {
    if (!this.state.isActive || index < 0 || index >= this.state.feed.length) return

    const direction: 'up' | 'down' = index > this.state.currentIndex ? 'up' : 'down'
    this.state.telemetry.swipesCount++
    this.state.telemetry.lastSwipeDirection = direction
    this.state.telemetry.lastSwipeTimestamp = Date.now()

    if (index > this.state.currentIndex) {
      this.state.telemetry.skipsCount++
    }

    this.state.currentIndex = index
    this.emit()

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      const track = this.state.feed[index]
      if (track) {
        this.state.telemetry.tracksListenedCount++
        useEchoStore.getState().playTrack(track)
      }
      if (index >= this.state.feed.length - 3) {
        void this.appendMoreFeed()
      }
    }, debounceMs)
  }

  public nextTrack(): void {
    if (this.state.currentIndex < this.state.feed.length - 1) {
      this.selectTrack(this.state.currentIndex + 1)
    }
  }

  public prevTrack(): void {
    if (this.state.currentIndex > 0) {
      this.selectTrack(this.state.currentIndex - 1)
    }
  }

  /**
   * Aggregates personalized and trending tracks for the discovery reel.
   */
  public async fetchDiscoveryFeed(): Promise<Track[]> {
    const cachedTracks = Object.values(useEchoStore.getState().trackCache)

    try {
      const result = await InnerTubeClient.search('trending hits global songs', 'songs')
      if (result.tracks && result.tracks.length > 0) {
        if (cachedTracks.length > 0) {
          const combined: Track[] = []
          const maxLen = Math.max(result.tracks.length, cachedTracks.length)
          for (let i = 0; i < maxLen; i++) {
            if (i < result.tracks.length && result.tracks[i]) combined.push(result.tracks[i]!)
            if (i < cachedTracks.length && cachedTracks[i] && i % 2 === 0) combined.push(cachedTracks[i]!)
          }
          const unique = new Map<string, Track>()
          for (const t of combined) unique.set(t.id, t)
          return Array.from(unique.values())
        }
        return result.tracks
      }
    } catch {
      // Fallback
    }

    if (cachedTracks.length > 0) {
      return cachedTracks
    }
    const current = useEchoStore.getState().currentTrack
    if (current) {
      return [current]
    }
    return []
  }

  private async appendMoreFeed(): Promise<void> {
    if (this.isFetchingMore) return
    this.isFetchingMore = true
    try {
      const current = this.state.feed[this.state.currentIndex]
      if (!current) return
      const query = `${current.artistName} music hits`
      const res = await InnerTubeClient.search(query, 'songs')
      if (res.tracks && res.tracks.length > 0) {
        const existingIds = new Set(this.state.feed.map((t) => t.id))
        const novel = res.tracks.filter((t: Track) => !existingIds.has(t.id))
        if (novel.length > 0) {
          this.state.feed = [...this.state.feed, ...novel]
          this.emit()
        }
      }
    } catch {
      // Non-fatal
    } finally {
      this.isFetchingMore = false
    }
  }
}

export const musicFlowService = MusicFlowService.getInstance()
