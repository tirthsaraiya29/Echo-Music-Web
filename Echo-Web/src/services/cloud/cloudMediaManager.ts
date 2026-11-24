import type { Track } from '../../types/domain.ts'
import type { CloudServerConfig, CloudProviderType } from './cloudMediaTypes.ts'

const STORAGE_KEY = 'echo_cloud_servers_v1'

export class CloudMediaManager {
  private servers: CloudServerConfig[] = []
  private listeners = new Set<(servers: CloudServerConfig[]) => void>()

  constructor() {
    this.load()
  }

  private load(): void {
    if (typeof localStorage === 'undefined') return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        this.servers = JSON.parse(raw) as CloudServerConfig[]
      }
    } catch {
      this.servers = []
    }
  }

  private save(): void {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.servers))
      } catch {
        // Storage unavailable
      }
    }
    for (const listener of this.listeners) {
      listener(this.getServers())
    }
  }

  public subscribe(listener: (servers: CloudServerConfig[]) => void): () => void {
    this.listeners.add(listener)
    listener(this.getServers())
    return () => {
      this.listeners.delete(listener)
    }
  }

  public getServers(): CloudServerConfig[] {
    return [...this.servers]
  }

  public getServer(id: string): CloudServerConfig | undefined {
    return this.servers.find((s) => s.id === id)
  }

  public addServer(config: Omit<CloudServerConfig, 'id' | 'createdAt'>): CloudServerConfig {
    const id = `cloud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const server: CloudServerConfig = {
      ...config,
      id,
      createdAt: Date.now(),
    }
    this.servers.push(server)
    this.save()
    return server
  }

  public removeServer(id: string): void {
    this.servers = this.servers.filter((s) => s.id !== id)
    this.save()
  }

  /**
   * Tests connection to a remote cloud server via backend proxy.
   */
  public async testConnection(payload: {
    type: CloudProviderType
    serverUrl: string
    username?: string | undefined
    password?: string | undefined
  }): Promise<{
    success: boolean
    serverName?: string
    token?: string
    userId?: string
    salt?: string
    error?: string
  }> {
    const res = await fetch('/api/cloud/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Connection failed' }))
      return { success: false, error: (err as { error?: string }).error || 'HTTP ' + res.status }
    }

    return (await res.json()) as {
      success: boolean
      serverName?: string
      token?: string
      userId?: string
      salt?: string
    }
  }

  /**
   * Converts a Jellyfin audio item into an Echo Music unified Track.
   */
  public mapJellyfinItemToTrack(
    server: CloudServerConfig,
    item: {
      Id: string
      Name: string
      Artists?: string[]
      Album?: string
      AlbumId?: string
      RunTimeTicks?: number
      AlbumArtist?: string
    },
  ): Track {
    const durationMs = item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10000) : 180000
    const artistName = item.Artists?.[0] || item.AlbumArtist || 'Unknown Artist'
    const artworkUrl = `${server.serverUrl}/Items/${item.Id}/Images/Primary?maxWidth=400`
    const streamUrl = `${server.serverUrl}/Audio/${item.Id}/stream?static=true&api_key=${encodeURIComponent(server.token || '')}`

    return {
      id: `jellyfin_${item.Id}`,
      videoId: `jellyfin_${item.Id}`,
      title: item.Name || 'Unknown Title',
      artistId: `artist_jellyfin_${artistName.toLowerCase().replace(/\s+/g, '_')}`,
      artistName,
      albumId: item.AlbumId ? `album_jellyfin_${item.AlbumId}` : 'jellyfin_album',
      albumTitle: item.Album || 'Cloud Album',
      albumImage: artworkUrl,
      artwork: artworkUrl,
      durationMs,
      durationSeconds: Math.round(durationMs / 1000),
      streamUrl,
      explicit: false,
      playCount: 1,
    }
  }

  /**
   * Converts a Subsonic / Navidrome song item into an Echo Music unified Track.
   */
  public mapSubsonicSongToTrack(
    server: CloudServerConfig,
    song: {
      id: string
      title: string
      artist: string
      artistId?: string
      album?: string
      albumId?: string
      duration?: number
      coverArt?: string
    },
  ): Track {
    const authParams = `u=${encodeURIComponent(server.username)}&t=${server.token || ''}&s=${server.salt || ''}&v=1.16.1&c=EchoMusicWeb`
    const artworkUrl = song.coverArt
      ? `${server.serverUrl}/rest/getCoverArt.view?id=${encodeURIComponent(song.coverArt)}&${authParams}`
      : ''
    const streamUrl = `${server.serverUrl}/rest/stream.view?id=${encodeURIComponent(song.id)}&format=raw&${authParams}`
    const durationSec = song.duration || 180

    return {
      id: `navidrome_${song.id}`,
      videoId: `navidrome_${song.id}`,
      title: song.title || 'Unknown Title',
      artistId: song.artistId
        ? `artist_navidrome_${song.artistId}`
        : `artist_navidrome_${(song.artist || '').toLowerCase().replace(/\s+/g, '_')}`,
      artistName: song.artist || 'Unknown Artist',
      albumId: song.albumId ? `album_navidrome_${song.albumId}` : 'navidrome_album',
      albumTitle: song.album || 'Cloud Album',
      albumImage: artworkUrl,
      artwork: artworkUrl,
      durationMs: durationSec * 1000,
      durationSeconds: durationSec,
      streamUrl,
      explicit: false,
      playCount: 1,
    }
  }
}

export const cloudMediaManager = new CloudMediaManager()
