/**
 * Global layout and navigation schemas, validation, and telemetry metrics.
 */

import { z } from 'zod'

export const sidebarStateSchema = z.object({
  collapsed: z.boolean(),
  customWidth: z.number().int().min(180).max(480).optional(),
})

export type SidebarState = z.infer<typeof sidebarStateSchema>

export const navLinkItemSchema = z.object({
  to: z.string().min(1),
  label: z.string().min(1),
  end: z.boolean().optional(),
  badge: z.number().int().nonnegative().optional(),
})

export type NavLinkItem = z.infer<typeof navLinkItemSchema>

export const layoutPreferencesSchema = z.object({
  sidebarCollapsed: z.boolean().default(false),
  compactMode: z.boolean().default(false),
  showVisualizer: z.boolean().default(false),
})

export type LayoutPreferences = z.infer<typeof layoutPreferencesSchema>

export const layoutMetricsSchema = z.object({
  sidebarToggles: z.number().int().nonnegative(),
  navigationClicks: z.number().int().nonnegative(),
  historyBackNavigations: z.number().int().nonnegative(),
  historyForwardNavigations: z.number().int().nonnegative(),
  shortcutsModalOpens: z.number().int().nonnegative(),
})

export type LayoutMetrics = z.infer<typeof layoutMetricsSchema>

let metrics: LayoutMetrics = {
  sidebarToggles: 0,
  navigationClicks: 0,
  historyBackNavigations: 0,
  historyForwardNavigations: 0,
  shortcutsModalOpens: 0,
}

export function getLayoutMetrics(): LayoutMetrics {
  return { ...metrics }
}

export function resetLayoutMetrics(): void {
  metrics = {
    sidebarToggles: 0,
    navigationClicks: 0,
    historyBackNavigations: 0,
    historyForwardNavigations: 0,
    shortcutsModalOpens: 0,
  }
}

export function recordLayoutMetric(metric: keyof LayoutMetrics): void {
  metrics[metric]++
}
