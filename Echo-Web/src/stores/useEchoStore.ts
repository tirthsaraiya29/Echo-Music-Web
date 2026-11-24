import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { z } from 'zod'
import type {
  AccentColor,
  Playlist,
  RecentlyPlayedItem,
  Track,
  UserPreferences,
} from '../types/domain.ts'
import { uniqueId } from '../utils/format.ts'
import { AudioEngine } from '../engine/AudioEngine.ts'
import { db } from '../services/db/echoDatabase.ts'

export const playlistTitleSchema = z
  .string()
  .trim()
  .min(1, 'Give your playlist a name.')
  .max(60, 'Playlist names can be up to 60 characters.')

export const playlistDescriptionSchema = z
  .string()
  .trim()
  .max(240, 'Descriptions can be up to 240 characters.')
  .default('')

export const playlistInputSchema = z.object({
  title: playlistTitleSchema,
  description: playlistDescriptionSchema,
})

export const playlistIdSchema = z.string().trim().min(1)
export const playlistCoverSchema = z.string().trim().max(2048)

export const playlistMetricsSchema = z.object({
  createdCount: z.number().nonnegative(),
  updatedCount: z.number().nonnegative(),
  deletedCount: z.number().nonnegative(),
  tracksAddedCount: z.number().nonnegative(),
  tracksRemovedCount: z.number().nonnegative(),
  tracksReorderedCount: z.number().nonnegative(),
  coversUpdatedCount: z.number().nonnegative(),
})

export type PlaylistMetrics = z.infer<typeof playlistMetricsSchema>

const playlistMetrics: PlaylistMetrics = {
  createdCount: 0,
  updatedCount: 0,
  deletedCount: 0,
  tracksAddedCount: 0,
  tracksRemovedCount: 0,
  tracksReorderedCount: 0,
  coversUpdatedCount: 0,
}

export function getPlaylistMetrics(): PlaylistMetrics {
  return { ...playlistMetrics }
}

export function resetPlaylistMetrics(): void {
  playlistMetrics.createdCount = 0
  playlistMetrics.updatedCount = 0
  playlistMetrics.deletedCount = 0
  playlistMetrics.tracksAddedCount = 0
  playlistMetrics.tracksRemovedCount = 0
  playlistMetrics.tracksReorderedCount = 0
  playlistMetrics.coversUpdatedCount = 0
}

const playlistSchema = playlistInputSchema

const defaultPreferences: UserPreferences = {
  themeMode: 'dark',
  accentColor: 'violet',
  volume: 68,
  muted: false,
  shuffle: false,
  repeat: 'off',
  showExplicit: true,
  volumeNormalization: false,
  audioQuality: 'high',
  smoothScrolling: true,
  compactLists: false,
  lastPlayedLayout: 'grid',
  contentRegion: 'US',
  crossfadeDuration: 3,
  preferredLyricsProvider: 'LRCLIB',
  dataSaver: false,
  discordRpc: false,
  discordBridgeUrl: 'http://127.0.0.1:6463',
  discordMode: 'auto',
}

// In-memory catalog cache for fast synchronous lookup by track ID
const trackCacheMap = new Map<string, Track>()

export function cacheTrack(track: Track): void {
  trackCacheMap.set(track.id, track)
  if (track.videoId) {
    trackCacheMap.set(track.videoId, track)
  }
}

export function cacheTracks(tracks: Track[]): void {
  for (const track of tracks) {
    cacheTrack(track)
  }
}

export function getCachedTrack(id: string): Track | undefined {
  return trackCacheMap.get(id)
}

