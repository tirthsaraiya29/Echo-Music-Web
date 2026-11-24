import { z } from 'zod'
import process from 'node:process'

export const deploymentConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3000),
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  staticDir: z.string().min(1).default('./dist'),
  corsOrigins: z.array(z.string()).default(['http://localhost:5173']),
  rateLimitMax: z.number().int().positive().default(100),
  serviceName: z.string().min(1).default('echo-audio-proxy'),
  version: z.string().min(1).default('1.0.0'),
})

export type DeploymentConfig = z.infer<typeof deploymentConfigSchema>

export const memoryUsageSchema = z.object({
  rss: z.number().nonnegative(),
  heapTotal: z.number().nonnegative(),
  heapUsed: z.number().nonnegative(),
  external: z.number().nonnegative(),
})

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  service: z.string(),
  version: z.string(),
  timestamp: z.number().positive(),
  uptime: z.number().nonnegative(),
  memory: memoryUsageSchema,
})

export type HealthResponse = z.infer<typeof healthResponseSchema>

export const deploymentMetricsSchema = z.object({
  requestsHandled: z.number().int().nonnegative(),
  healthChecks: z.number().int().nonnegative(),
  telemetryRequests: z.number().int().nonnegative(),
  staticAssetsServed: z.number().int().nonnegative(),
  serverErrors: z.number().int().nonnegative(),
  uptimeSeconds: z.number().nonnegative(),
})

export type DeploymentMetrics = z.infer<typeof deploymentMetricsSchema>

const startTime = Date.now()

const deploymentMetrics = {
  requestsHandled: 0,
  healthChecks: 0,
  telemetryRequests: 0,
  staticAssetsServed: 0,
  serverErrors: 0,
}

export function validateDeploymentConfig(rawConfig: unknown): DeploymentConfig {
  return deploymentConfigSchema.parse(rawConfig)
}

export function recordDeploymentMetric(
  key: keyof typeof deploymentMetrics,
): void {
  deploymentMetrics[key] = (deploymentMetrics[key] || 0) + 1
}

export function resetDeploymentMetrics(): void {
  deploymentMetrics.requestsHandled = 0
  deploymentMetrics.healthChecks = 0
  deploymentMetrics.telemetryRequests = 0
  deploymentMetrics.staticAssetsServed = 0
  deploymentMetrics.serverErrors = 0
}

export function getDeploymentMetrics(): DeploymentMetrics {
  const uptimeSeconds = Math.max(0, Math.floor((Date.now() - startTime) / 1000))
  const data = {
    ...deploymentMetrics,
    uptimeSeconds,
  }
  return deploymentMetricsSchema.parse(data)
}

export function buildHealthPayload(
  status: 'ok' | 'degraded' | 'error' = 'ok',
): HealthResponse {
  const mem = process.memoryUsage ? process.memoryUsage() : {
    rss: 0,
    heapTotal: 0,
    heapUsed: 0,
    external: 0,
  }

  const payload: HealthResponse = {
    status,
    service: 'echo-audio-proxy',
    version: '1.0.0',
    timestamp: Date.now(),
    uptime: typeof process.uptime === 'function' ? process.uptime() : Math.floor((Date.now() - startTime) / 1000),
    memory: {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external,
    },
  }

  return healthResponseSchema.parse(payload)
}
