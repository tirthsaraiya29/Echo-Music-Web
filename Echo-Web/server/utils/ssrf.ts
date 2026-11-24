import { isIP } from 'node:net'
import { promises as dns } from 'node:dns'
import { z } from 'zod'

export const proxyTargetUrlSchema = z.string().url().refine((val) => {
  try {
    const u = new URL(val)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}, { message: 'URL must have http: or https: scheme' })

export interface ProxySecurityMetrics {
  totalEvaluated: number
  ssrfBlocked: number
  domainRejected: number
  redirectsFollowed: number
  redirectLoopsBlocked: number
  timeoutsBlocked: number
}

const proxyMetrics: ProxySecurityMetrics = {
  totalEvaluated: 0,
  ssrfBlocked: 0,
  domainRejected: 0,
  redirectsFollowed: 0,
  redirectLoopsBlocked: 0,
  timeoutsBlocked: 0,
}

export function getProxySecurityMetrics(): ProxySecurityMetrics {
  return { ...proxyMetrics }
}

export function resetProxySecurityMetrics(): void {
  proxyMetrics.totalEvaluated = 0
  proxyMetrics.ssrfBlocked = 0
  proxyMetrics.domainRejected = 0
  proxyMetrics.redirectsFollowed = 0
  proxyMetrics.redirectLoopsBlocked = 0
  proxyMetrics.timeoutsBlocked = 0
}

export function isPrivateIp(ip: string): boolean {
  const ipType = isIP(ip)
  if (ipType === 4) {
    const parts = ip.split('.').map((p) => Number.parseInt(p, 10))
    if (parts.length !== 4 || parts.some(isNaN)) return true
    const [b0, b1] = parts

    // 0.0.0.0/8
    if (b0 === 0) return true
    // 10.0.0.0/8
    if (b0 === 10) return true
    // 127.0.0.0/8
    if (b0 === 127) return true
    // 169.254.0.0/16
    if (b0 === 169 && b1 === 254) return true
    // 172.16.0.0/12 (172.16 - 172.31)
    if (b0 === 172 && b1 !== undefined && b1 >= 16 && b1 <= 31) return true
    // 192.168.0.0/16
    if (b0 === 192 && b1 === 168) return true
    // 100.64.0.0/10 (100.64 - 100.127)
    if (b0 === 100 && b1 !== undefined && b1 >= 64 && b1 <= 127) return true
    // 198.18.0.0/15
    if (b0 === 198 && b1 !== undefined && (b1 === 18 || b1 === 19)) return true
    // 224.0.0.0/4 (multicast) & 240.0.0.0/4 (reserved) & 255.255.255.255
    if (b0 !== undefined && b0 >= 224) return true

    return false
  }

  if (ipType === 6) {
    const norm = ip.toLowerCase()
    // ::1 loopback
    if (norm === '::1' || norm === '0000:0000:0000:0000:0000:0000:0000:0001') return true
    // :: unspecified
    if (norm === '::' || norm === '0000:0000:0000:0000:0000:0000:0000:0000') return true
    // fe80::/10 link-local (fe8, fe9, fea, feb)
    if (/^fe[89ab]/i.test(norm)) return true
    // fc00::/7 unique local (fc, fd)
    if (/^f[cd]/i.test(norm)) return true
    // IPv4-mapped IPv6 ::ffff:127.0.0.1
    if (norm.startsWith('::ffff:')) {
      const v4Part = norm.slice(7)
      if (isIP(v4Part) === 4) return isPrivateIp(v4Part)
    }
    return false
  }

  return true // Not a valid IP
}

export function isAllowedStreamingDomain(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    return (
      host === 'youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'googlevideo.com' ||
      host.endsWith('.googlevideo.com')
    )
  } catch {
    return false
  }
}

export function isAllowedAppleDomain(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    return (
      host === 'music.apple.com' ||
      host === 'beta.music.apple.com' ||
      host.endsWith('.apple.com') ||
      host.endsWith('.mzstatic.com') ||
      host.endsWith('.apple-dns.net')
    )
  } catch {
    return false
  }
}

