import {
  apiFetchOptionsSchema,
  recordApiMetric,
  type ApiFetchOptions,
} from './apiTypes.ts'

export class ApiError extends Error {
  public status: number
  public details?: unknown

  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const custom = (window as unknown as { __ECHO_API_BASE_URL__?: string }).__ECHO_API_BASE_URL__
    const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> })?.env?.[
      'VITE_API_BASE_URL'
    ]
    const resolved = (custom || viteEnv || '').trim()
    return resolved.replace(/\/+$/, '')
  }
  const globalProcess = (
    globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
  ).process
  return (globalProcess?.env?.['API_BASE_URL'] || 'http://localhost:3000').trim().replace(/\/+$/, '')
}

export function buildApiUrl(pathWithQuery: string): string {
  const baseUrl = getApiBaseUrl()
  const cleanPath = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`
  if (!baseUrl) {
    return cleanPath
  }
  return `${baseUrl}${cleanPath}`
}

const inFlightMap = new Map<string, Promise<unknown>>()

export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit & Partial<ApiFetchOptions> = {},
): Promise<T> {
  const parsedOpts = apiFetchOptionsSchema.parse({
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    retryDelayMs: options.retryDelayMs,
    dedup: options.dedup,
  })

  const baseUrl = getApiBaseUrl()
  const fullPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${fullPath}`
  const method = (options.method ?? 'GET').toUpperCase()

  // In-flight request deduplication for GET requests
  const dedupKey = method === 'GET' && parsedOpts.dedup ? url : null
  if (dedupKey) {
    const existing = inFlightMap.get(dedupKey)
    if (existing) {
      recordApiMetric('dedupCoalesced')
      return existing as Promise<T>
    }
  }

  const exec = async (): Promise<T> => {
    recordApiMetric('requestsTotal')
    let attempts = 0
    const maxAttempts = 1 + parsedOpts.retries

    while (attempts < maxAttempts) {
      attempts++
      const controller = new AbortController()
      let isTimeout = false
      const timer = setTimeout(() => {
        isTimeout = true
        recordApiMetric('timeoutsTriggered')
        controller.abort()
      }, parsedOpts.timeoutMs)

      if (options.signal) {
        options.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            controller.abort()
          },
          { once: true },
        )
      }

      try {
        const headers: Record<string, string> = {
          Accept: 'application/json',
          ...(options.headers as Record<string, string> | undefined),
        }

        if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
          headers['Content-Type'] = 'application/json'
        }

        const response = await fetch(url, {
          ...options,
          headers,
          signal: controller.signal,
        })
        clearTimeout(timer)

        if (!response.ok) {
          let errorDetails: unknown
          const text = await response.text().catch(() => '')
          try {
            errorDetails = text ? JSON.parse(text) : undefined
          } catch {
            errorDetails = text
          }

          const message =
            typeof errorDetails === 'object' && errorDetails !== null && 'error' in errorDetails
              ? String((errorDetails as { error: unknown }).error)
              : typeof errorDetails === 'string' &&
                  errorDetails.trim().length > 0 &&
                  !errorDetails.startsWith('<!DOCTYPE')
                ? errorDetails
                : `Request failed with status ${response.status}: ${response.statusText}`

          // 5xx errors can be retried if attempts remain
          if (response.status >= 500 && attempts < maxAttempts) {
            recordApiMetric('retriesAttempted')
            const jitter = Math.random() * 50
            await new Promise((r) => setTimeout(r, parsedOpts.retryDelayMs * attempts + jitter))
            continue
          }

          throw new ApiError(message, response.status, errorDetails)
        }

        recordApiMetric('requestsSuccessful')
        return (await response.json()) as T
      } catch (err: unknown) {
        clearTimeout(timer)
        if (options.signal?.aborted) {
          throw err
        }

        if (isTimeout) {
          recordApiMetric('requestsFailed')
          throw new ApiError(`Request timed out after ${parsedOpts.timeoutMs}ms`, 408)
        }

        // Network error retry
        if (!(err instanceof ApiError) && attempts < maxAttempts) {
          recordApiMetric('retriesAttempted')
          const jitter = Math.random() * 50
          await new Promise((r) => setTimeout(r, parsedOpts.retryDelayMs * attempts + jitter))
          continue
        }

        recordApiMetric('requestsFailed')
        throw err
      }
    }

    throw new ApiError('Request failed after max retry attempts', 500)
  }

  const promise = exec()
  if (dedupKey) {
    inFlightMap.set(dedupKey, promise)
    promise.finally(() => {
      inFlightMap.delete(dedupKey)
    })
  }

  return promise
}