type EchoState = {
  playlists: Playlist[]
  savedPlaylistIds: string[]
  likedTrackIds: string[]
  likedAlbumIds: string[]
  followedArtistIds: string[]
  queueIds: string[]
  currentTrackId: string
  currentTrack: Track | null
  isPlaying: boolean
  progressMs: number
  recentlyPlayedIds: string[]
  recentItems: RecentlyPlayedItem[]
  preferences: UserPreferences
  toast: string
  trackCache: Record<string, Track>
  cacheTrack: (track: Track) => void
  cacheTracks: (tracks: Track[]) => void
  getTrack: (id: string) => Track | undefined
  toggleTrackLike: (trackOrId: Track | string) => void
  toggleAlbumLike: (id: string) => void
  toggleArtistFollow: (id: string) => void
  createPlaylist: (title: string, description?: string) => string
  updatePlaylist: (id: string, title: string, description: string) => void
  deletePlaylist: (id: string) => void
  togglePlaylistLike: (id: string) => void
  addTrackToPlaylist: (playlistId: string, trackOrId: Track | string) => void
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void
  reorderPlaylistTrack: (playlistId: string, from: number, to: number) => void
  setPlaylistCover: (playlistId: string, coverUrl?: string) => void
  playTrack: (trackOrId: Track | string) => void
  playQueue: (tracks: Track[], startIndex?: number) => void
  togglePlayback: () => void
  nextTrack: () => void
  previousTrack: () => void
  seek: (progressMs: number) => void
  enqueue: (trackOrId: Track | string) => void
  removeFromQueue: (index: number) => void
  moveQueueItem: (from: number, to: number) => void
  clearQueue: () => void
  clearRecentHistory: () => void
  recordMedia: (item: Omit<RecentlyPlayedItem, 'at'>) => void
  setPreference: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void
  setToast: (message: string) => void
  clearToast: () => void
}

function addRecentlyPlayed(ids: string[], id: string) {
  return [id, ...ids.filter((item) => item !== id)].slice(0, 30)
}

function parsePlaylistInput(title: string, description: string) {
  const parsed = playlistSchema.safeParse({ title, description })
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Playlist details are invalid.')
  }
  return parsed.data
}

