/**
 * YouTube Music Account Authentication Service for Echo Music Web
 *
 * Implements account authentication, session cookie persistence, multi-account
 * profile switching, and account-aware library operations matching upstream
 * Echo Music architecture:
 * - LoginScreen.kt
 * - AccountViewModel.kt
 * - AccountData.kt
 */

import { z } from 'zod'

// ============================================================================
// Schemas
// ============================================================================

export const youTubeAccountInfoSchema = z.object({
  name: z.string().min(1),
  email: z.string().optional(),
  channelHandle: z.string().optional(),
  avatarUrl: z.string().optional(),
  dataSyncId: z.string().optional(),
  visitorData: z.string().optional(),
})

export type YouTubeAccountInfo = z.infer<typeof youTubeAccountInfoSchema>

export const youTubeAccountSessionSchema = z.object({
  cookie: z.string().min(1),
  accountInfo: youTubeAccountInfoSchema,
  savedAt: z.number().nonnegative(),
})

export type YouTubeAccountSession = z.infer<typeof youTubeAccountSessionSchema>

export const youTubeAccountMetricsSchema = z.object({
  authSuccessCount: z.number().nonnegative(),
  authFailureCount: z.number().nonnegative(),
  accountInfoLoadsCount: z.number().nonnegative(),
  librarySyncCount: z.number().nonnegative(),
  accountSwitchesCount: z.number().nonnegative(),
})

export type YouTubeAccountMetrics = z.infer<typeof youTubeAccountMetricsSchema>

// ============================================================================
// Telemetry State
// ============================================================================

let accountMetrics: YouTubeAccountMetrics = {
  authSuccessCount: 0,
  authFailureCount: 0,
  accountInfoLoadsCount: 0,
  librarySyncCount: 0,
  accountSwitchesCount: 0,
}

export function recordYouTubeAccountMetric(
  key: keyof YouTubeAccountMetrics,
  delta = 1,
): void {
  if (key in accountMetrics) {
    accountMetrics[key] += delta
  }
}

export function getYouTubeAccountMetrics(): YouTubeAccountMetrics {
  return { ...accountMetrics }
}

export function resetYouTubeAccountMetrics(): void {
  accountMetrics = {
    authSuccessCount: 0,
    authFailureCount: 0,
    accountInfoLoadsCount: 0,
    librarySyncCount: 0,
    accountSwitchesCount: 0,
  }
}

// ============================================================================
// Session Persistence & Multi-Account Management
// ============================================================================

export const YTM_SESSION_STORAGE_KEY = 'echo_ytm_account_session'
export const YTM_SAVED_ACCOUNTS_STORAGE_KEY = 'echo_ytm_saved_accounts'

export function getStoredYouTubeSession(): YouTubeAccountSession | null {
  try {
    const raw = localStorage.getItem(YTM_SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const result = youTubeAccountSessionSchema.safeParse(parsed)
    if (result.success) {
      return result.data
    }
  } catch {
    // Non-fatal
  }
  return null
}

export function setStoredYouTubeSession(
  cookie: string,
  info: YouTubeAccountInfo,
): void {
  try {
    const session: YouTubeAccountSession = {
      cookie: cookie.trim(),
      accountInfo: info,
      savedAt: Date.now(),
    }
    localStorage.setItem(YTM_SESSION_STORAGE_KEY, JSON.stringify(session))
    saveYouTubeAccount(session)
    recordYouTubeAccountMetric('authSuccessCount')
  } catch {
    // Non-fatal
  }
}

export function clearStoredYouTubeSession(): void {
  try {
    localStorage.removeItem(YTM_SESSION_STORAGE_KEY)
  } catch {
    // Non-fatal
  }
}

export function getSavedYouTubeAccounts(): YouTubeAccountSession[] {
  try {
    const raw = localStorage.getItem(YTM_SAVED_ACCOUNTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => youTubeAccountSessionSchema.safeParse(item).success)
    }
  } catch {
    // Non-fatal
  }
  return []
}

export function saveYouTubeAccount(session: YouTubeAccountSession): void {
  try {
    const current = getSavedYouTubeAccounts()
    const identifier = session.accountInfo.email || session.accountInfo.name
    const filtered = current.filter(
      (a) => (a.accountInfo.email || a.accountInfo.name) !== identifier,
    )
    const updated = [session, ...filtered].slice(0, 5) // keep up to 5 accounts
    localStorage.setItem(YTM_SAVED_ACCOUNTS_STORAGE_KEY, JSON.stringify(updated))
  } catch {
    // Non-fatal
  }
}

