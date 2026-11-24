export interface Artist {
  id: string
  name: string
  image: string
  thumbnailUrl?: string | undefined
  verified?: boolean | undefined
  monthlyListeners?: number | undefined
  subscribers?: string | undefined
  bio?: string | undefined
  genres?: string[] | undefined
}

export interface Album {
  id: string
  title: string
  image: string
  artistName: string
  artistId: string
  year?: number | undefined
  trackCount?: number | undefined
  durationMs?: number | undefined
  type?: ('album' | 'single' | 'ep') | undefined
  genres?: string[] | undefined
  thumbnailUrl?: string | undefined
  artists?: Artist[] | undefined
  durationText?: string | undefined
}

export interface PlaylistSummary {
  id: string
  title: string
  image: string
  thumbnailUrl?: string | undefined
  trackCount?: number | undefined
  author?: string | undefined
  description?: string | undefined
}

export interface Track {
  id: string
  title: string
  artistId: string
  artistName: string
  albumId: string
  albumTitle: string
  albumImage: string
  durationMs: number
  artwork: string
  explicit: boolean
  playCount: number
  description?: string | undefined

  videoId?: string | undefined
  streamUrl?: string | undefined
  artists?: Artist[] | undefined
  album?: { id: string; title: string } | undefined
  durationSeconds?: number | undefined
  thumbnailUrl?: string | undefined
  isExplicit?: boolean | undefined
  sponsorBlockSegments?: Array<{ start: number; end: number }> | undefined
  isrc?: string | undefined
  cleanTitle?: string | undefined
  // True when metadata could not be resolved and the title/artist are honest placeholders
  unresolved?: boolean | undefined
  isPodcast?: boolean | undefined
  podcastShowId?: string | undefined
  episodeNumber?: number | undefined
  publishedAt?: string | undefined
}

export interface PodcastEpisode extends Track {
  isPodcast: true
  podcastShowId?: string | undefined
  showTitle?: string | undefined
  publishedAt?: string | undefined
}

export interface PodcastShow {
  id: string
  title: string
  author: string
  description?: string | undefined
  artworkUrl: string
  episodeCount?: number | undefined
  isFollowed?: boolean | undefined
}

export interface HomeShelf {
  title: string
  items: Array<Track | Album | PlaylistSummary>
}

export type MediaKind = 'track' | 'album' | 'artist' | 'playlist'

export interface Playlist {
  id: string
  title: string
  description: string
  owner: string
  image: string
  trackIds: string[]
  curated: boolean
  createdAt: number
}

export interface RecentlyPlayedItem {
  id: string
  kind: MediaKind
  title: string
  subtitle: string
  image: string
  at: number
}

export type ThemeMode = 'light' | 'dark' | 'system'
export type AccentColor = 'violet' | 'emerald' | 'amber' | 'rose' | 'sky'
export type AudioQuality = 'low' | 'medium' | 'high' | 'lossless'
export type CrossfadeProfile = 'equalPower' | 'linear' | 'logarithmic' | 'scurve'

export interface UserPreferences {
  themeMode: ThemeMode
  accentColor: AccentColor
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: 'off' | 'all' | 'one'
  showExplicit: boolean
  volumeNormalization: boolean
  gaplessPlayback?: boolean | undefined
  audioQuality: AudioQuality
  audioQualityWifi?: AudioQuality | undefined
  audioQualityCellular?: AudioQuality | undefined
  smoothScrolling: boolean
  compactLists: boolean
  lastPlayedLayout: 'grid' | 'list'
  contentRegion?: string | undefined
  crossfadeDuration?: number | undefined
  crossfadeProfile?: CrossfadeProfile | undefined
  echoBrainEnabled?: boolean | undefined
  echoBrainAutoInject?: boolean | undefined
  varispeedEnabled?: boolean | undefined
  pauseOnMute?: boolean | undefined
  bluetoothResumeEnabled?: boolean | undefined
  preferredLyricsProvider?: 'LRCLIB' | 'BETTER_LYRICS' | 'KUGOU' | undefined
  defaultTab?: 'home' | 'search' | 'library' | 'discover' | 'settings' | undefined
  dataSaver?: boolean | undefined
  romanizeLyrics?: boolean | undefined
  lastfmSession?: { sessionKey: string; username: string } | undefined
  lastfmScrobbling?: boolean | undefined
  discordRpc?: boolean | undefined
  discordBridgeUrl?: string | undefined
  discordMode?: 'auto' | 'companion' | 'backend' | undefined
  skipSilence?: boolean | undefined
  googleCast?: boolean | undefined
  preferExtensionAudio?: boolean | undefined
  extensionSourcePriority?: 'extension-first' | 'youtube-first' | undefined
}
