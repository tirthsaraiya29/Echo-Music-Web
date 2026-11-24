/**
 * AI lyrics translation service.
 *
 * Responsibilities:
 * - Coordinates translation of lyric lines across multiple LLM and translation providers:
 *   OpenRouter, DeepL, Mistral, OpenAI-Compatible, Anthropic Claude, and Google Gemini.
 * - In-memory deduplication cache mapping language + text hash to translated line arrays.
 * - In-flight coalescing: merges concurrent translation calls for identical payloads into one operation.
 * - Runtime schema validation via Zod for configuration payloads and translation requests.
 * - Bounded timeouts (12000ms) with cooperative AbortSignal cancellation support.
 * - Instrumentation of latency, provider breakdown, cache hit ratios, and failure reasons.
 */

import { z } from 'zod'
import type { LyricLine } from '../../types/lyrics.ts'

// --- Runtime Schemas ---

export const aiProviderSchema = z.enum([
  'openrouter',
  'deepl',
  'mistral',
  'openai-compatible',
  'anthropic',
  'gemini',
])

export type AIProvider = z.infer<typeof aiProviderSchema>

export const aiKeysConfigSchema = z.object({
  provider: aiProviderSchema,
  openRouterKey: z.string().optional(),
  openRouterModel: z.string().optional(),
  deepLKey: z.string().optional(),
  deepLPlan: z.enum(['free', 'pro']).optional(),
  mistralKey: z.string().optional(),
  mistralModel: z.string().optional(),
  openAiBaseUrl: z.string().url().or(z.string().min(1)).optional(),
  openAiKey: z.string().optional(),
  openAiModel: z.string().optional(),
  anthropicKey: z.string().optional(),
  anthropicModel: z.string().optional(),
  geminiKey: z.string().optional(),
  geminiModel: z.string().optional(),
  targetLanguage: z.string().min(1).default('English'),
  translationChunkSize: z.number().int().min(5).max(100).optional().default(30),
  maxChunkRetries: z.number().int().min(0).max(5).optional().default(2),
})

export type AIKeysConfig = z.infer<typeof aiKeysConfigSchema>

export const connectionTestResultSchema = z.object({
  ok: z.boolean(),
  provider: aiProviderSchema,
  latencyMs: z.number().nonnegative(),
  message: z.string(),
  model: z.string().optional(),
  error: z.string().optional(),
  statusCode: z.number().int().optional(),
})

export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>

export const discoveredModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  contextLength: z.number().int().optional(),
})

export type DiscoveredModel = z.infer<typeof discoveredModelSchema>

