/**
 * Theme and Design Tokens schemas, validation, constants, and telemetry.
 */

import { z } from 'zod'
import type { AccentColor } from '../../types/domain.ts'

export const themeModeSchema = z.enum(['light', 'dark', 'system'])
export type ThemeMode = z.infer<typeof themeModeSchema>
export const accentColorSchema = z.enum(['violet', 'emerald', 'amber', 'rose', 'sky'])

export interface AccentDefinition {
  value: AccentColor
  label: string
  color: string
  inkColor: string
}

export const ACCENTS: readonly AccentDefinition[] = [
  { value: 'violet', label: 'Violet', color: '#8b79e8', inkColor: '#0b0a0f' },
  { value: 'emerald', label: 'Fern', color: '#58ad83', inkColor: '#0b0a0f' },
  { value: 'amber', label: 'Ochre', color: '#d59b52', inkColor: '#0b0a0f' },
  { value: 'rose', label: 'Rose', color: '#d5798f', inkColor: '#0b0a0f' },
  { value: 'sky', label: 'Sky', color: '#59a4c6', inkColor: '#0b0a0f' },
] as const

export const themeMetricsSchema = z.object({
  themeChanges: z.number().int().nonnegative(),
  accentChanges: z.number().int().nonnegative(),
  systemThemeEvaluations: z.number().int().nonnegative(),
  tokenResolutions: z.number().int().nonnegative(),
})

export type ThemeMetrics = z.infer<typeof themeMetricsSchema>

let metrics: ThemeMetrics = {
  themeChanges: 0,
  accentChanges: 0,
  systemThemeEvaluations: 0,
  tokenResolutions: 0,
}

export function getThemeMetrics(): ThemeMetrics {
  return { ...metrics }
}

export function resetThemeMetrics(): void {
  metrics = {
    themeChanges: 0,
    accentChanges: 0,
    systemThemeEvaluations: 0,
    tokenResolutions: 0,
  }
}

export function recordThemeMetric(metric: keyof ThemeMetrics): void {
  metrics[metric]++
}

export function getAccentDefinition(accent: AccentColor): AccentDefinition {
  recordThemeMetric('tokenResolutions')
  return ACCENTS.find((a) => a.value === accent) ?? ACCENTS[0]!
}
