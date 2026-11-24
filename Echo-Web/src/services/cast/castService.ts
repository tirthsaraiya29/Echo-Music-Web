import type { Track } from '../../types/domain'

declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void
    cast?: {
      framework: {
        CastContext: {
          getInstance: () => {
            setOptions: (options: {
              receiverApplicationId: string
              autoJoinPolicy: unknown
            }) => void
            requestSession: () => Promise<unknown>
            endCurrentSession: (stopCasting: boolean) => Promise<unknown>
            getCastState: () => string
            getCurrentSession: () => {
              getSessionObj: () => unknown
              getMediaSession: () => {
                play: (request: unknown, success: () => void, error: (err: unknown) => void) => void
                pause: (
                  request: unknown,
                  success: () => void,
                  error: (err: unknown) => void,
                ) => void
                seek: (request: unknown, success: () => void, error: (err: unknown) => void) => void
                stop: (request: unknown, success: () => void, error: (err: unknown) => void) => void
              } | null
              loadMedia: (loadRequest: unknown) => Promise<unknown>
            } | null
            addEventListener: (event: string, handler: (e: { castState?: string }) => void) => void
          }
        }
        CastState: {
          NO_DEVICES_AVAILABLE: string
          NOT_CONNECTED: string
          CONNECTING: string
          CONNECTED: string
        }
        CastContextEventType: {
          CAST_STATE_CHANGED: string
          SESSION_STATE_CHANGED: string
        }
      }
    }
    chrome?: {
      cast?: {
        media?: {
          MediaInfo: new (
            contentId: string,
            contentType: string,
          ) => {
            metadata: {
              metadataType: number
              title: string
              subtitle: string
              images: Array<{ url: string }>
            }
            streamType: string
          }
          LoadRequest: new (mediaInfo: unknown) => {
            currentTime: number
            autoplay: boolean
          }
          MetadataType: {
            MUSIC_TRACK: number
          }
          StreamType: {
            BUFFERED: string
          }
        }
        AutoJoinPolicy: {
          ORIGIN_SCOPED: unknown
        }
        mediaSessionId?: unknown
      }
    }
  }
}

class GoogleCastService {
  private static instance: GoogleCastService | null = null
  private isLoaded = false
  private isConnected = false
  private listeners = new Set<(connected: boolean) => void>()
  private readyListeners = new Set<(ready: boolean) => void>()
  private readyPromise: Promise<boolean> | null = null
  private readyResolvers: Array<(ready: boolean) => void> = []

  public static getInstance(): GoogleCastService {
    if (!GoogleCastService.instance) {
      GoogleCastService.instance = new GoogleCastService()
    }
    return GoogleCastService.instance
  }

  public isSdkReady(): boolean {
    return Boolean(this.isLoaded && window.cast?.framework)
  }

  public subscribeReady(listener: (ready: boolean) => void): () => void {
    this.readyListeners.add(listener)
    listener(this.isSdkReady())
    return () => this.readyListeners.delete(listener)
  }

  public init(): Promise<boolean> {
    if (typeof window === 'undefined') return Promise.resolve(false)

    if (this.isLoaded && window.cast?.framework) {
      return Promise.resolve(true)
    }

    if (this.readyPromise) {
      return this.readyPromise
    }

    this.readyPromise = new Promise<boolean>((resolve) => {
      this.readyResolvers.push(resolve)

      if (window.cast?.framework) {
        this.isLoaded = true
        this.setupCastContext()
        this.resolveReady(true)
        return
      }

      const prevCallback = window.__onGCastApiAvailable
      window.__onGCastApiAvailable = (isAvailable: boolean) => {
        try {
          prevCallback?.(isAvailable)
        } catch {
          // Ignore
        }
        if (isAvailable && window.cast?.framework) {
          this.isLoaded = true
          this.setupCastContext()
          this.resolveReady(true)
        } else {
          this.resolveReady(false)
        }
      }

      if (typeof document !== 'undefined') {
        const existingScript = document.querySelector('script[src*="cast_sender.js"]')
        if (!existingScript) {
          const script = document.createElement('script')
          script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1'
          script.async = true
          script.onerror = () => {
            this.resolveReady(false)
          }
          document.head.appendChild(script)
        }
      }
    })

    return this.readyPromise
  }

  private resolveReady(ready: boolean): void {
    const resolvers = [...this.readyResolvers]
    this.readyResolvers = []
    resolvers.forEach((r) => r(ready))
    this.readyListeners.forEach((l) => l(ready))
  }

