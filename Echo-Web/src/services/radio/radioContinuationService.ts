import {
  radioContinuationInputSchema,
  radioContinuationResponseSchema,
  radioRetryOptionsSchema,
  type RadioContinuationInput,
  type RadioContinuationResponse,
  type RadioRetryOptions,
  type RadioContinuationState,
} from './radioContinuationTypes.ts'

export class RadioContinuationService {
  private state: RadioContinuationState = {
    status: 'idle',
    attempt: 0,
    maxRetries: 3,
    nextRetryDelayMs: null,
    lastError: null,
    metrics: {
      totalAttempts: 0,
      successCount: 0,
      retryAttempts: 0,
      successAfterRetryCount: 0,
      failureCount: 0,
      lastErrorReason: null,
      lastDurationMs: 0,
    },
  }

  private inFlightMap = new Map<string, Promise<RadioContinuationResponse>>()
  private listeners = new Set<(state: RadioContinuationState) => void>()

  public getState(): Readonly<RadioContinuationState> {
    return {
      ...this.state,
      metrics: { ...this.state.metrics },
    }
  }

  public subscribe(listener: (state: RadioContinuationState) => void): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    const s = this.getState()
    for (const listener of this.listeners) {
      listener(s)
    }
  }

  public computeBackoff(attempt: number, initialMs = 800, maxMs = 8000): number {
    const base = Math.min(maxMs, initialMs * Math.pow(2, attempt))
    const jitter = Math.random() * 300
    return Math.round(base + jitter)
  }

  public async fetchWithRetry(
    rawInput: RadioContinuationInput,
    rawOptions?: Partial<RadioRetryOptions>,
    parentSignal?: AbortSignal,
  ): Promise<RadioContinuationResponse> {
    const input = radioContinuationInputSchema.parse(rawInput)
    const options = radioRetryOptionsSchema.parse(rawOptions ?? {})
    const key = `${input.videoId ?? ''}:${input.continuationToken ?? ''}:${input.region}:${input.explicit}`

    const existing = this.inFlightMap.get(key)
    if (existing) return existing

    const promise = this.executeFetchWithRetry(input, options, parentSignal)
    this.inFlightMap.set(key, promise)

    try {
      return await promise
    } finally {
      this.inFlightMap.delete(key)
    }
  }

  private async executeFetchWithRetry(
    input: RadioContinuationInput,
    options: RadioRetryOptions,
    parentSignal?: AbortSignal,
  ): Promise<RadioContinuationResponse> {
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now()
    this.state.maxRetries = options.maxRetries
    this.state.attempt = 0
    this.state.lastError = null
    this.state.nextRetryDelayMs = null

    for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
      if (parentSignal?.aborted) {
        this.state.status = 'idle'
        this.emit()
        throw new Error('Radio continuation aborted')
      }

      this.state.attempt = attempt
      this.state.status = attempt === 0 ? 'fetching' : 'retrying'
      this.state.metrics.totalAttempts++
      if (attempt > 0) {
        this.state.metrics.retryAttempts++
      }
      this.emit()

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs)
      const onParentAbort = () => controller.abort()
      if (parentSignal) {
        parentSignal.addEventListener('abort', onParentAbort, { once: true })
      }

      try {
        const queryParams = new URLSearchParams()
        if (input.continuationToken) {
          queryParams.set('continuation', input.continuationToken)
        } else if (input.videoId) {
          queryParams.set('videoId', input.videoId)
        }
        queryParams.set('gl', input.region)
        queryParams.set('explicit', String(input.explicit))

        const res = await fetch(`/api/radio/continuation?${queryParams.toString()}`, {
          signal: controller.signal,
        })

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText || 'Radio continuation failed'}`)
        }

        const json = await res.json()
        const validated = radioContinuationResponseSchema.parse(json)

        clearTimeout(timeoutId)
        if (parentSignal) {
          parentSignal.removeEventListener('abort', onParentAbort)
        }

        const duration =
          (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start
        this.state.status = 'idle'
        this.state.nextRetryDelayMs = null
        this.state.lastError = null
        this.state.metrics.successCount++
        if (attempt > 0) {
          this.state.metrics.successAfterRetryCount++
        }
        this.state.metrics.lastDurationMs = duration
        this.emit()

        return validated
      } catch (err: unknown) {
        clearTimeout(timeoutId)
        if (parentSignal) {
          parentSignal.removeEventListener('abort', onParentAbort)
        }

        const errorMsg = err instanceof Error ? err.message : String(err)
        this.state.lastError = errorMsg
        this.state.metrics.lastErrorReason = errorMsg

        if (parentSignal?.aborted) {
          this.state.status = 'idle'
          this.emit()
          throw err
        }

        if (attempt < options.maxRetries) {
          const delay = this.computeBackoff(
            attempt,
            options.initialBackoffMs,
            options.maxBackoffMs,
          )
          this.state.nextRetryDelayMs = delay
          this.state.status = 'retrying'
          this.emit()

          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, delay)
            if (parentSignal) {
              parentSignal.addEventListener(
                'abort',
                () => {
                  clearTimeout(timer)
                  resolve()
                },
                { once: true },
              )
            }
          })
        } else {
          // All retries exhausted
          const duration =
            (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start
          this.state.status = 'exhausted'
          this.state.nextRetryDelayMs = null
          this.state.metrics.failureCount++
          this.state.metrics.lastDurationMs = duration
          this.emit()
          throw new Error(
            `Radio continuation failed after ${options.maxRetries + 1} attempts: ${errorMsg}`,
          )
        }
      }
    }

    throw new Error('Radio continuation exhausted')
  }

  public reset(): void {
    this.inFlightMap.clear()
    this.state.status = 'idle'
    this.state.attempt = 0
    this.state.nextRetryDelayMs = null
    this.state.lastError = null
    this.emit()
  }

  public resetMetrics(): void {
    this.state.metrics = {
      totalAttempts: 0,
      successCount: 0,
      retryAttempts: 0,
      successAfterRetryCount: 0,
      failureCount: 0,
      lastErrorReason: null,
      lastDurationMs: 0,
    }
  }
}

export const radioContinuationService = new RadioContinuationService()
