/**
 * Application routing schemas, parameter validation, and telemetry metrics.
 */

import { z } from 'zod'

export const knownStaticRoutes = [
  '/',
  '/discover',
  '/search',
  '/library',
  '/liked',
  '/recently-played',
  '/queue',
  '/podcasts',
  '/flow',
  '/settings',
] as const

export const staticRouteSchema = z.enum(knownStaticRoutes)
export type StaticRoute = z.infer<typeof staticRouteSchema>

// Parameter schema rejecting dangerous characters, path traversal, and null bytes
const routeParamPattern = /^[a-zA-Z0-9_\-:.]{1,128}$/

export const routeParamSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(routeParamPattern, 'Route parameter contains disallowed characters')

export const playlistIdParamSchema = routeParamSchema
export const albumIdParamSchema = routeParamSchema
export const artistIdParamSchema = routeParamSchema

export function sanitizeRouteParam(raw: unknown): string | null {
  const result = routeParamSchema.safeParse(raw)
  if (result.success) {
    return result.data
  }
  recordRoutingMetric('paramValidationFailures')
  return null
}

export const navigationEventSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
})

export type NavigationEvent = z.infer<typeof navigationEventSchema>

export const routingMetricsSchema = z.object({
  navigations: z.number().int().nonnegative(),
  redundantNavigationsSkipped: z.number().int().nonnegative(),
  paramValidationFailures: z.number().int().nonnegative(),
  notFoundNavigations: z.number().int().nonnegative(),
  routeErrors: z.number().int().nonnegative(),
})

export type RoutingMetrics = z.infer<typeof routingMetricsSchema>

let metrics: RoutingMetrics = {
  navigations: 0,
  redundantNavigationsSkipped: 0,
  paramValidationFailures: 0,
  notFoundNavigations: 0,
  routeErrors: 0,
}

export function getRoutingMetrics(): RoutingMetrics {
  return { ...metrics }
}

export function resetRoutingMetrics(): void {
  metrics = {
    navigations: 0,
    redundantNavigationsSkipped: 0,
    paramValidationFailures: 0,
    notFoundNavigations: 0,
    routeErrors: 0,
  }
}

export function recordRoutingMetric(metric: keyof RoutingMetrics): void {
  metrics[metric]++
}