export const useEchoStore = create<EchoState>()(
  persist(
    (set, get) => ({
      playlists: [],
      savedPlaylistIds: [],
      likedTrackIds: [],
      likedAlbumIds: [],
      followedArtistIds: [],
      queueIds: [],
      currentTrackId: '',
      currentTrack: null,
      isPlaying: false,
      progressMs: 0,
      recentlyPlayedIds: [],
      recentItems: [],
      preferences: defaultPreferences,
      toast: '',
      trackCache: {},

      cacheTrack: (track: Track) => {
        cacheTrack(track)
        set((state) => ({
          trackCache: {
            ...state.trackCache,
            [track.id]: track,
            ...(track.videoId ? { [track.videoId]: track } : {}),
          },
        }))
      },

      cacheTracks: (tracks: Track[]) => {
        cacheTracks(tracks)
        set((state) => {
          const updated = { ...state.trackCache }
          for (const t of tracks) {
            updated[t.id] = t
            if (t.videoId) updated[t.videoId] = t
          }
          return { trackCache: updated }
        })
      },

      getTrack: (id: string) => get().trackCache[id] || getCachedTrack(id),

      toggleTrackLike: (trackOrId) => {
        const id = typeof trackOrId === 'string' ? trackOrId : trackOrId.id
        const track =
          typeof trackOrId === 'object'
            ? trackOrId
            : get().getTrack(id) || (get().currentTrack?.id === id ? get().currentTrack : undefined)
        if (track) {
          get().cacheTrack(track)
        }
        set((state) => ({
          likedTrackIds: state.likedTrackIds.includes(id)
            ? state.likedTrackIds.filter((tId) => tId !== id)
            : [id, ...state.likedTrackIds],
        }))
      },

      toggleAlbumLike: (id) =>
        set((state) => ({
          likedAlbumIds: state.likedAlbumIds.includes(id)
            ? state.likedAlbumIds.filter((albumId) => albumId !== id)
            : [id, ...state.likedAlbumIds],
        })),

      toggleArtistFollow: (id) =>
        set((state) => ({
          followedArtistIds: state.followedArtistIds.includes(id)
            ? state.followedArtistIds.filter((artistId) => artistId !== id)
            : [id, ...state.followedArtistIds],
        })),

      createPlaylist: (title, description = '') => {
        const valid = parsePlaylistInput(title, description)
        const id = uniqueId('playlist')
        const playlist: Playlist = {
          id,
          title: valid.title,
          description: valid.description,
          owner: 'You',
          image: '',
          trackIds: [],
          curated: false,
          createdAt: Date.now(),
        }
        playlistMetrics.createdCount++
        set((state) => ({ playlists: [playlist, ...state.playlists] }))
        if (typeof indexedDB !== 'undefined') {
          db.playlists
            .put({
              id,
              title: playlist.title,
              description: playlist.description,
              trackIds: [],
              createdAt: playlist.createdAt,
              updatedAt: playlist.createdAt,
            })
            .catch(() => {})
        }
        return id
      },

      updatePlaylist: (id, title, description) => {
        const idParsed = playlistIdSchema.safeParse(id)
        if (!idParsed.success) return
        const valid = parsePlaylistInput(title, description)
        playlistMetrics.updatedCount++
        set((state) => ({
          playlists: state.playlists.map((playlist) =>
            playlist.id === id
              ? { ...playlist, title: valid.title, description: valid.description }
              : playlist,
          ),
        }))
        if (typeof indexedDB !== 'undefined') {
          db.playlists
            .update(id, {
              title: valid.title,
              description: valid.description,
              updatedAt: Date.now(),
            })
            .catch(() => {})
        }
      },

      deletePlaylist: (id) => {
        const idParsed = playlistIdSchema.safeParse(id)
        if (!idParsed.success) return
        playlistMetrics.deletedCount++
        set((state) => ({
          playlists: state.playlists.filter((playlist) => playlist.id !== id),
          savedPlaylistIds: state.savedPlaylistIds.filter((savedId) => savedId !== id),
        }))
        if (typeof indexedDB !== 'undefined') {
          db.playlists.delete(id).catch(() => {})
        }
      },

      togglePlaylistLike: (id) =>
        set((state) => ({
          savedPlaylistIds: state.savedPlaylistIds.includes(id)
            ? state.savedPlaylistIds.filter((savedId) => savedId !== id)
            : [id, ...state.savedPlaylistIds],
        })),

      addTrackToPlaylist: (playlistId, trackOrId) => {
        const idParsed = playlistIdSchema.safeParse(playlistId)
        if (!idParsed.success) return
        const validPlaylistId = idParsed.data

        const trackId = typeof trackOrId === 'string' ? trackOrId : trackOrId?.id
        if (!trackId || typeof trackId !== 'string') return

        const track =
          typeof trackOrId === 'object'
            ? trackOrId
            : get().getTrack(trackId) ||
              (get().currentTrack?.id === trackId ? get().currentTrack : undefined)
        if (track) {
          get().cacheTrack(track)
        }
        set((state) => {
          const currentPlaylist = state.playlists.find((p) => p.id === validPlaylistId)
          if (!currentPlaylist || currentPlaylist.trackIds.includes(trackId)) {
            return state
          }
          playlistMetrics.tracksAddedCount++
          const updatedPlaylists = state.playlists.map((playlist) =>
            playlist.id === validPlaylistId
              ? {
                  ...playlist,
                  trackIds: [...playlist.trackIds, trackId],
                  image:
                    playlist.image ||
                    (track?.artwork ?? getCachedTrack(trackId)?.artwork ?? playlist.image),
                }
              : playlist,
          )
          const target = updatedPlaylists.find((p) => p.id === validPlaylistId)
          if (target && typeof indexedDB !== 'undefined') {
            db.playlists
              .update(validPlaylistId, {
                trackIds: target.trackIds,
                coverUrl: target.image || undefined,
                updatedAt: Date.now(),
              })
              .catch(() => {})
          }
          return { playlists: updatedPlaylists }
        })
      },

      removeTrackFromPlaylist: (playlistId, trackId) => {
        const idParsed = playlistIdSchema.safeParse(playlistId)
        if (!idParsed.success) return
        const validPlaylistId = idParsed.data

        set((state) => {
          const currentPlaylist = state.playlists.find((p) => p.id === validPlaylistId)
          if (!currentPlaylist || !currentPlaylist.trackIds.includes(trackId)) {
            return state
          }
          playlistMetrics.tracksRemovedCount++
          const updatedPlaylists = state.playlists.map((playlist) =>
            playlist.id === validPlaylistId
              ? { ...playlist, trackIds: playlist.trackIds.filter((id) => id !== trackId) }
              : playlist,
          )
          const target = updatedPlaylists.find((p) => p.id === validPlaylistId)
          if (target && typeof indexedDB !== 'undefined') {
            db.playlists
              .update(validPlaylistId, {
                trackIds: target.trackIds,
                updatedAt: Date.now(),
              })
              .catch(() => {})
          }
          return { playlists: updatedPlaylists }
        })
      },

      reorderPlaylistTrack: (playlistId, from, to) => {
        if (from === to) return
        const idParsed = playlistIdSchema.safeParse(playlistId)
        if (!idParsed.success) return
        const validPlaylistId = idParsed.data

        set((state) => {
          const currentPlaylist = state.playlists.find((p) => p.id === validPlaylistId)
          if (!currentPlaylist) return state
          const trackIds = [...currentPlaylist.trackIds]
          if (from < 0 || to < 0 || from >= trackIds.length || to >= trackIds.length) {
            return state
          }
          const [moved] = trackIds.splice(from, 1)
          if (!moved) return state
          trackIds.splice(to, 0, moved)
          playlistMetrics.tracksReorderedCount++

          const updatedPlaylists = state.playlists.map((playlist) =>
            playlist.id === validPlaylistId ? { ...playlist, trackIds } : playlist,
          )
          if (typeof indexedDB !== 'undefined') {
            db.playlists
              .update(validPlaylistId, {
                trackIds,
                updatedAt: Date.now(),
              })
              .catch(() => {})
          }
          return { playlists: updatedPlaylists }
        })
      },

      setPlaylistCover: (playlistId, coverUrl) => {
        const idParsed = playlistIdSchema.safeParse(playlistId)
        if (!idParsed.success) return
        const validPlaylistId = idParsed.data
        const validCover = typeof coverUrl === 'string' ? coverUrl.trim() : ''
        playlistMetrics.coversUpdatedCount++
        set((state) => {
          const updatedPlaylists = state.playlists.map((playlist) =>
            playlist.id === validPlaylistId ? { ...playlist, image: validCover } : playlist,
          )
          if (typeof indexedDB !== 'undefined') {
            db.playlists
              .update(validPlaylistId, {
                coverUrl: validCover || undefined,
                updatedAt: Date.now(),
              })
              .catch(() => {})
          }
          return { playlists: updatedPlaylists }
        })
      },

      playTrack: (trackOrId) => {
        let track: Track | undefined
        let id: string

        if (typeof trackOrId === 'string') {
          id = trackOrId
          track =
            get().getTrack(id) || (get().currentTrack?.id === id ? get().currentTrack! : undefined)
          // No synthetic placeholder: if metadata is unknown, the track resolves asynchronously
          // (resolveMissingTrack) or the engine reports its real title/duration on load.
        } else {
          track = trackOrId
          id = track.id
          get().cacheTrack(track)
        }

        const selectedTrack = track
        set((state) => ({
          currentTrackId: id,
          currentTrack: selectedTrack ?? null,
          isPlaying: true,
          progressMs: 0,
          recentlyPlayedIds: addRecentlyPlayed(state.recentlyPlayedIds, id),
          trackCache: selectedTrack
            ? {
                ...state.trackCache,
                [selectedTrack.id]: selectedTrack,
                ...(selectedTrack.videoId ? { [selectedTrack.videoId]: selectedTrack } : {}),
              }
            : state.trackCache,
        }))

        if (selectedTrack) {
          get().recordMedia({
            id: selectedTrack.id,
            kind: 'track',
            title: selectedTrack.title,
            subtitle: selectedTrack.artistName,
            image: selectedTrack.artwork || selectedTrack.thumbnailUrl || '',
          })

          void AudioEngine.getInstance().play(selectedTrack)
        }
      },

      playQueue: (tracks, startIndex = 0) => {
        if (!tracks || tracks.length === 0) return
        get().cacheTracks(tracks)
        const activeTrack = tracks[startIndex] || tracks[0]!
        set((state) => ({
          currentTrackId: activeTrack.id,
          currentTrack: activeTrack,
          isPlaying: true,
          progressMs: 0,
          recentlyPlayedIds: addRecentlyPlayed(state.recentlyPlayedIds, activeTrack.id),
        }))

        AudioEngine.getInstance().playQueue(tracks, startIndex)
      },

      togglePlayback: () => {
        // The engine is the source of truth for playback state; the bridge subscriber
        // (bridgeAudioEngineWithStore) projects isPlaying back into this store. Flipping it
        // optimistically here desynced the UI whenever the engine failed to start playback.
        void AudioEngine.getInstance().togglePlayback()
      },

      nextTrack: () => {
        void AudioEngine.getInstance().next()
      },

      previousTrack: () => {
        void AudioEngine.getInstance().previous()
      },

      seek: (progressMs) => {
        AudioEngine.getInstance().seek(progressMs / 1000)
        set((state) => ({
          progressMs: Math.max(0, Math.min(progressMs, state.currentTrack?.durationMs ?? 0)),
        }))
      },

      enqueue: (trackOrId) => {
        let track: Track | undefined
        if (typeof trackOrId === 'string') {
          track = get().getTrack(trackOrId)
          if (!track) return
        } else {
          track = trackOrId
          get().cacheTrack(track)
        }

        const engine = AudioEngine.getInstance()
        engine.addToQueue(track)
        set({ queueIds: engine.getState().upNext.map((t) => t.id) })
      },

      removeFromQueue: (index) => {
        const engine = AudioEngine.getInstance()
        engine.removeFromQueue(index)
        set({ queueIds: engine.getState().upNext.map((t) => t.id) })
      },

      moveQueueItem: (from, to) => {
        const engine = AudioEngine.getInstance()
        engine.moveQueueItem(from, to)
        set({ queueIds: engine.getState().upNext.map((t) => t.id) })
      },

      clearQueue: () => {
        const engine = AudioEngine.getInstance()
        engine.clearQueue()
        set({ queueIds: [] })
      },

      clearRecentHistory: () => {
        set({
          recentlyPlayedIds: [],
          recentItems: [],
        })
      },

      recordMedia: (item) =>
        set((state) => ({
          recentItems: [
            { ...item, at: Date.now() },
            ...state.recentItems.filter(
              (recent) => `${recent.kind}:${recent.id}` !== `${item.kind}:${item.id}`,
            ),
          ].slice(0, 40),
        })),

      setPreference: (key, value) => {
        const engine = AudioEngine.getInstance()
        if (key === 'volume' && typeof value === 'number') {
          engine.setVolume(value / 100)
        } else if (key === 'muted' && typeof value === 'boolean') {
          engine.setMuted(value)
        } else if (key === 'shuffle' && typeof value === 'boolean') {
          engine.setShuffle(value)
        } else if (key === 'repeat' && typeof value === 'string') {
          engine.setRepeatMode(value === 'all' ? 'ALL' : value === 'one' ? 'ONE' : 'OFF')
        } else if (key === 'volumeNormalization' && typeof value === 'boolean') {
          engine.setVolumeNormalization(value)
        }
        set((state) => ({
          preferences: { ...state.preferences, [key]: value },
        }))
      },

      setToast: (message) => set({ toast: message }),
      clearToast: () => set({ toast: '' }),
    }),
    {
      name: 'echo-web-state-v2',
      storage: createJSONStorage(() => {
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            return window.localStorage
          }
          if (typeof localStorage !== 'undefined') {
            localStorage.getItem('__echo_storage_test')
            return localStorage
          }
        } catch {
          // Node without --localstorage-file or restricted environment
        }
        const mem = new Map<string, string>()
        return {
          getItem: (key: string) => mem.get(key) ?? null,
          setItem: (key: string, val: string) => {
            mem.set(key, String(val))
          },
          removeItem: (key: string) => {
            mem.delete(key)
          },
        }
      }),
      partialize: (state) => {
        // Collect IDs of essential tracks that must be preserved
        const essentialIds = new Set<string>([
          ...state.likedTrackIds,
          ...state.queueIds,
          ...state.recentlyPlayedIds,
          ...state.playlists.flatMap((p) => p.trackIds),
          ...(state.currentTrackId ? [state.currentTrackId] : []),
        ])

        const prunedCache: Record<string, Track> = {}
        let prunedCount = 0
        for (const [id, track] of Object.entries(state.trackCache)) {
          if (essentialIds.has(id) || (track.videoId && essentialIds.has(track.videoId))) {
            prunedCache[id] = track
            prunedCount++
          }
        }

        // Keep up to 200 recent cached tracks
        if (prunedCount < 200) {
          for (const [id, track] of Object.entries(state.trackCache)) {
            if (!prunedCache[id]) {
              prunedCache[id] = track
              prunedCount++
              if (prunedCount >= 200) break
            }
          }
        }

        return {
          playlists: state.playlists,
          savedPlaylistIds: state.savedPlaylistIds,
          likedTrackIds: state.likedTrackIds,
          likedAlbumIds: state.likedAlbumIds,
          followedArtistIds: state.followedArtistIds,
          queueIds: state.queueIds,
          currentTrackId: state.currentTrackId,
          recentlyPlayedIds: state.recentlyPlayedIds,
          recentItems: state.recentItems,
          preferences: state.preferences,
          trackCache: prunedCache,
        }
      },
      merge: (persisted, current) => {
        const saved = persisted as Partial<EchoState>
        const validAccent: AccentColor[] = ['violet', 'emerald', 'amber', 'rose', 'sky']
        const savedPreferences = saved.preferences
        const restoredCache = saved.trackCache ?? {}
        for (const track of Object.values(restoredCache)) {
          if (track && track.id) {
            cacheTrack(track)
          }
        }
        return {
          ...current,
          ...saved,
          trackCache: restoredCache,
          playlists: saved.playlists ?? [],
          savedPlaylistIds: saved.savedPlaylistIds ?? [],
          likedTrackIds: saved.likedTrackIds ?? [],
          likedAlbumIds: saved.likedAlbumIds ?? [],
          followedArtistIds: saved.followedArtistIds ?? [],
          queueIds: saved.queueIds ?? [],
          recentlyPlayedIds: saved.recentlyPlayedIds ?? [],
          recentItems: saved.recentItems ?? [],
          currentTrackId: saved.currentTrackId || '',
          isPlaying: false,
          progressMs: 0,
          toast: '',
          preferences: {
            ...defaultPreferences,
            ...savedPreferences,
            accentColor: validAccent.includes(savedPreferences?.accentColor ?? 'violet')
              ? (savedPreferences?.accentColor ?? 'violet')
              : 'violet',
          },
        }
      },
    },
  ),
)

export const getTrackById = (id: string) => getCachedTrack(id)
export const getAlbumById = (_id: string) => undefined
export const getArtistById = (_id: string) => undefined
