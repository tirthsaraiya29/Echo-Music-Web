import { z } from 'zod'

export const ciStepStatusSchema = z.enum([
  'pending',
  'running',
  'success',
  'failure',
  'skipped',
  'cancelled',
])
export type CiStepStatus = z.infer<typeof ciStepStatusSchema>

export const ciStepSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  status: ciStepStatusSchema,
  durationMs: z.number().int().nonnegative().default(0),
  error: z.string().optional(),
})
export type CiStep = z.infer<typeof ciStepSchema>

export const ciPipelineResultSchema = z.object({
  id: z.string().min(1),
  timestamp: z.number().positive(),
  status: z.enum(['passed', 'failed', 'cancelled']),
  totalDurationMs: z.number().int().nonnegative(),
  steps: z.array(ciStepSchema),
})
export type CiPipelineResult = z.infer<typeof ciPipelineResultSchema>

export const ciTelemetryMetricsSchema = z.object({
  runsTriggered: z.number().int().nonnegative(),
  runsCompleted: z.number().int().nonnegative(),
  runsFailed: z.number().int().nonnegative(),
  runsCancelled: z.number().int().nonnegative(),
  totalStepExecutions: z.number().int().nonnegative(),
})
export type CiTelemetryMetrics = z.infer<typeof ciTelemetryMetricsSchema>

const metrics = {
  runsTriggered: 0,
  runsCompleted: 0,
  runsFailed: 0,
  runsCancelled: 0,
  totalStepExecutions: 0,
}

export function recordCiMetric(key: keyof typeof metrics): void {
  metrics[key] = (metrics[key] || 0) + 1
}

export function resetCiTelemetryMetrics(): void {
  metrics.runsTriggered = 0
  metrics.runsCompleted = 0
  metrics.runsFailed = 0
  metrics.runsCancelled = 0
  metrics.totalStepExecutions = 0
}

export function getCiTelemetryMetrics(): CiTelemetryMetrics {
  return ciTelemetryMetricsSchema.parse(metrics)
}
