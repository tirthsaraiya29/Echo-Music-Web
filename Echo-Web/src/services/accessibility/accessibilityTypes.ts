/**
 * Accessibility and Keyboard Navigation schemas, types, and telemetry metrics.
 */

import { z } from 'zod'

export const shortcutCategorySchema = z.enum(['playback', 'navigation', 'ui'])
export type ShortcutCategory = z.infer<typeof shortcutCategorySchema>

export const shortcutDefinitionSchema = z.object({
  id: z.string().min(1),
  keys: z.array(z.string().min(1)).min(1),
  description: z.string().min(1),
  category: shortcutCategorySchema.default('playback'),
})

export type ShortcutDefinition = z.infer<typeof shortcutDefinitionSchema>

export const accessibilityPreferencesSchema = z.object({
  reducedMotion: z.boolean().default(false),
  highContrast: z.boolean().default(false),
  screenReaderAnnouncements: z.boolean().default(true),
})

export type AccessibilityPreferences = z.infer<typeof accessibilityPreferencesSchema>

export const keyComboSchema = z.object({
  code: z.string().min(1),
  key: z.string().min(1),
  shiftKey: z.boolean().optional().default(false),
  ctrlKey: z.boolean().optional().default(false),
  altKey: z.boolean().optional().default(false),
  metaKey: z.boolean().optional().default(false),
})

export type KeyCombo = z.infer<typeof keyComboSchema>

export const accessibilityMetricsSchema = z.object({
  shortcutsTriggered: z.number().int().nonnegative(),
  focusTrapsActivated: z.number().int().nonnegative(),
  screenReaderAnnouncementsSent: z.number().int().nonnegative(),
  reducedMotionDetected: z.number().int().nonnegative(),
})

export type AccessibilityMetrics = z.infer<typeof accessibilityMetricsSchema>

let metrics: AccessibilityMetrics = {
  shortcutsTriggered: 0,
  focusTrapsActivated: 0,
  screenReaderAnnouncementsSent: 0,
  reducedMotionDetected: 0,
}

export function getAccessibilityMetrics(): AccessibilityMetrics {
  return { ...metrics }
}

export function resetAccessibilityMetrics(): void {
  metrics = {
    shortcutsTriggered: 0,
    focusTrapsActivated: 0,
    screenReaderAnnouncementsSent: 0,
    reducedMotionDetected: 0,
  }
}

export function recordAccessibilityMetric(metric: keyof AccessibilityMetrics): void {
  metrics[metric]++
}

export function isReducedMotionPreferred(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  const preferred = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (preferred) {
    recordAccessibilityMetric('reducedMotionDetected')
  }
  return preferred
}
