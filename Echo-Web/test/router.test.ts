import test from 'node:test'
import assert from 'node:assert'

import {
  staticRouteSchema,
  routeParamSchema,
  sanitizeRouteParam,
  navigationEventSchema,
  routingMetricsSchema,
  getRoutingMetrics,
  resetRoutingMetrics,
  recordRoutingMetric,
} from '../src/app/router/routeTypes.ts'

import { NavigationManager, navigationManager } from '../src/app/router/NavigationManager.ts'

test('Router: static route schema validates known top-level routes [SMALL-41]', () => {
  assert.strictEqual(staticRouteSchema.safeParse('/').success, true)
  assert.strictEqual(staticRouteSchema.safeParse('/discover').success, true)
  assert.strictEqual(staticRouteSchema.safeParse('/search').success, true)
  assert.strictEqual(staticRouteSchema.safeParse('/library').success, true)
  assert.strictEqual(staticRouteSchema.safeParse('/flow').success, true)
  assert.strictEqual(staticRouteSchema.safeParse('/settings').success, true)

  // Unknown route fails schema
  assert.strictEqual(staticRouteSchema.safeParse('/unknown').success, false)
})

test('Router: routeParamSchema sanitizes params and rejects path traversal [SMALL-41]', () => {
  // Valid browse IDs
  assert.strictEqual(routeParamSchema.safeParse('VLPL1234567890').success, true)
  assert.strictEqual(routeParamSchema.safeParse('MPREb_987654321').success, true)
  assert.strictEqual(routeParamSchema.safeParse('UC1234567890abcdef').success, true)
  assert.strictEqual(sanitizeRouteParam('VLPL1234567890'), 'VLPL1234567890')

  // Path traversal & dangerous patterns
  assert.strictEqual(routeParamSchema.safeParse('../etc/passwd').success, false)
  assert.strictEqual(routeParamSchema.safeParse('<script>alert(1)</script>').success, false)
  assert.strictEqual(routeParamSchema.safeParse('').success, false)
  assert.strictEqual(routeParamSchema.safeParse('a'.repeat(200)).success, false)

  resetRoutingMetrics()
  const sanitized = sanitizeRouteParam('../malicious/path')
  assert.strictEqual(sanitized, null)
  assert.strictEqual(getRoutingMetrics().paramValidationFailures, 1)
})

test('Router: telemetry metrics track navigations and reset cleanly [SMALL-41]', () => {
  resetRoutingMetrics()
  const initial = getRoutingMetrics()
  assert.strictEqual(initial.navigations, 0)
  assert.strictEqual(initial.notFoundNavigations, 0)

  recordRoutingMetric('navigations')
  recordRoutingMetric('notFoundNavigations')
  recordRoutingMetric('routeErrors')

  const updated = getRoutingMetrics()
  assert.strictEqual(updated.navigations, 1)
  assert.strictEqual(updated.notFoundNavigations, 1)
  assert.strictEqual(updated.routeErrors, 1)
  assert.strictEqual(routingMetricsSchema.safeParse(updated).success, true)

  resetRoutingMetrics()
  assert.strictEqual(getRoutingMetrics().navigations, 0)
})

test('Router: NavigationManager coalesces redundant navigations and notifies subscribers [SMALL-41]', () => {
  resetRoutingMetrics()
  const mgr = NavigationManager.getInstance()
  assert.strictEqual(mgr, navigationManager)

  let lastEvent: unknown = null
  const unsubscribe = mgr.subscribe((event) => {
    lastEvent = event
  })

  // First navigation from / to /discover
  mgr.recordNavigation('/', '/discover')
  assert.strictEqual(getRoutingMetrics().navigations, 1)
  assert.strictEqual(mgr.getLastPath(), '/discover')
  assert.strictEqual(navigationEventSchema.safeParse(lastEvent).success, true)

  // Redundant navigation to the same path
  const shouldNav = mgr.shouldNavigate('/discover')
  assert.strictEqual(shouldNav, false)
  assert.strictEqual(getRoutingMetrics().redundantNavigationsSkipped, 1)

  // Redundant recordNavigation call
  mgr.recordNavigation('/discover', '/discover')
  assert.strictEqual(getRoutingMetrics().redundantNavigationsSkipped, 2)
  assert.strictEqual(getRoutingMetrics().navigations, 1)

  unsubscribe()
  mgr.reset()
})
