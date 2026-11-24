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
})

export type AIKeysConfig = z.infer<typeof aiKeysConfigSchema>

export const translationMetricsSchema = z.object({
  totalTranslations: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
  networkTranslations: z.number().int().nonnegative(),
  coalescedRequests: z.number().int().nonnegative(),
  providerCounts: z.record(z.string(), z.number().int().nonnegative()),
  failuresByReason: z.record(z.string(), z.number().int().nonnegative()),
  avgLatencyMs: z.number().nonnegative(),
  lastLatencyMs: z.number().nonnegative(),
})

export type TranslationMetrics = z.infer<typeof translationMetricsSchema>

export type TranslationStatus = 'idle' | 'translating' | 'translated' | 'cached' | 'error'

const STORAGE_KEY = 'echo_ai_keys'

const DEFAULT_CONFIG: AIKeysConfig = {
  provider: 'openrouter',
  openRouterModel: 'google/gemini-2.0-flash-001',
  targetLanguage: 'English',
}

// Module-level metrics singleton
let translationMetrics: TranslationMetrics = {
  totalTranslations: 0,
  cacheHits: 0,
  networkTranslations: 0,
  coalescedRequests: 0,
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
        let translatedStrings: string[] = []

        if (config.provider === 'deepl') {
          translatedStrings = await this.translateWithDeepL(textsToTranslate, config, signal)
        } else if (config.provider === 'mistral') {
          translatedStrings = await this.translateWithMistral(textsToTranslate, config, signal)
        } else if (config.provider === 'openai-compatible') {
          translatedStrings = await this.translateWithOpenAICompatible(
            textsToTranslate,
            config,
            signal,
          )
        } else if (config.provider === 'anthropic') {
          translatedStrings = await this.translateWithAnthropic(textsToTranslate, config, signal)
        } else if (config.provider === 'gemini') {
          translatedStrings = await this.translateWithGemini(textsToTranslate, config, signal)
        } else {
          translatedStrings = await this.translateWithOpenRouter(textsToTranslate, config, signal)
        }

        if (translatedStrings.length > 0) {
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

  private async translateWithOpenRouter(
    texts: string[],
    config: AIKeysConfig,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const key = config.openRouterKey?.trim()
    if (!key) throw new Error('OpenRouter API key is missing. Set your key in Lyrics Settings.')

    const indexedLines: Record<string, string> = {}
    texts.forEach((text, i) => {
      indexedLines[String(i)] = text
    })

    const model = config.openRouterModel || 'google/gemini-2.0-flash-001'
    const prompt = `Translate the following song lyric lines into ${config.targetLanguage}.
Maintain the poetic sentiment and rhythmic feel.
You MUST reply with a single valid JSON object mapping each line index to its translated string.
Format:
{
  "0": "Translated line 0",
  "1": "Translated line 1"
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
    return this.parseIndexedJson(content, texts.length)
  }

  private async translateWithMistral(
    texts: string[],
    config: AIKeysConfig,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const key = config.mistralKey?.trim()
    if (!key) throw new Error('Mistral API key is missing. Set your key in Lyrics Settings.')

    const indexedLines: Record<string, string> = {}
    texts.forEach((text, i) => {
      indexedLines[String(i)] = text
    })

    const model = config.mistralModel || 'mistral-small-latest'
    const prompt = `Translate the following song lyric lines into ${config.targetLanguage}.
Respond ONLY with a JSON object mapping string index to translation:
{
  "0": "Translated line 0"
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
    return this.parseIndexedJson(content, texts.length)
  }

  private async translateWithOpenAICompatible(
    texts: string[],
    config: AIKeysConfig,
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
      indexedLines[String(i)] = text
    })

    const prompt = `Translate the following song lyric lines into ${config.targetLanguage}.
Respond ONLY with a JSON object mapping string index to translation:
{
  "0": "Translated line 0"
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
    return this.parseIndexedJson(content, texts.length)
  }

  private async translateWithAnthropic(
    texts: string[],
    config: AIKeysConfig,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const key = config.anthropicKey?.trim()
    if (!key) throw new Error('Anthropic API key is missing. Set your key in Lyrics Settings.')

    const indexedLines: Record<string, string> = {}
    texts.forEach((text, i) => {
      indexedLines[String(i)] = text
    })

    const model = config.anthropicModel || 'claude-haiku-4-5'
    const prompt = `Translate the following song lyric lines into ${config.targetLanguage}.
Respond ONLY with a JSON object mapping string index to translation:
{
  "0": "Translated line 0"
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
    return this.parseIndexedJson(content, texts.length)
  }

  private async translateWithGemini(
    texts: string[],
    config: AIKeysConfig,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const key = config.geminiKey?.trim()
    if (!key) throw new Error('Gemini API key is missing. Set your key in Lyrics Settings.')

    const indexedLines: Record<string, string> = {}
    texts.forEach((text, i) => {
      indexedLines[String(i)] = text
    })

    const model = config.geminiModel || 'gemini-2.0-flash'
    const prompt = `Translate the following song lyric lines into ${config.targetLanguage}.
Respond ONLY with a JSON object mapping string index to translation:
{
  "0": "Translated line 0"
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
    return this.parseIndexedJson(content, texts.length)
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

  private parseIndexedJson(content: string, count: number): string[] {
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
        result.push(parsed[String(i)] || '')
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