export function isAllowedTidalDomain(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    return host === 'tidal.com' || host.endsWith('.tidal.com') || host === 'resources.tidal.com'
  } catch {
    return false
  }
}

export async function validateDestinationUrl(
  urlStr: string,
  domainValidator: (url: string) => boolean,
): Promise<{ valid: boolean; url: URL | null }> {
  proxyMetrics.totalEvaluated++
  try {
    const parsed = new URL(urlStr)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      proxyMetrics.domainRejected++
      return { valid: false, url: null }
    }
    if (!domainValidator(urlStr)) {
      proxyMetrics.domainRejected++
      return { valid: false, url: null }
    }

    const host = parsed.hostname.toLowerCase()

    // If host is a literal IP
    if (isIP(host)) {
      if (isPrivateIp(host)) {
        proxyMetrics.ssrfBlocked++
        return { valid: false, url: null }
      }
      return { valid: true, url: parsed }
    }

    // Resolve DNS and ensure no private IPs are returned
    const lookups = await dns.lookup(host, { all: true }).catch(() => [])
    if (lookups.length === 0) {
      proxyMetrics.ssrfBlocked++
      return { valid: false, url: null }
    }

    for (const record of lookups) {
      if (isPrivateIp(record.address)) {
        proxyMetrics.ssrfBlocked++
        return { valid: false, url: null }
      }
    }

    return { valid: true, url: parsed }
  } catch {
    proxyMetrics.domainRejected++
    return { valid: false, url: null }
  }
}

export interface SafeProxyFetchOptions {
  headers?: Record<string, string>
  domainValidator: (url: string) => boolean
  maxRedirects?: number
  signal?: AbortSignal
  timeoutMs?: number
}

export async function safeProxyFetch(
  targetUrl: string,
  options: SafeProxyFetchOptions,
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5
  const timeoutMs = options.timeoutMs ?? 15000
  let currentUrl = targetUrl
  let redirectsCount = 0

  while (redirectsCount <= maxRedirects) {
    const validation = await validateDestinationUrl(currentUrl, options.domainValidator)
    if (!validation.valid) {
      throw new Error(`SSRF blocked: Destination or redirect URL is forbidden (${currentUrl})`)
    }

    // Sanitize headers: strip sensitive credentials & internal proxy headers
    const sanitizedHeaders: Record<string, string> = {}
    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        const lowerKey = k.toLowerCase()
        if (
          lowerKey === 'authorization' ||
          lowerKey === 'cookie' ||
          lowerKey === 'x-forwarded-for' ||
          lowerKey === 'x-real-ip'
        ) {
          continue
        }
        sanitizedHeaders[k] = v
      }
    }

    // Setup bounded timeout controller combined with caller's signal
    const timeoutController = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        proxyMetrics.timeoutsBlocked++
        timeoutController.abort(new Error(`Proxy request timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    }

    let combinedSignal: AbortSignal = timeoutController.signal
    if (options.signal) {
      if (options.signal.aborted) {
        if (timeoutId) clearTimeout(timeoutId)
        throw options.signal.reason
      }
      options.signal.addEventListener('abort', () => timeoutController.abort(options.signal?.reason))
    }

    const init: RequestInit = {
      redirect: 'manual',
      headers: sanitizedHeaders,
      signal: combinedSignal,
    }

    let res: Response
    try {
      res = await fetch(currentUrl, init)
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }

    // Check for redirect status codes (301, 302, 303, 307, 308)
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location')
      if (!location) {
        throw new Error('Redirect missing Location header')
      }
      currentUrl = new URL(location, currentUrl).toString()
      redirectsCount++
      proxyMetrics.redirectsFollowed++
      continue
    }

    return res
  }

  proxyMetrics.redirectLoopsBlocked++
  throw new Error(`Too many redirects (limit: ${maxRedirects})`)
}