export function removeSavedYouTubeAccount(nameOrEmail: string): void {
  try {
    const current = getSavedYouTubeAccounts()
    const updated = current.filter(
      (a) => a.accountInfo.name !== nameOrEmail && a.accountInfo.email !== nameOrEmail,
    )
    localStorage.setItem(YTM_SAVED_ACCOUNTS_STORAGE_KEY, JSON.stringify(updated))

    const active = getStoredYouTubeSession()
    if (
      active &&
      (active.accountInfo.name === nameOrEmail || active.accountInfo.email === nameOrEmail)
    ) {
      clearStoredYouTubeSession()
    }
  } catch {
    // Non-fatal
  }
}

export function switchActiveYouTubeAccount(nameOrEmail: string): boolean {
  try {
    const accounts = getSavedYouTubeAccounts()
    const target = accounts.find(
      (a) => a.accountInfo.name === nameOrEmail || a.accountInfo.email === nameOrEmail,
    )
    if (target) {
      localStorage.setItem(YTM_SESSION_STORAGE_KEY, JSON.stringify(target))
      recordYouTubeAccountMetric('accountSwitchesCount')
      return true
    }
  } catch {
    // Non-fatal
  }
  return false
}

// ============================================================================
// Account Operations & Validation
// ============================================================================

export async function validateAndConnectYouTubeAccount(
  cookie: string,
  visitorData?: string,
  dataSyncId?: string,
): Promise<YouTubeAccountInfo> {
  if (!cookie || !cookie.trim()) {
    recordYouTubeAccountMetric('authFailureCount')
    throw new Error('Session cookie is required to authenticate YouTube Music account')
  }

  recordYouTubeAccountMetric('accountInfoLoadsCount')

  try {
    const res = await fetch('/api/innertube/account/info', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cookie: cookie.trim(),
        visitorData,
        dataSyncId,
      }),
    })

    if (!res.ok) {
      recordYouTubeAccountMetric('authFailureCount')
      throw new Error(`Account verification failed (${res.status}: ${res.statusText})`)
    }

    const data = await res.json()
    if (data.ok && data.account) {
      const accountInfo = youTubeAccountInfoSchema.parse({
        name: data.account.name || 'YouTube Music User',
        email: data.account.email,
        channelHandle: data.account.channelHandle,
        avatarUrl: data.account.avatarUrl,
        visitorData,
        dataSyncId,
      })

      setStoredYouTubeSession(cookie, accountInfo)
      return accountInfo
    }
  } catch (err) {
    recordYouTubeAccountMetric('authFailureCount')
    throw err
  }

  throw new Error('Could not verify YouTube Music account with provided credentials')
}

export async function fetchAccountPlaylists(
  cookieOverride?: string,
): Promise<Array<{ id: string; title: string; trackCount?: number; coverUrl?: string }>> {
  const session = getStoredYouTubeSession()
  const cookie = cookieOverride || session?.cookie
  if (!cookie) return []

  recordYouTubeAccountMetric('librarySyncCount')

  try {
    const res = await fetch('/api/innertube/browse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-innertube-cookie': cookie,
      },
      body: JSON.stringify({
        browseId: 'FEmusic_liked_playlists',
      }),
    })

    if (!res.ok) return []
    const data = await res.json()
    // Parse playlist items from browse sectionListRenderer
    const items: Array<{ id: string; title: string; trackCount?: number; coverUrl?: string }> = []
    const sections =
      data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
        ?.sectionListRenderer?.contents || []

    for (const sec of sections) {
      const gridItems = sec?.gridRenderer?.items || sec?.musicShelfRenderer?.contents || []
      for (const item of gridItems) {
        const renderer = item?.musicTwoRowItemRenderer
        if (renderer) {
          const id =
            renderer.navigationEndpoint?.browseEndpoint?.browseId ||
            renderer.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
          const title = renderer.title?.runs?.[0]?.text || renderer.title?.simpleText
          const coverUrl = renderer.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url
          if (id && title) {
            items.push({ id, title, coverUrl })
          }
        }
      }
    }
    return items
  } catch {
    return []
  }
}