  private setupCastContext(): void {
    if (!window.cast?.framework) return
    try {
      const context = window.cast.framework.CastContext.getInstance()
      context.setOptions({
        receiverApplicationId: 'CC1AD845', // Default Media Receiver
        autoJoinPolicy: window.chrome?.cast?.AutoJoinPolicy?.ORIGIN_SCOPED,
      })

      context.addEventListener(
        window.cast.framework.CastContextEventType.CAST_STATE_CHANGED,
        (event) => {
          const connected = event.castState === window.cast?.framework.CastState.CONNECTED
          this.isConnected = connected
          this.listeners.forEach((l) => l(connected))
        },
      )
    } catch {
      // Ignore
    }
  }

  public subscribe(listener: (connected: boolean) => void): () => void {
    this.listeners.add(listener)
    listener(this.isConnected)
    return () => this.listeners.delete(listener)
  }

  public getIsConnected(): boolean {
    return this.isConnected
  }

  public async ensureReady(timeoutMs = 6000): Promise<boolean> {
    if (this.isSdkReady()) return true

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs)
    })

    const readyPromise = this.init().then((val) => {
      if (timer) clearTimeout(timer)
      return val
    })

    return Promise.race([readyPromise, timeoutPromise])
  }

  public async requestSession(timeoutMs = 8000): Promise<boolean> {
    if (typeof window === 'undefined') {
      return false
    }

    const ready = await this.ensureReady(timeoutMs)
    if (!ready || !window.cast?.framework) {
      return false
    }

    try {
      const context = window.cast.framework.CastContext.getInstance()
      await context.requestSession()
      this.isConnected = true
      this.listeners.forEach((l) => l(true))
      return true
    } catch {
      return false
    }
  }

  public async disconnect(): Promise<void> {
    if (typeof window === 'undefined') return
    try {
      const context = window.cast?.framework?.CastContext?.getInstance?.()
      if (context) {
        await context.endCurrentSession(true)
      }
    } catch {
      // Ignore
    }
    this.isConnected = false
    this.listeners.forEach((l) => l(false))
  }

  public inferMimeType(url: string): string {
    const cleanUrl = url.split('?')[0]?.toLowerCase() ?? ''
    if (cleanUrl.endsWith('.mp3')) return 'audio/mpeg'
    if (cleanUrl.endsWith('.mp4') || cleanUrl.endsWith('.m4a')) return 'audio/mp4'
    if (cleanUrl.endsWith('.aac')) return 'audio/aac'
    if (cleanUrl.endsWith('.flac')) return 'audio/flac'
    if (cleanUrl.endsWith('.wav')) return 'audio/wav'
    if (cleanUrl.endsWith('.ogg')) return 'audio/ogg'
    if (cleanUrl.endsWith('.webm') || cleanUrl.endsWith('.opus')) return 'audio/webm'
    return 'audio/webm'
  }

  public async castTrack(
    track: Track,
    streamUrl: string,
    currentTime = 0,
    mimeType?: string,
  ): Promise<boolean> {
    if (
      typeof window === 'undefined' ||
      !this.isConnected ||
      !window.cast?.framework ||
      !window.chrome?.cast?.media
    )
      return false

    try {
      const context = window.cast.framework.CastContext.getInstance()
      const session = context.getCurrentSession()
      if (!session) return false

      const fullStreamUrl = streamUrl.startsWith('/')
        ? window.location.origin + streamUrl
        : streamUrl

      const normalizedMimeType =
        (mimeType ? mimeType.split(';')[0]?.trim() : '') ||
        this.inferMimeType(fullStreamUrl)

      const mediaInfo = new window.chrome.cast.media.MediaInfo(fullStreamUrl, normalizedMimeType)
      mediaInfo.metadata = {
        metadataType: window.chrome.cast.media.MetadataType.MUSIC_TRACK,
        title: track.title,
        subtitle: track.artistName || 'Unknown Artist',
        images: track.artwork ? [{ url: track.artwork }] : [],
      }
      mediaInfo.streamType = window.chrome.cast.media.StreamType.BUFFERED

      const request = new window.chrome.cast.media.LoadRequest(mediaInfo)
      request.autoplay = true
      request.currentTime = currentTime

      await session.loadMedia(request)
      return true
    } catch {
      return false
    }
  }

  public pause(): void {
    if (typeof window === 'undefined') return
    const session = window.cast?.framework?.CastContext?.getInstance()?.getCurrentSession()
    session?.getMediaSession()?.pause(
      {},
      () => {},
      () => {},
    )
  }

  public play(): void {
    if (typeof window === 'undefined') return
    const session = window.cast?.framework?.CastContext?.getInstance()?.getCurrentSession()
    session?.getMediaSession()?.play(
      {},
      () => {},
      () => {},
    )
  }

  public seek(seconds: number): void {
    if (typeof window === 'undefined') return
    const session = window.cast?.framework?.CastContext?.getInstance()?.getCurrentSession()
    session?.getMediaSession()?.seek(
      { currentTime: seconds },
      () => {},
      () => {},
    )
  }
}

export const castService = GoogleCastService.getInstance()
