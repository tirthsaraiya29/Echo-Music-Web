import {
  errorLogEntrySchema,
  observabilityMetricsSchema,
  type ErrorSeverity,
  type ErrorLogEntry,
  type ObservabilityMetrics,
  type ErrorContext,
} from './errorTypes.ts'

const MAX_ERROR_BUFFER_SIZE = 50

const metrics = {
  errorsLogged: 0,
  errorsReported: 0,
  unhandledRejections: 0,
  fatalCrashes: 0,
  sanitizedSecretsCount: 0,
}

let errorBuffer: ErrorLogEntry[] = []
let idCounter = 0
const listeners = new Set<(entry: ErrorLogEntry) => void>()

export function recordObservabilityMetric(key: keyof typeof metrics): void {
  metrics[key] = (metrics[key] || 0) + 1
}

export function resetObservabilityMetrics(): void {
  metrics.errorsLogged = 0
  metrics.errorsReported = 0
  metrics.unhandledRejections = 0
  metrics.fatalCrashes = 0
  metrics.sanitizedSecretsCount = 0
  errorBuffer = []
  listeners.clear()
}

export function getObservabilityMetrics(): ObservabilityMetrics {
  return observabilityMetricsSchema.parse(metrics)
}

/**
 * Sanitizes messages and stack traces to avoid leaking Bearer tokens,
 * query parameter keys, passwords, or personal credentials.
 */
export function sanitizeErrorMessage(text: string): string {
  let sanitized = text
  const tokenRegex = /(bearer\s+[A-Za-z0-9\-_.]+)|(token=[A-Za-z0-9\-_.]+)|(password=[^&\s]+)|(secret=[^&\s]+)/gi
  if (tokenRegex.test(sanitized)) {
    recordObservabilityMetric('sanitizedSecretsCount')
    sanitized = sanitized.replace(tokenRegex, '[REDACTED_CREDENTIAL]')
  }
  return sanitized.slice(0, 1000)
}

export class ErrorLogger {
  private static instance: ErrorLogger | null = null

  static getInstance(): ErrorLogger {
    if (!ErrorLogger.instance) {
      ErrorLogger.instance = new ErrorLogger()
    }
    return ErrorLogger.instance
  }

  log(
    error: unknown,
    severity: ErrorSeverity = 'error',
    context?: ErrorContext,
    handled = true,
  ): ErrorLogEntry {
    recordObservabilityMetric('errorsLogged')
    if (severity === 'fatal') {
      recordObservabilityMetric('fatalCrashes')
    }

    let rawMessage = 'Unknown error'
    let rawStack: string | undefined

    if (error instanceof Error) {
      rawMessage = error.message
      rawStack = error.stack
    } else if (typeof error === 'string') {
      rawMessage = error
    } else if (error && typeof error === 'object') {
      try {
        rawMessage = JSON.stringify(error)
      } catch {
        rawMessage = String(error)
      }
    }

    const sanitizedMessage = sanitizeErrorMessage(rawMessage)
    const sanitizedStack = rawStack ? sanitizeErrorMessage(rawStack) : undefined

    idCounter += 1
    const entry: ErrorLogEntry = errorLogEntrySchema.parse({
      id: `err-${Date.now()}-${idCounter}`,
      timestamp: Date.now(),
      severity,
      message: sanitizedMessage || 'An empty error was raised',
      stack: sanitizedStack,
      context,
      handled,
    })

    errorBuffer.push(entry)
    if (errorBuffer.length > MAX_ERROR_BUFFER_SIZE) {
      errorBuffer.shift()
    }

    for (const listener of listeners) {
      try {
        listener(entry)
      } catch (err) {
        console.error('Error in error-logger listener:', err)
      }
    }

    return entry
  }

  getRecentErrors(): ErrorLogEntry[] {
    return [...errorBuffer]
  }

  clearErrors(): void {
    errorBuffer = []
  }

  subscribe(listener: (entry: ErrorLogEntry) => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  /**
   * Initializes window onerror and unhandledrejection handlers if in browser.
   * Returns a cleanup function to detach them cleanly.
   */
  initGlobalHandlers(): () => void {
    if (typeof window === 'undefined') {
      return () => {}
    }

    const errorHandler = (event: ErrorEvent) => {
      this.log(event.error || event.message, 'error', {
        filename: event.filename || null,
        lineno: event.lineno || null,
      }, false)
    }

    const rejectionHandler = (event: PromiseRejectionEvent) => {
      recordObservabilityMetric('unhandledRejections')
      this.log(event.reason, 'error', {
        type: 'unhandledrejection',
      }, false)
    }

    window.addEventListener('error', errorHandler)
    window.addEventListener('unhandledrejection', rejectionHandler)

    return () => {
      window.removeEventListener('error', errorHandler)
      window.removeEventListener('unhandledrejection', rejectionHandler)
    }
  }
}
