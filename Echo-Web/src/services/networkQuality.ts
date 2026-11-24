import { z } from 'zod'
import type { AudioQuality, UserPreferences } from '../types/domain.ts'
import { useEchoStore } from '../stores/useEchoStore.ts'

export const networkTypeSchema = z.enum([
  'wifi',
  'cellular',
  'ethernet',
  'bluetooth',
  'other',
  'unknown',
])
export type NetworkType = z.infer<typeof networkTypeSchema>

export const networkInfoSchema = z.object({
  type: networkTypeSchema,
  effectiveType: z.string(),
  saveData: z.boolean(),
  isMetered: z.boolean(),
})
export type NetworkInfo = z.infer<typeof networkInfoSchema>

export const networkQualityMetricsSchema = z.object({
  wifiResolutions: z.number().int().nonnegative(),
  cellularResolutions: z.number().int().nonnegative(),
  dataSaverDowngrades: z.number().int().nonnegative(),
  evaluations: z.number().int().nonnegative(),
})
export type NetworkQualityMetrics = z.infer<typeof networkQualityMetricsSchema>

const telemetry: NetworkQualityMetrics = {
  wifiResolutions: 0,
  cellularResolutions: 0,
  dataSaverDowngrades: 0,
  evaluations: 0,
}

export function getNetworkQualityMetrics(): NetworkQualityMetrics {
  return { ...telemetry }
}

export function resetNetworkQualityMetrics(): void {
  telemetry.wifiResolutions = 0
  telemetry.cellularResolutions = 0
  telemetry.dataSaverDowngrades = 0
  telemetry.evaluations = 0
}

export function recordNetworkQualityMetric(key: keyof NetworkQualityMetrics): void {
  telemetry[key]++
}

interface NavigatorConnection {
  type?: string | undefined
  effectiveType?: string | undefined
  saveData?: boolean | undefined
  addEventListener?: (type: string, listener: () => void) => void
  removeEventListener?: (type: string, listener: () => void) => void
}

function getRawConnection(): NavigatorConnection | undefined {
  if (typeof navigator === 'undefined') return undefined
  const nav = navigator as unknown as {
    connection?: NavigatorConnection
    mozConnection?: NavigatorConnection
    webkitConnection?: NavigatorConnection
  }
  return nav.connection || nav.mozConnection || nav.webkitConnection
}

/**
 * Evaluates whether Data Saver is active from user preference or browser network policy.
 */
export function isDataSaverActive(): boolean {
  try {
    const prefs = useEchoStore.getState().preferences
    if (prefs?.dataSaver) return true
  } catch {
    // Store unavailable
  }

  const conn = getRawConnection()
  if (conn) {
    if (conn.saveData === true) return true
    if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') return true
  }

  return false
}

/**
 * Returns normalized connection info including whether the connection is metered/cellular.
 */
export function getNetworkConnectionInfo(): NetworkInfo {
  const conn = getRawConnection()
  if (!conn) {
    return {
      type: 'unknown',
      effectiveType: 'unknown',
      saveData: false,
      isMetered: false,
    }
  }

  const rawType = (conn.type || '').toLowerCase()
  let normalizedType: NetworkType = 'unknown'
  if (rawType === 'wifi') normalizedType = 'wifi'
  else if (rawType === 'cellular') normalizedType = 'cellular'
  else if (rawType === 'ethernet') normalizedType = 'ethernet'
  else if (rawType === 'bluetooth') normalizedType = 'bluetooth'
  else if (rawType) normalizedType = 'other'

  const effectiveType = conn.effectiveType || '4g'
  const saveData = Boolean(conn.saveData)

  // Metered when explicitly cellular, saveData active, or on slow 2G/3G connections
  const isMetered =
    saveData ||
    normalizedType === 'cellular' ||
    effectiveType === 'slow-2g' ||
    effectiveType === '2g'

  return {
    type: normalizedType,
    effectiveType,
    saveData,
    isMetered,
  }
}

/**
 * Determines whether the client is currently operating over a metered/cellular network.
 */
export function isMeteredConnection(): boolean {
  return getNetworkConnectionInfo().isMetered
}

/**
 * Resolves the effective audio quality ceiling based on user preferences and live network conditions.
 */
export function getEffectiveAudioQuality(prefs?: Partial<UserPreferences>): AudioQuality {
  telemetry.evaluations++

  // Explicit user dataSaver toggle or browser saveData policy forces low quality
  if (prefs?.dataSaver || isDataSaverActive()) {
    telemetry.dataSaverDowngrades++
    return 'low'
  }

  const connection = getNetworkConnectionInfo()
  if (connection.isMetered) {
    telemetry.cellularResolutions++
    return prefs?.audioQualityCellular ?? 'medium'
  }

  telemetry.wifiResolutions++
  return prefs?.audioQualityWifi ?? prefs?.audioQuality ?? 'lossless'
}

/**
 * Determines whether lossless audio streaming is permitted under current network conditions.
 */
export function shouldAllowLossless(prefs?: Partial<UserPreferences>): boolean {
  return getEffectiveAudioQuality(prefs) === 'lossless'
}

/**
 * Determines whether high-bitrate (≥256-320kbps) audio streaming is permitted.
 */
export function shouldAllowHighBitrate(prefs?: Partial<UserPreferences>): boolean {
  const quality = getEffectiveAudioQuality(prefs)
  return quality === 'high' || quality === 'lossless'
}

/**
 * Subscribes to browser network change events.
 */
export function subscribeNetworkChange(callback: (info: NetworkInfo) => void): () => void {
  const conn = getRawConnection()
  if (!conn || typeof conn.addEventListener !== 'function') {
    return () => {}
  }

  const handler = () => {
    callback(getNetworkConnectionInfo())
  }

  conn.addEventListener('change', handler)
  return () => {
    conn.removeEventListener?.('change', handler)
  }
}
