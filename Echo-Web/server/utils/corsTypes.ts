import { z } from 'zod'

export const originUrlSchema = z
  .string()
  .url()
  .refine(
    (val) => {
      try {
        const u = new URL(val)
        return (
          (u.protocol === 'http:' || u.protocol === 'https:') &&
          u.pathname === '/' &&
          !u.search &&
          !u.hash
        )
      } catch {
        return false
      }
    },
    {
      message: 'Origin must be a standard http or https URL without path or query',
    },
  )

export const corsConfigSchema = z.object({
  allowedOrigins: z.array(z.string()).default(['http://localhost:5173']),
  allowMethods: z
    .array(z.enum(['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH']))
    .default(['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']),
  allowHeaders: z.array(z.string()).default([
    'Content-Type',
    'Range',
    'Authorization',
    'X-YouTube-Visitor-Data',
  ]),
  exposeHeaders: z.array(z.string()).default([
    'Content-Length',
    'Content-Range',
    'Accept-Ranges',
  ]),
  maxAge: z.number().int().nonnegative().default(86400),
})

export type CorsConfig = z.infer<typeof corsConfigSchema>

export const corsMetricsSchema = z.object({
  preflightRequests: z.number().int().nonnegative(),
  allowedOriginsChecked: z.number().int().nonnegative(),
  rejectedOrigins: z.number().int().nonnegative(),
  securityHeadersApplied: z.number().int().nonnegative(),
})

export type CorsMetrics = z.infer<typeof corsMetricsSchema>

const corsMetrics = {
  preflightRequests: 0,
  allowedOriginsChecked: 0,
  rejectedOrigins: 0,
  securityHeadersApplied: 0,
}

export function recordCorsMetric(key: keyof typeof corsMetrics): void {
  corsMetrics[key] = (corsMetrics[key] || 0) + 1
}

export function resetCorsMetrics(): void {
  corsMetrics.preflightRequests = 0
  corsMetrics.allowedOriginsChecked = 0
  corsMetrics.rejectedOrigins = 0
  corsMetrics.securityHeadersApplied = 0
}

export function getCorsMetrics(): CorsMetrics {
  return corsMetricsSchema.parse(corsMetrics)
}

export function parseAndValidateAllowedOrigins(rawEnv?: string): string[] {
  if (!rawEnv) {
    return ['http://localhost:5173']
  }

  const origins = rawEnv
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)

  if (origins.length === 0) {
    return ['http://localhost:5173']
  }

  const valid: string[] = []
  for (const origin of origins) {
    try {
      const u = new URL(origin)
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        valid.push(u.origin)
      }
    } catch {
      // Reject malformed origins
    }
  }

  return valid.length > 0 ? valid : ['http://localhost:5173']
}

export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[],
): boolean {
  recordCorsMetric('allowedOriginsChecked')
  if (!origin) {
    recordCorsMetric('rejectedOrigins')
    return false
  }

  try {
    const u = new URL(origin)
    const normalized = u.origin
    const isAllowed = allowedOrigins.includes(normalized)
    if (!isAllowed) {
      recordCorsMetric('rejectedOrigins')
    }
    return isAllowed
  } catch {
    recordCorsMetric('rejectedOrigins')
    return false
  }
}

export function getSecurityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  }
}
