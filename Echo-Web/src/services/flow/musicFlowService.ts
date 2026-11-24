import type { QueueSnapshot, Track } from '../../types/audio.ts'
import { AudioEngine } from '../../engine/AudioEngine.ts'
import { useEchoStore } from '../../stores/useEchoStore.ts'
import { InnerTubeClient } from '../innertube/client.ts'

export interface MusicFlowState {
  isActive: boolean
  ownershipToken: string | null
  savedSnapshot: QueueSnapshot | null
  feed: Track[]
  currentIndex: number
}

export class MusicFlowService {
  private state: MusicFlowState = {
    isActive: false,
    ownershipToken: null,
    savedSnapshot: null,
    feed: [],
    currentIndex: 0,
  }

  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<(state: MusicFlowState) => void>()

  public getState(): MusicFlowState {
    return { ...this.state }
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

  /**
   * Enters Music Flow, taking ownership of playback with a queue snapshot.
   */
  public async enterFlow(initialFeed?: Track[]): Promise<void> {
    const engine = AudioEngine.getInstance()
    // Snapshot current queue before taking over
    const snapshot = engine.snapshotQueue()
    const token = `flow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    let feed = initialFeed && initialFeed.length > 0 ? initialFeed : []
    if (feed.length === 0) {
      feed = await this.fetchDiscoveryFeed()
    }

    this.state = {
      isActive: true,
      ownershipToken: token,
      savedSnapshot: snapshot,
      feed,
      currentIndex: 0,
    }
    this.emit()

    if (feed.length > 0 && feed[0]) {
      // Handoff shared player to flow feed
      useEchoStore.getState().playQueue(feed, 0)
    }
  }

  /**
   * Exits Music Flow, optionally restoring the pre-takeover queue snapshot.
   */
  public async exitFlow(restoreQueue = true): Promise<void> {
    if (!this.state.isActive) return

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    const { savedSnapshot, ownershipToken } = this.state

    // Reset flow active state
    this.state = {
      isActive: false,
      ownershipToken: null,
      savedSnapshot: null,
      feed: [],
      currentIndex: 0,
    }
    this.emit()

    // Restore previous queue only if requested and snapshot was preserved
    if (restoreQueue && savedSnapshot && ownershipToken) {
      const engine = AudioEngine.getInstance()
      await engine.restoreQueue(savedSnapshot, true)
    }
  }

  /**
   * Selects a track in the flow feed with swipe debouncing (~280ms)
   * to prevent audio deck thrashing during rapid vertical navigation.
   */
  public selectTrack(index: number, debounceMs = 280): void {
    if (!this.state.isActive || index < 0 || index >= this.state.feed.length) return

    this.state.currentIndex = index
    this.emit()

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      const track = this.state.feed[index]
      if (track) {
        useEchoStore.getState().playTrack(track)
      }
      // If approaching end of feed, fetch more tracks
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
   * Aggregates personalized and trending tracks for the flow feed.
   */
  public async fetchDiscoveryFeed(): Promise<Track[]> {
    try {
      const result = await InnerTubeClient.search('top hits trending songs', 'songs')
      if (result.tracks && result.tracks.length > 0) {
        return result.tracks
      }
    } catch {
      // Non-fatal fallback
    }

    const cachedTracks = Object.values(useEchoStore.getState().trackCache)
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
    try {
      const current = this.state.feed[this.state.currentIndex]
      if (!current) return
      const query = `${current.artistName} music hits`
      const res = await InnerTubeClient.search(query, 'songs')
      if (res.tracks && res.tracks.length > 0) {
        const existingIds = new Set(this.state.feed.map((t) => t.id))
        const novel = res.tracks.filter((t) => !existingIds.has(t.id))
        if (novel.length > 0) {
          this.state.feed = [...this.state.feed, ...novel]
          this.emit()
        }
      }
    } catch {
      // Non-fatal
    }
  }
}

export const musicFlowService = new MusicFlowService()