export const CURATED_MODELS_BY_PROVIDER: Record<AIProvider, Array<{ id: string; name: string }>> = {
  openrouter: [
    { id: 'google/gemini-2.0-flash-001', name: 'Google Gemini 2.0 Flash' },
    { id: 'openrouter/free', name: 'OpenRouter Free Tier' },
    { id: 'google/gemini-2.5-flash', name: 'Google Gemini 2.5 Flash' },
    { id: 'openai/gpt-4o-mini', name: 'OpenAI GPT-4o Mini' },
    { id: 'x-ai/grok-4.1-fast', name: 'xAI Grok 4.1 Fast' },
    { id: 'deepseek/deepseek-v3.1-terminus:exacto', name: 'DeepSeek V3.1 Terminus' },
  ],
  deepl: [],
  mistral: [
    { id: 'mistral-small-latest', name: 'Mistral Small (Latest)' },
    { id: 'mistral-medium-latest', name: 'Mistral Medium (Latest)' },
    { id: 'mistral-large-latest', name: 'Mistral Large (Latest)' },
  ],
  'openai-compatible': [
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
  ],
  anthropic: [
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
    { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku' },
    { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet' },
  ],
  gemini: [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  ],
}

export const translationMetricsSchema = z.object({
  totalTranslations: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
  networkTranslations: z.number().int().nonnegative(),
  coalescedRequests: z.number().int().nonnegative(),
  chunksProcessed: z.number().int().nonnegative().optional(),
  chunkRetries: z.number().int().nonnegative().optional(),
  chunkFailures: z.number().int().nonnegative().optional(),
  partialTranslationsDelivered: z.number().int().nonnegative().optional(),
  connectionTestsRun: z.number().int().nonnegative().optional(),
  connectionTestsSuccessful: z.number().int().nonnegative().optional(),
  connectionTestsFailed: z.number().int().nonnegative().optional(),
  modelDiscoveriesRun: z.number().int().nonnegative().optional(),
  modelsDiscoveredCount: z.number().int().nonnegative().optional(),
  providerCounts: z.record(z.string(), z.number().int().nonnegative()),
  failuresByReason: z.record(z.string(), z.number().int().nonnegative()),
  avgLatencyMs: z.number().nonnegative(),
  lastLatencyMs: z.number().nonnegative(),
})

export type TranslationMetrics = z.infer<typeof translationMetricsSchema>

export type TranslationStatus = 'idle' | 'translating' | 'translated' | 'cached' | 'error'

export interface LyricChunk {
  chunkIndex: number
  startIndex: number
  endIndex: number
  texts: string[]
}

export function chunkTexts(texts: string[], chunkSize: number = 30): LyricChunk[] {
  if (texts.length === 0) return []
  const validChunkSize = Math.max(1, chunkSize)
  const chunks: LyricChunk[] = []
  for (let i = 0; i < texts.length; i += validChunkSize) {
    const slice = texts.slice(i, i + validChunkSize)
    chunks.push({
      chunkIndex: chunks.length,
      startIndex: i,
      endIndex: i + slice.length,
      texts: slice,
    })
  }
  return chunks
}

const STORAGE_KEY = 'echo_ai_keys'

const DEFAULT_CONFIG: AIKeysConfig = {
  provider: 'openrouter',
  openRouterModel: 'google/gemini-2.0-flash-001',
  targetLanguage: 'English',
  translationChunkSize: 30,
  maxChunkRetries: 2,
}

// Module-level metrics singleton
let translationMetrics: TranslationMetrics = {
  totalTranslations: 0,
  cacheHits: 0,
  networkTranslations: 0,
  coalescedRequests: 0,
  chunksProcessed: 0,
  chunkRetries: 0,
  chunkFailures: 0,
  partialTranslationsDelivered: 0,
  connectionTestsRun: 0,
  connectionTestsSuccessful: 0,
  connectionTestsFailed: 0,
  modelDiscoveriesRun: 0,
  modelsDiscoveredCount: 0,
  providerCounts: {
    openrouter: 0,
    deepl: 0,
    mistral: 0,
    'openai-compatible': 0,
    anthropic: 0,
    gemini: 0,
  },
  failuresByReason: {},
  avgLatencyMs: 0,
  lastLatencyMs: 0,
}

export function getTranslationMetrics(): TranslationMetrics {
  return {
    ...translationMetrics,
    providerCounts: { ...translationMetrics.providerCounts },
    failuresByReason: { ...translationMetrics.failuresByReason },
  }
}

export function resetTranslationMetrics(): void {
  translationMetrics = {
    totalTranslations: 0,
    cacheHits: 0,
    networkTranslations: 0,
    coalescedRequests: 0,
    chunksProcessed: 0,
    chunkRetries: 0,
    chunkFailures: 0,
    partialTranslationsDelivered: 0,
    connectionTestsRun: 0,
    connectionTestsSuccessful: 0,
    connectionTestsFailed: 0,
    modelDiscoveriesRun: 0,
    modelsDiscoveredCount: 0,
    providerCounts: {
      openrouter: 0,
      deepl: 0,
      mistral: 0,
      'openai-compatible': 0,
      anthropic: 0,
      gemini: 0,
    },
    failuresByReason: {},
    avgLatencyMs: 0,
    lastLatencyMs: 0,
  }
}

export class TranslationClient {
  public static readonly TRANSLATION_TIMEOUT_MS = 12000

  private static instance: TranslationClient | null = null
  private translationCache = new Map<string, string[]>()
  private inFlightTranslations = new Map<string, Promise<LyricLine[]>>()
  private currentAbortController: AbortController | null = null

  public static getInstance(): TranslationClient {
    if (!TranslationClient.instance) {
      TranslationClient.instance = new TranslationClient()
    }
    return TranslationClient.instance
  }

  public getConfig(): AIKeysConfig {
    try {
      if (typeof localStorage === 'undefined') return DEFAULT_CONFIG
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        const validated = aiKeysConfigSchema.safeParse({ ...DEFAULT_CONFIG, ...parsed })
        if (validated.success) {
          return validated.data
        }
      }
    } catch {
      // Fallback to default config
    }
    return DEFAULT_CONFIG
  }

  public saveConfig(config: Partial<AIKeysConfig>): void {
    try {
      if (typeof localStorage === 'undefined') return
      const current = this.getConfig()
      const merged = { ...current, ...config }
      const validated = aiKeysConfigSchema.safeParse(merged)
      if (validated.success) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(validated.data))
      }
    } catch {
      // Ignore write errors
    }
  }

  public hasConfiguredKey(): boolean {
    const config = this.getConfig()
    switch (config.provider) {
      case 'openrouter':
        return Boolean(config.openRouterKey?.trim())
      case 'deepl':
        return Boolean(config.deepLKey?.trim())
      case 'mistral':
        return Boolean(config.mistralKey?.trim())
      case 'openai-compatible':
        return Boolean(config.openAiKey?.trim() && config.openAiBaseUrl?.trim())
      case 'anthropic':
        return Boolean(config.anthropicKey?.trim())
      case 'gemini':
        return Boolean(config.geminiKey?.trim())
      default:
        return false
    }
  }

  public cancelOngoingTranslation(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }
  }

  public clearCache(): void {
    this.translationCache.clear()
    this.inFlightTranslations.clear()
  }

  public getCuratedModels(provider: AIProvider): Array<{ id: string; name: string }> {
    return CURATED_MODELS_BY_PROVIDER[provider] || []
  }

  public async testConnection(
    overrideConfig?: Partial<AIKeysConfig>,
    signal?: AbortSignal,
  ): Promise<ConnectionTestResult> {
    const config = { ...this.getConfig(), ...overrideConfig }
    const startTime = performance.now()
    translationMetrics.connectionTestsRun = (translationMetrics.connectionTestsRun || 0) + 1

    try {
      if (config.provider === 'deepl') {
        const key = config.deepLKey?.trim()
        if (!key) throw new Error('DeepL auth key is not configured.')
        const host =
          config.deepLPlan === 'pro'
            ? 'https://api.deepl.com/v2/usage'
            : 'https://api-free.deepl.com/v2/usage'

        const res = await this.fetchWithTimeout(
          host,
          {
            method: 'GET',
            headers: { Authorization: `DeepL-Auth-Key ${key}` },
          },
          signal,
          8000,
        )

        const latencyMs = Math.round(performance.now() - startTime)
        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`DeepL connection failed (${res.status}): ${errText}`)
        }

        translationMetrics.connectionTestsSuccessful =
          (translationMetrics.connectionTestsSuccessful || 0) + 1
        return {
          ok: true,
          provider: 'deepl',
          latencyMs,
          message: 'Connected to DeepL API successfully',
          statusCode: res.status,
        }
      }

      if (config.provider === 'openrouter') {
        const key = config.openRouterKey?.trim()
        if (!key) throw new Error('OpenRouter API key is not configured.')
        const model = config.openRouterModel || 'google/gemini-2.0-flash-001'

        const res = await this.fetchWithTimeout(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 5,
            }),
          },
          signal,
          8000,
        )

        const latencyMs = Math.round(performance.now() - startTime)
        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`OpenRouter connection failed (${res.status}): ${errText}`)
        }

        translationMetrics.connectionTestsSuccessful =
          (translationMetrics.connectionTestsSuccessful || 0) + 1
        return {
          ok: true,
          provider: 'openrouter',
          latencyMs,
          message: `Connected to OpenRouter using ${model}`,
          model,
          statusCode: res.status,
        }
      }

      if (config.provider === 'mistral') {
        const key = config.mistralKey?.trim()
        if (!key) throw new Error('Mistral API key is not configured.')
        const model = config.mistralModel || 'mistral-small-latest'

        const res = await this.fetchWithTimeout(
          'https://api.mistral.ai/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 5,
            }),
          },
          signal,
          8000,
        )

        const latencyMs = Math.round(performance.now() - startTime)
        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`Mistral connection failed (${res.status}): ${errText}`)
        }

        translationMetrics.connectionTestsSuccessful =
          (translationMetrics.connectionTestsSuccessful || 0) + 1
        return {
          ok: true,
          provider: 'mistral',
          latencyMs,
          message: `Connected to Mistral using ${model}`,
          model,
          statusCode: res.status,
        }
      }

      if (config.provider === 'openai-compatible') {
        const key = config.openAiKey?.trim()
        const baseUrl = config.openAiBaseUrl?.trim().replace(/\/+$/, '')
        if (!key || !baseUrl) throw new Error('OpenAI-compatible Base URL and API key are required.')
        const model = config.openAiModel || 'gpt-4o-mini'

        const res = await this.fetchWithTimeout(
          `${baseUrl}/chat/completions`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 5,
            }),
          },
          signal,
          8000,
        )

        const latencyMs = Math.round(performance.now() - startTime)
        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`OpenAI-compatible connection failed (${res.status}): ${errText}`)
        }

        translationMetrics.connectionTestsSuccessful =
          (translationMetrics.connectionTestsSuccessful || 0) + 1
        return {
          ok: true,
          provider: 'openai-compatible',
          latencyMs,
          message: `Connected to OpenAI-compatible endpoint using ${model}`,
          model,
          statusCode: res.status,
        }
      }

      if (config.provider === 'anthropic') {
        const key = config.anthropicKey?.trim()
        if (!key) throw new Error('Anthropic API key is not configured.')
        const model = config.anthropicModel || 'claude-haiku-4-5'

        const res = await this.fetchWithTimeout(
          'https://api.anthropic.com/v1/messages',
          {
            method: 'POST',
            headers: {
              'x-api-key': key,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 5,
            }),
          },
          signal,
          8000,
        )

        const latencyMs = Math.round(performance.now() - startTime)
        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`Anthropic connection failed (${res.status}): ${errText}`)
        }

        translationMetrics.connectionTestsSuccessful =
          (translationMetrics.connectionTestsSuccessful || 0) + 1
        return {
          ok: true,
          provider: 'anthropic',
          latencyMs,
          message: `Connected to Anthropic using ${model}`,
          model,
          statusCode: res.status,
        }
      }

      if (config.provider === 'gemini') {
        const key = config.geminiKey?.trim()
        if (!key) throw new Error('Google Gemini API key is not configured.')
        const model = config.geminiModel || 'gemini-2.0-flash'

        const res = await this.fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: 'POST',
            headers: {
              'x-goog-api-key': key,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
              generationConfig: { maxOutputTokens: 5 },
            }),
          },
          signal,
          8000,
        )

        const latencyMs = Math.round(performance.now() - startTime)
        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`Gemini connection failed (${res.status}): ${errText}`)
        }

        translationMetrics.connectionTestsSuccessful =
          (translationMetrics.connectionTestsSuccessful || 0) + 1
        return {
          ok: true,
          provider: 'gemini',
          latencyMs,
          message: `Connected to Gemini using ${model}`,
          model,
          statusCode: res.status,
        }
      }

      throw new Error(`Unsupported provider: ${config.provider}`)
    } catch (err: unknown) {
      const latencyMs = Math.round(performance.now() - startTime)
      const errorMsg = err instanceof Error ? err.message : String(err)
      translationMetrics.connectionTestsFailed =
        (translationMetrics.connectionTestsFailed || 0) + 1
      return {
        ok: false,
        provider: config.provider,
        latencyMs,
        message: 'Connection test failed',
        error: errorMsg,
      }
    }
  }

  public async discoverModels(
    provider?: AIProvider,
    overrideConfig?: Partial<AIKeysConfig>,
    signal?: AbortSignal,
  ): Promise<DiscoveredModel[]> {
    const config = { ...this.getConfig(), ...overrideConfig }
    const targetProvider = provider || config.provider
    translationMetrics.modelDiscoveriesRun = (translationMetrics.modelDiscoveriesRun || 0) + 1

    try {
      if (targetProvider === 'openrouter') {
        const res = await this.fetchWithTimeout(
          'https://openrouter.ai/api/v1/models',
          { method: 'GET' },
          signal,
          8000,
        )
        if (res.ok) {
          const json = (await res.json()) as {
            data?: Array<{
              id: string
              name?: string
              description?: string
              context_length?: number
            }>
          }
          if (Array.isArray(json.data) && json.data.length > 0) {
            const models = json.data.slice(0, 50).map((m) => ({
              id: m.id,
              name: m.name || m.id,
              description: m.description,
              contextLength: m.context_length,
            }))
            translationMetrics.modelsDiscoveredCount =
              (translationMetrics.modelsDiscoveredCount || 0) + models.length
            return models
          }
        }
      }

      if (targetProvider === 'mistral') {
        const key = config.mistralKey?.trim()
        if (key) {
          const res = await this.fetchWithTimeout(
            'https://api.mistral.ai/v1/models',
            {
              method: 'GET',
              headers: { Authorization: `Bearer ${key}` },
            },
            signal,
            8000,
          )
          if (res.ok) {
            const json = (await res.json()) as { data?: Array<{ id: string }> }
            if (Array.isArray(json.data) && json.data.length > 0) {
              const models = json.data.map((m) => ({ id: m.id, name: m.id }))
              translationMetrics.modelsDiscoveredCount =
                (translationMetrics.modelsDiscoveredCount || 0) + models.length
              return models
            }
          }
        }
      }

      if (targetProvider === 'openai-compatible') {
        const key = config.openAiKey?.trim()
        const baseUrl = config.openAiBaseUrl?.trim().replace(/\/+$/, '')
        if (key && baseUrl) {
          const res = await this.fetchWithTimeout(
            `${baseUrl}/models`,
            {
              method: 'GET',
              headers: { Authorization: `Bearer ${key}` },
            },
            signal,
            8000,
          )
          if (res.ok) {
            const json = (await res.json()) as { data?: Array<{ id: string }> }
            if (Array.isArray(json.data) && json.data.length > 0) {
              const models = json.data.map((m) => ({ id: m.id, name: m.id }))
              translationMetrics.modelsDiscoveredCount =
                (translationMetrics.modelsDiscoveredCount || 0) + models.length
              return models
            }
          }
        }
      }

      if (targetProvider === 'gemini') {
        const key = config.geminiKey?.trim()
        if (key) {
          const res = await this.fetchWithTimeout(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
            { method: 'GET' },
            signal,
            8000,
          )
          if (res.ok) {
            const json = (await res.json()) as {
              models?: Array<{ name: string; displayName?: string; description?: string }>
            }
            if (Array.isArray(json.models) && json.models.length > 0) {
              const models = json.models
                .filter((m) => m.name.includes('gemini'))
                .map((m) => ({
                  id: m.name.replace(/^models\//, ''),
                  name: m.displayName || m.name.replace(/^models\//, ''),
                  description: m.description,
                }))
              translationMetrics.modelsDiscoveredCount =
                (translationMetrics.modelsDiscoveredCount || 0) + models.length
              return models
            }
          }
        }
      }
    } catch {
      // Fallback to curated catalog
    }

    const curated = CURATED_MODELS_BY_PROVIDER[targetProvider] || []
    translationMetrics.modelsDiscoveredCount =
      (translationMetrics.modelsDiscoveredCount || 0) + curated.length
    return curated.map((m) => ({ id: m.id, name: m.name }))
  }

  public async translateLyrics(
    lines: LyricLine[],
    overrideConfig?: Partial<AIKeysConfig>,
    externalSignal?: AbortSignal,
  ): Promise<LyricLine[]> {
    if (!lines || lines.length === 0) return lines

    const startTime = performance.now()
    translationMetrics.totalTranslations++

    const config = { ...this.getConfig(), ...overrideConfig }
    const nonEmptyIndices: number[] = []
    const textsToTranslate: string[] = []

    lines.forEach((line, idx) => {
      if (line.text && line.text.trim()) {
        nonEmptyIndices.push(idx)
        textsToTranslate.push(line.text.trim())
      }
    })

    if (textsToTranslate.length === 0) return lines

    const cacheKey = `${config.targetLanguage}:${config.provider}:${textsToTranslate.join('|')}`

    // 1. Memory cache inspection
    if (this.translationCache.has(cacheKey)) {
      translationMetrics.cacheHits++
      this.recordLatency(performance.now() - startTime)
      const cached = this.translationCache.get(cacheKey)!
      return lines.map((line, idx) => {
        const itemIdx = nonEmptyIndices.indexOf(idx)
        if (itemIdx !== -1 && cached[itemIdx]) {
          return { ...line, translatedText: cached[itemIdx] }
        }
        return line
      })
    }

    // 2. In-flight coalescing
    const inFlight = this.inFlightTranslations.get(cacheKey)
    if (inFlight) {
      translationMetrics.coalescedRequests++
      return inFlight
    }

    // 3. Cooperative cancellation setup
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }

    const abortController = new AbortController()
    this.currentAbortController = abortController

    const onExternalAbort = () => abortController.abort()
    if (externalSignal) {
      if (externalSignal.aborted) {
        abortController.abort()
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true })
      }
    }

    translationMetrics.networkTranslations++

    const translationPromise = (async (): Promise<LyricLine[]> => {
      const signal = abortController.signal

      try {
        const chunkSize = config.translationChunkSize || 30
        const chunks = chunkTexts(textsToTranslate, chunkSize)
        translationMetrics.chunksProcessed =
          (translationMetrics.chunksProcessed || 0) + chunks.length

        const translatedStrings: string[] = new Array(textsToTranslate.length).fill('')
        let successfulChunks = 0
        let failedChunks = 0
        let firstError: unknown = null

        for (const chunk of chunks) {
          try {
            const chunkResult = await this.executeChunkWithRetry(chunk, config, signal)
            for (let i = 0; i < chunk.texts.length; i++) {
              translatedStrings[chunk.startIndex + i] = chunkResult[i] || ''
            }
            successfulChunks++
          } catch (err) {
            failedChunks++
            if (!firstError) firstError = err
            if (chunks.length === 1) {
              throw err
            }
          }
        }

        if (successfulChunks === 0 && failedChunks > 0) {
          throw firstError || new Error('All lyric translation chunks failed')
        }

        if (failedChunks > 0 && successfulChunks > 0) {
          translationMetrics.partialTranslationsDelivered =
            (translationMetrics.partialTranslationsDelivered || 0) + 1
        }

        const hasAnyTranslation = translatedStrings.some((s) => s.trim().length > 0)
        if (hasAnyTranslation) {
          this.translationCache.set(cacheKey, translatedStrings)
          translationMetrics.providerCounts[config.provider] =
            (translationMetrics.providerCounts[config.provider] || 0) + 1

          return lines.map((line, idx) => {
            const itemIdx = nonEmptyIndices.indexOf(idx)
            if (itemIdx !== -1 && translatedStrings[itemIdx]) {
              return { ...line, translatedText: translatedStrings[itemIdx] }
            }
            return line
          })
        }

        return lines
      } catch (err: unknown) {
        if (signal.aborted) {
          this.recordFailure('aborted')
        } else {
          const reason = err instanceof Error ? err.message : String(err)
          this.recordFailure(reason.includes('timeout') ? 'timeout' : 'network_error')
        }
        throw err
      } finally {
        this.recordLatency(performance.now() - startTime)
        if (externalSignal) {
          externalSignal.removeEventListener('abort', onExternalAbort)
        }
        if (this.currentAbortController === abortController) {
          this.currentAbortController = null
        }
      }
    })().finally(() => {
      this.inFlightTranslations.delete(cacheKey)
    })

    this.inFlightTranslations.set(cacheKey, translationPromise)
    return translationPromise
  }

  private async executeChunkWithRetry(
    chunk: LyricChunk,
    config: AIKeysConfig,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const maxRetries = config.maxChunkRetries ?? 2
    let attempt = 0
    let lastError: unknown = null

    while (attempt <= maxRetries) {
      if (signal?.aborted) {
        throw new Error('Translation aborted')
      }

      try {
        let chunkTranslations: string[] = []
        if (config.provider === 'deepl') {
          chunkTranslations = await this.translateWithDeepL(chunk.texts, config, signal)
        } else if (config.provider === 'mistral') {
          chunkTranslations = await this.translateWithMistral(
            chunk.texts,
            config,
            chunk.startIndex,
            signal,
          )
        } else if (config.provider === 'openai-compatible') {
          chunkTranslations = await this.translateWithOpenAICompatible(
            chunk.texts,
            config,
            chunk.startIndex,
            signal,
          )
        } else if (config.provider === 'anthropic') {
          chunkTranslations = await this.translateWithAnthropic(
            chunk.texts,
            config,
            chunk.startIndex,
            signal,
          )
        } else if (config.provider === 'gemini') {
          chunkTranslations = await this.translateWithGemini(
            chunk.texts,
            config,
            chunk.startIndex,
            signal,
          )
        } else {
          chunkTranslations = await this.translateWithOpenRouter(
            chunk.texts,
            config,
            chunk.startIndex,
            signal,
          )
        }

        if (chunkTranslations && chunkTranslations.length > 0) {
          return chunkTranslations
        }
        throw new Error(`Chunk ${chunk.chunkIndex} returned empty translation`)
      } catch (err: unknown) {
        lastError = err
        attempt++
        if (attempt <= maxRetries && !signal?.aborted) {
          translationMetrics.chunkRetries = (translationMetrics.chunkRetries || 0) + 1
          const backoffMs = Math.min(300 * Math.pow(2, attempt - 1), 2000)
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, backoffMs)
            signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer)
                reject(new Error('Translation aborted'))
              },
              { once: true },
            )
          })
        }
      }
    }

    translationMetrics.chunkFailures = (translationMetrics.chunkFailures || 0) + 1
    throw lastError || new Error(`Chunk ${chunk.chunkIndex} failed after ${maxRetries} retries`)
  }

  private async translateWithOpenRouter(
    texts: string[],
    config: AIKeysConfig,
    startIndex: number = 0,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const key = config.openRouterKey?.trim()
    if (!key) throw new Error('OpenRouter API key is missing. Set your key in Lyrics Settings.')

    const indexedLines: Record<string, string> = {}
    texts.forEach((text, i) => {
      indexedLines[String(startIndex + i)] = text
    })

    const model = config.openRouterModel || 'google/gemini-2.0-flash-001'
    const prompt = `Translate the following song lyric lines into ${config.targetLanguage}.
Maintain the poetic sentiment and rhythmic feel.
You MUST reply with a single valid JSON object mapping each line index to its translated string.
Format:
{
  "${startIndex}": "Translated line ${startIndex}",
  "${startIndex + 1}": "Translated line ${startIndex + 1}"
}
Do NOT wrap in markdown codeblocks if possible, or return raw JSON.

Lines to translate:
${JSON.stringify(indexedLines, null, 2)}`

    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost'

    const res = await this.fetchWithTimeout(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': origin,
          'X-Title': 'Echo Music Web',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                'You are a professional music and lyric translator. You respond only with valid JSON mappings.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' },
        }),
      },
      signal,
    )

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`OpenRouter translation failed (${res.status}): ${err}`)
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content || '{}'
    return this.parseIndexedJson(content, texts.length, startIndex)
  }

  private async translateWithMistral(
    texts: string[],
    config: AIKeysConfig,
    startIndex: number = 0,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const key = config.mistralKey?.trim()
    if (!key) throw new Error('Mistral API key is missing. Set your key in Lyrics Settings.')

    const indexedLines: Record<string, string> = {}
    texts.forEach((text, i) => {
      indexedLines[String(startIndex + i)] = text
    })

    const model = config.mistralModel || 'mistral-small-latest'
    const prompt = `Translate the following song lyric lines into ${config.targetLanguage}.
Respond ONLY with a JSON object mapping string index to translation:
{
  "${startIndex}": "Translated line ${startIndex}"
}

Input:
${JSON.stringify(indexedLines, null, 2)}`

    const res = await this.fetchWithTimeout(
      'https://api.mistral.ai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          response_format: { type: 'json_object' },
        }),
      },
      signal,
    )

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Mistral translation failed (${res.status}): ${err}`)
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content || '{}'
    return this.parseIndexedJson(content, texts.length, startIndex)
  }

  private async translateWithOpenAICompatible(
    texts: string[],
    config: AIKeysConfig,
    startIndex: number = 0,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const key = config.openAiKey?.trim()
    const baseUrl = config.openAiBaseUrl?.trim().replace(/\/+$/, '')
    if (!key || !baseUrl) {
      throw new Error(
        'OpenAI-compatible endpoint and key are required. Set them in Lyrics Settings.',
      )
    }

    const indexedLines: Record<string, string> = {}
    texts.forEach((text, i) => {
      indexedLines[String(startIndex + i)] = text
    })

    const prompt = `Translate the following song lyric lines into ${config.targetLanguage}.
