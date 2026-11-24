/**
 * User Preferences and Settings schemas, validation, sanitization, and telemetry.
 */

import { z } from 'zod'
import type { UserPreferences } from '../../types/domain.ts'

export const themeModeSchema = z.enum(['dark', 'oled', 'system', 'light'])
export const accentColorSchema = z.enum(['violet', 'emerald', 'amber', 'rose', 'sky'])
export const audioQualitySchema = z.enum(['low', 'medium', 'high', 'lossless'])
export const repeatModeSchema = z.enum(['off', 'all', 'one'])
export const lastPlayedLayoutSchema = z.enum(['grid', 'list'])
export const lyricsProviderSchema = z.enum(['LRCLIB', 'BETTER_LYRICS', 'KUGOU'])
export const defaultTabSchema = z.enum(['home', 'search', 'library', 'discover', 'settings'])
export const discordModeSchema = z.enum(['auto', 'companion', 'backend'])

export const userPreferencesSchema = z.object({
  themeMode: themeModeSchema.default('dark'),
  accentColor: accentColorSchema.default('violet'),
  volume: z.number().min(0).max(100).default(68),
  muted: z.boolean().default(false),
  shuffle: z.boolean().default(false),
  repeat: repeatModeSchema.default('off'),
  showExplicit: z.boolean().default(true),
  volumeNormalization: z.boolean().default(false),
  audioQuality: audioQualitySchema.default('high'),
  audioQualityWifi: audioQualitySchema.optional().default('lossless'),
  audioQualityCellular: audioQualitySchema.optional().default('medium'),
  smoothScrolling: z.boolean().default(true),
  compactLists: z.boolean().default(false),
  lastPlayedLayout: lastPlayedLayoutSchema.default('grid'),
  contentRegion: z.string().regex(/^[A-Z]{2}$/).optional().default('US'),
  crossfadeDuration: z.number().min(0).max(12).optional().default(3),
  preferredLyricsProvider: lyricsProviderSchema.optional().default('LRCLIB'),
  defaultTab: defaultTabSchema.optional().default('home'),
  dataSaver: z.boolean().optional().default(false),
  romanizeLyrics: z.boolean().optional().default(false),
  lastfmSession: z
    .object({
      sessionKey: z.string().min(1),
      username: z.string().min(1),
    })
    .optional(),
  lastfmScrobbling: z.boolean().optional().default(false),
  discordRpc: z.boolean().optional().default(false),
  discordBridgeUrl: z.string().optional(),
  discordMode: discordModeSchema.optional().default('auto'),
  skipSilence: z.boolean().optional().default(false),
  googleCast: z.boolean().optional().default(false),
  preferExtensionAudio: z.boolean().optional().default(true),
  extensionSourcePriority: z
    .enum(['extension-first', 'youtube-first'])
    .optional()
    .default('extension-first'),
})

export type ValidatedUserPreferences = z.infer<typeof userPreferencesSchema>

export const settingsMetricsSchema = z.object({
  preferenceUpdates: z.number().int().nonnegative(),
  preferenceValidationFailures: z.number().int().nonnegative(),
  preferencesResetToDefault: z.number().int().nonnegative(),
  preferencesImported: z.number().int().nonnegative(),
  preferencesExported: z.number().int().nonnegative(),
})

export type SettingsMetrics = z.infer<typeof settingsMetricsSchema>

let metrics: SettingsMetrics = {
  preferenceUpdates: 0,
  preferenceValidationFailures: 0,
  preferencesResetToDefault: 0,
  preferencesImported: 0,
  preferencesExported: 0,
}

export function getSettingsMetrics(): SettingsMetrics {
  return { ...metrics }
}

export function resetSettingsMetrics(): void {
  metrics = {
    preferenceUpdates: 0,
    preferenceValidationFailures: 0,
    preferencesResetToDefault: 0,
    preferencesImported: 0,
    preferencesExported: 0,
  }
}

export function recordSettingsMetric(metric: keyof SettingsMetrics): void {
  metrics[metric]++
}

const keyValidators: Partial<Record<keyof UserPreferences, z.ZodTypeAny>> = {
  themeMode: themeModeSchema,
  accentColor: accentColorSchema,
  volume: z.number().min(0).max(100),
  muted: z.boolean(),
  shuffle: z.boolean(),
  repeat: repeatModeSchema,
  showExplicit: z.boolean(),
  volumeNormalization: z.boolean(),
  audioQuality: audioQualitySchema,
  smoothScrolling: z.boolean(),
  compactLists: z.boolean(),
  lastPlayedLayout: lastPlayedLayoutSchema,
  contentRegion: z.string().regex(/^[A-Z]{2}$/),
  crossfadeDuration: z.number().min(0).max(12),
  preferredLyricsProvider: lyricsProviderSchema,
  defaultTab: defaultTabSchema,
  dataSaver: z.boolean(),
  romanizeLyrics: z.boolean(),
  lastfmScrobbling: z.boolean(),
  discordRpc: z.boolean(),
  discordBridgeUrl: z.string(),
  discordMode: discordModeSchema,
  skipSilence: z.boolean(),
  googleCast: z.boolean(),
}

export function validatePreferenceUpdate<K extends keyof UserPreferences>(
  key: K,
  value: unknown,
): boolean {
  const validator = keyValidators[key]
  if (!validator) return true
  return validator.safeParse(value).success
}

export function sanitizeUserPreferences(raw: unknown): UserPreferences {
  const result = userPreferencesSchema.safeParse(raw ?? {})
  if (result.success) {
    return result.data as UserPreferences
  }

  // Gracefully fallback to parsing an empty object which yields all valid schema defaults
  return userPreferencesSchema.parse({}) as UserPreferences
}
