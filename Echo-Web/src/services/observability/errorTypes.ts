import { z } from 'zod'

export const errorSeveritySchema = z.enum(['info', 'warn', 'error', 'fatal'])
export type ErrorSeverity = z.infer<typeof errorSeveritySchema>

export const errorContextSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
)
export type ErrorContext = z.infer<typeof errorContextSchema>

export const errorLogEntrySchema = z.object({
  id: z.string().min(1),
  timestamp: z.number().positive(),
  severity: errorSeveritySchema,
  message: z.string().min(1).max(1000),
  stack: z.string().optional(),
  context: errorContextSchema.optional(),
  handled: z.boolean(),
})

export type ErrorLogEntry = z.infer<typeof errorLogEntrySchema>

export const observabilityMetricsSchema = z.object({
  errorsLogged: z.number().int().nonnegative(),
  errorsReported: z.number().int().nonnegative(),
  unhandledRejections: z.number().int().nonnegative(),
  fatalCrashes: z.number().int().nonnegative(),
  sanitizedSecretsCount: z.number().int().nonnegative(),
})

export type ObservabilityMetrics = z.infer<typeof observabilityMetricsSchema>