Respond ONLY with a JSON object mapping string index to translation:
{
  "${startIndex}": "Translated line ${startIndex}"
}

Input:
${JSON.stringify(indexedLines, null, 2)}`

    const res = await this.fetchWithTimeout(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.openAiModel || 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
        }),
      },
      signal,
    )

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`OpenAI-compatible translation failed (${res.status}): ${err}`)
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content || '{}'
    return this.parseIndexedJson(content, texts.length, startIndex)
  }

  private async translateWithAnthropic(
    texts: string[],
    config: AIKeysConfig,
    startIndex: number = 0,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const key = config.anthropicKey?.trim()
    if (!key) throw new Error('Anthropic API key is missing. Set your key in Lyrics Settings.')

    const indexedLines: Record<string, string> = {}
    texts.forEach((text, i) => {
      indexedLines[String(startIndex + i)] = text
    })

    const model = config.anthropicModel || 'claude-haiku-4-5'
    const prompt = `Translate the following song lyric lines into ${config.targetLanguage}.
Respond ONLY with a JSON object mapping string index to translation:
{
  "${startIndex}": "Translated line ${startIndex}"
}

Input:
${JSON.stringify(indexedLines, null, 2)}`

    const res = await this.fetchWithTimeout(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 8192,
          system:
            'You are a professional music and lyric translator. You respond only with valid JSON mappings.',
          messages: [{ role: 'user', content: prompt }],
        }),
      },
      signal,
    )

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Anthropic translation failed (${res.status}): ${err}`)
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>
    }
    const content =
      data.content
        ?.filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('') || '{}'
    return this.parseIndexedJson(content, texts.length, startIndex)
  }

  private async translateWithGemini(
    texts: string[],
    config: AIKeysConfig,
    startIndex: number = 0,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const key = config.geminiKey?.trim()
    if (!key) throw new Error('Gemini API key is missing. Set your key in Lyrics Settings.')

    const indexedLines: Record<string, string> = {}
    texts.forEach((text, i) => {
      indexedLines[String(startIndex + i)] = text
    })

    const model = config.geminiModel || 'gemini-2.0-flash'
    const prompt = `Translate the following song lyric lines into ${config.targetLanguage}.
Respond ONLY with a JSON object mapping string index to translation:
{
  "${startIndex}": "Translated line ${startIndex}"
}

Input:
${JSON.stringify(indexedLines, null, 2)}`

    const res = await this.fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      },
      signal,
    )

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Gemini translation failed (${res.status}): ${err}`)
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const content = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}'
    return this.parseIndexedJson(content, texts.length, startIndex)
  }

  private async translateWithDeepL(
    texts: string[],
    config: AIKeysConfig,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const key = config.deepLKey?.trim()
    if (!key) throw new Error('DeepL API key is missing. Set your key in Lyrics Settings.')

    const host =
      config.deepLPlan === 'pro'
        ? 'https://api.deepl.com/v2/translate'
        : 'https://api-free.deepl.com/v2/translate'

    const targetLangCode = this.getDeepLLangCode(config.targetLanguage)

    const res = await this.fetchWithTimeout(
      host,
      {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: texts,
          target_lang: targetLangCode,
        }),
      },
      signal,
    )

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`DeepL translation failed (${res.status}): ${err}`)
    }

    const data = (await res.json()) as {
      translations?: Array<{ text: string }>
    }

    return (data.translations || []).map((t) => t.text)
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    parentSignal?: AbortSignal,
    timeoutMs: number = TranslationClient.TRANSLATION_TIMEOUT_MS,
  ): Promise<Response> {
    const timeoutController = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timeoutController.abort(new Error('TIMEOUT'))
    }, timeoutMs)

    const onParentAbort = () => {
      timeoutController.abort(parentSignal?.reason)
    }
    if (parentSignal) {
      parentSignal.addEventListener('abort', onParentAbort, { once: true })
    }

    try {
      return await fetch(url, {
        ...options,
        signal: timeoutController.signal,
      })
    } finally {
      if (timer) clearTimeout(timer)
      if (parentSignal) {
        parentSignal.removeEventListener('abort', onParentAbort)
      }
    }
  }

  public parseIndexedJson(content: string, count: number, startIndex: number = 0): string[] {
    try {
      const cleanJson = content
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim()
      const parsed = JSON.parse(cleanJson) as Record<string, string> | string[]

      if (Array.isArray(parsed)) {
        return parsed.map((s) => String(s || ''))
      }

      const result: string[] = []
      for (let i = 0; i < count; i++) {
        const absKey = String(startIndex + i)
        const relKey = String(i)
        const val = parsed[absKey] !== undefined ? parsed[absKey] : parsed[relKey]
        result.push(val ? String(val) : '')
      }
      return result
    } catch {
      return []
    }
  }

  private getDeepLLangCode(language: string): string {
    const map: Record<string, string> = {
      english: 'EN-US',
      spanish: 'ES',
      german: 'DE',
      french: 'FR',
      japanese: 'JA',
      chinese: 'ZH',
      italian: 'IT',
      portuguese: 'PT-BR',
      russian: 'RU',
      korean: 'KO',
    }
    return map[language.toLowerCase()] || 'EN-US'
  }

  private recordFailure(reason: string): void {
    translationMetrics.failuresByReason[reason] =
      (translationMetrics.failuresByReason[reason] || 0) + 1
  }

  private recordLatency(latencyMs: number): void {
    translationMetrics.lastLatencyMs = latencyMs
    const n = translationMetrics.totalTranslations
    translationMetrics.avgLatencyMs =
      n <= 1
        ? latencyMs
        : (translationMetrics.avgLatencyMs * (n - 1) + latencyMs) / n
  }
}
