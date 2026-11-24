export interface AddonEndpoint {
  id: string
  name: string
  url: string
  enabled: boolean
  priority: number
}

export interface AddonManifest {
  id: string
  name: string
  version: string
  description?: string | undefined
}

export interface AddonTrack {
  id: string
  title: string
  artist: string
  duration?: number | undefined
  artworkURL?: string | undefined
  albumArtworkURL?: string | undefined
}

export interface AddonStreamResponse {
  url: string
  format?: string | undefined
  quality?: string | undefined
  streamQuality?: string | undefined
  audioQuality?: string | undefined
  codec?: string | undefined
}

export interface ExtensionHealthStatus {
  status: 'online' | 'offline' | 'error'
  latencyMs?: number | undefined
  manifest?: AddonManifest | undefined
  error?: string | undefined
}

export interface ExtensionMatchCandidate {
  track: AddonTrack
  score: number
}

export interface ExtensionTelemetry {
  totalAttempts: number
  matchesFound: number
  resolutionSuccesses: number
  fallbackCount: number
  activeExtensionSource?: string | undefined
}

export interface ExtensionResolvedStream {
  streamUrl: string
  mimeType?: string | undefined
  codec?: string | undefined
  quality?: string | undefined
  source: string
}
