# Translation Provider Testing & Model Discovery [FEATURE-057]

## Overview
This feature introduces automated connection verification and dynamic model discovery for AI translation providers in Echo Music Web. It brings feature parity with upstream Android Echo Music's `AiSettings` and `OpenRouterService.testConnection` / `DeepLService.testConnection`.

## Capabilities

### 1. Automated Connection Verification (`testConnection`)
Users can verify their API credentials, base URLs, and selected models before attempting lyrics translation:
- **Ping Payloads**: Sends minimal test requests (e.g. 5-token ping or usage checks) to eliminate credit waste.
- **Provider Support**:
  - **OpenRouter**: Tests `/api/v1/chat/completions` with authentication headers.
  - **DeepL**: Tests `/v2/usage` with auth key verification across Free and Pro tiers.
  - **Mistral**: Tests `/v1/chat/completions`.
  - **OpenAI-Compatible**: Tests custom base URL endpoints (e.g. Ollama, LocalAI, vLLM, Groq, OpenAI).
  - **Anthropic**: Tests `/v1/messages`.
  - **Google Gemini**: Tests `:generateContent` with API key.
- **Diagnostics**: Returns latency in milliseconds, HTTP status code, and specific error diagnostics if authentication, rate limiting, or network unreachable occurs.

### 2. Dynamic Model Discovery (`discoverModels`)
Rather than requiring users to manually guess or type model identifiers:
- **API Fetching**: Queries provider model catalog endpoints:
  - OpenRouter `/api/v1/models` (retrieving model IDs, display names, context lengths, descriptions).
  - Mistral `/v1/models`.
  - OpenAI-Compatible `${baseUrl}/models`.
  - Google Gemini `/v1beta/models`.
- **Curated Fallback**: Upstream verified model catalog (`CURATED_MODELS_BY_PROVIDER`) is instantly accessible offline or before API key entry.

### 3. User Interface & Controls
- **Interactive Test Button**: Located directly in the AI Translation Settings modal with loading indicator and instant pass/fail status pill.
- **Quick Model Picker**: Live clickable chips allow 1-click model selection for OpenRouter, Mistral, OpenAI, Anthropic, and Gemini.

### 4. Telemetry & Metrics
`TranslationMetrics` tracks provider verification operations:
- `connectionTestsRun`: Total connection tests triggered.
- `connectionTestsSuccessful`: Successful connections verified.
- `connectionTestsFailed`: Failed test attempts.
- `modelDiscoveriesRun`: Model discovery queries executed.
- `modelsDiscoveredCount`: Total models discovered and cataloged.
