import { isIP } from 'node:net'
import { promises as dns } from 'node:dns'

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
  try {
    const parsed = new URL(urlStr)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, url: null }
    }
    if (!domainValidator(urlStr)) {
      return { valid: false, url: null }
    }

    const host = parsed.hostname.toLowerCase()

    // If host is a literal IP
    if (isIP(host)) {
      if (isPrivateIp(host)) return { valid: false, url: null }
      return { valid: true, url: parsed }
    }

    // Resolve DNS and ensure no private IPs are returned
    const lookups = await dns.lookup(host, { all: true }).catch(() => [])
    if (lookups.length === 0) {
      return { valid: false, url: null }
    }

    for (const record of lookups) {
      if (isPrivateIp(record.address)) {
        return { valid: false, url: null }
      }
    }

    return { valid: true, url: parsed }
  } catch {
    return { valid: false, url: null }
  }
}

export async function safeProxyFetch(
  targetUrl: string,
  options: {
    headers?: Record<string, string>
    domainValidator: (url: string) => boolean
    maxRedirects?: number
  },
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5
  let currentUrl = targetUrl
  let redirectsCount = 0

  while (redirectsCount <= maxRedirects) {
    const validation = await validateDestinationUrl(currentUrl, options.domainValidator)
    if (!validation.valid) {
      throw new Error(`SSRF blocked: Destination or redirect URL is forbidden (${currentUrl})`)
    }

    const init: RequestInit = {
      redirect: 'manual',
    }
    if (options.headers) {
      init.headers = options.headers
    }
    const res = await fetch(currentUrl, init)

    // Check for redirect status codes (301, 302, 303, 307, 308)
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location')
      if (!location) {
        throw new Error('Redirect missing Location header')
      }
      currentUrl = new URL(location, currentUrl).toString()
      redirectsCount++
      continue
    }

    return res
  }

  throw new Error(`Too many redirects (limit: ${maxRedirects})`)
}
