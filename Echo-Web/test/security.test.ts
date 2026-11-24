import test from 'node:test'
import assert from 'node:assert'
import {
  isAllowedStreamingDomain,
  isAllowedAppleDomain,
  isAllowedTidalDomain,
  isPrivateIp,
  validateDestinationUrl,
  safeProxyFetch,
  proxyTargetUrlSchema,
  getProxySecurityMetrics,
  resetProxySecurityMetrics,
} from '../server/utils/ssrf.ts'
import { streamRouter } from '../server/routes/stream.ts'
import { canvasRouter } from '../server/routes/canvas.ts'

test('Security: isAllowedStreamingDomain strictly validates YouTube & GoogleVideo domains and blocks SSRF targets', () => {
  // Allowed
  assert.strictEqual(isAllowedStreamingDomain('https://rr1---sn-uxa-i54e.googlevideo.com/videoplayback?id=123'), true)
  assert.strictEqual(isAllowedStreamingDomain('https://music.youtube.com/watch?v=123'), true)
  assert.strictEqual(isAllowedStreamingDomain('https://youtube.com/watch?v=123'), true)

  // Blocked SSRF & internal targets
  assert.strictEqual(isAllowedStreamingDomain('http://localhost:8080/admin'), false)
  assert.strictEqual(isAllowedStreamingDomain('http://127.0.0.1/metadata'), false)
  assert.strictEqual(isAllowedStreamingDomain('http://169.254.169.254/latest/meta-data'), false)
  assert.strictEqual(isAllowedStreamingDomain('https://evil-googlevideo.com/payload'), false)
  assert.strictEqual(isAllowedStreamingDomain('https://googlevideo.com.attacker.com/payload'), false)
  assert.strictEqual(isAllowedStreamingDomain('not-a-url'), false)
})

test('Security: isAllowedAppleDomain blocks spoofed subdomains and unapproved endpoints', () => {
  assert.strictEqual(isAllowedAppleDomain('https://music.apple.com/us/album/test/123'), true)
  assert.strictEqual(isAllowedAppleDomain('https://is1-ssl.mzstatic.com/image/thumb/123.jpg'), true)

  // Blocked
  assert.strictEqual(isAllowedAppleDomain('https://apple.com.attacker.com/test'), false)
  assert.strictEqual(isAllowedAppleDomain('https://evil-apple.com/test'), false)
  assert.strictEqual(isAllowedAppleDomain('http://127.0.0.1:3000'), false)
})

test('Security: isAllowedTidalDomain blocks non-Tidal origins', () => {
  assert.strictEqual(isAllowedTidalDomain('https://listen.tidal.com/album/123'), true)
  assert.strictEqual(isAllowedTidalDomain('https://api.tidal.com/v1/tracks/123'), true)
  assert.strictEqual(isAllowedTidalDomain('https://resources.tidal.com/videos/123.mp4'), true)

  // Blocked
  assert.strictEqual(isAllowedTidalDomain('https://tidal.com.phishing.net'), false)
  assert.strictEqual(isAllowedTidalDomain('https://evil-tidal.com'), false)
})

test('Security: isPrivateIp correctly identifies IPv4 and IPv6 private, link-local, and loopback ranges', () => {
  // Loopback
  assert.strictEqual(isPrivateIp('127.0.0.1'), true)
  assert.strictEqual(isPrivateIp('127.1.2.3'), true)
  assert.strictEqual(isPrivateIp('::1'), true)

  // Private IPv4 ranges
  assert.strictEqual(isPrivateIp('10.0.0.1'), true)
  assert.strictEqual(isPrivateIp('10.255.255.254'), true)
  assert.strictEqual(isPrivateIp('172.16.0.1'), true)
  assert.strictEqual(isPrivateIp('172.31.255.254'), true)
  assert.strictEqual(isPrivateIp('192.168.1.1'), true)

  // Link-local & metadata service
  assert.strictEqual(isPrivateIp('169.254.169.254'), true)
  assert.strictEqual(isPrivateIp('169.254.1.1'), true)
  assert.strictEqual(isPrivateIp('fe80::1'), true)

  // Public IPs
  assert.strictEqual(isPrivateIp('8.8.8.8'), false)
  assert.strictEqual(isPrivateIp('1.1.1.1'), false)
  assert.strictEqual(isPrivateIp('142.250.190.46'), false)
})

test('Security: validateDestinationUrl blocks private IP literals and invalid schemes [BUG-09]', async () => {
  const allowAll = () => true
  const privateUrl = await validateDestinationUrl('http://127.0.0.1:8080/secret', allowAll)
  assert.strictEqual(privateUrl.valid, false)

  const metaUrl = await validateDestinationUrl('http://169.254.169.254/latest/meta-data', allowAll)
  assert.strictEqual(metaUrl.valid, false)

  const fileScheme = await validateDestinationUrl('file:///etc/passwd', allowAll)
  assert.strictEqual(fileScheme.valid, false)

  const allowedPublic = await validateDestinationUrl('https://music.youtube.com', isAllowedStreamingDomain)
  assert.strictEqual(allowedPublic.valid, true)
})

test('Security: safeProxyFetch validates initial and redirect destinations [BUG-09]', async () => {
  // Direct attempt on unallowed domain throws
  await assert.rejects(
    () =>
      safeProxyFetch('https://attacker.com/payload', {
        domainValidator: isAllowedStreamingDomain,
      }),
    /SSRF blocked/,
  )

  // Direct attempt on private IP throws
  await assert.rejects(
    () =>
      safeProxyFetch('http://127.0.0.1:8080/admin', {
        domainValidator: () => true,
      }),
    /SSRF blocked/,
  )
})

test('Security: production streamRouter strictly enforces SSRF allowlist and blocks internal/malicious destinations [BUG-21]', async () => {
  // 1. Missing url parameter -> 403
  const resEmpty = await streamRouter.request('http://localhost/proxy')
  assert.strictEqual(resEmpty.status, 403)

  // 2. Private IP literal -> 403
  const resPrivate = await streamRouter.request(
    'http://localhost/proxy?url=' + encodeURIComponent('http://127.0.0.1:8080/admin'),
  )
  assert.strictEqual(resPrivate.status, 403)

  // 3. AWS metadata endpoint -> 403
  const resMeta = await streamRouter.request(
    'http://localhost/proxy?url=' + encodeURIComponent('http://169.254.169.254/latest/meta-data'),
  )
  assert.strictEqual(resMeta.status, 403)

  // 4. Evil spoofed domain -> 403
  const resSpoofed = await streamRouter.request(
    'http://localhost/proxy?url=' + encodeURIComponent('https://evil-googlevideo.com/payload'),
  )
  assert.strictEqual(resSpoofed.status, 403)

  // 5. Attacker subdomain -> 403
  const resAttacker = await streamRouter.request(
    'http://localhost/proxy?url=' + encodeURIComponent('https://googlevideo.com.attacker.com/payload'),
  )
  assert.strictEqual(resAttacker.status, 403)
})

test('Security: production canvasRouter strictly enforces Apple and Tidal allowlists and blocks SSRF targets [BUG-21]', async () => {
  // Apple route: missing url -> 400
  const resAppleEmpty = await canvasRouter.request('http://localhost/apple')
  assert.strictEqual(resAppleEmpty.status, 400)

  // Apple route: internal IP -> 403
  const resAppleInternal = await canvasRouter.request(
    'http://localhost/apple?url=' + encodeURIComponent('http://127.0.0.1:3000/internal'),
  )
  assert.strictEqual(resAppleInternal.status, 403)

  // Apple route: evil domain -> 403
  const resAppleEvil = await canvasRouter.request(
    'http://localhost/apple?url=' + encodeURIComponent('https://evil-apple.com/song.m3u8'),
  )
  assert.strictEqual(resAppleEvil.status, 403)

  // Apple route: spoofed mzstatic -> 403
  const resAppleSpoofed = await canvasRouter.request(
    'http://localhost/apple?url=' + encodeURIComponent('https://mzstatic.com.attacker.com/song.m3u8'),
  )
  assert.strictEqual(resAppleSpoofed.status, 403)

  // Tidal route: missing params -> 400
  const resTidalEmpty = await canvasRouter.request('http://localhost/tidal')
  assert.strictEqual(resTidalEmpty.status, 400)

  // Tidal route: internal IP -> 403
  const resTidalInternal = await canvasRouter.request(
    'http://localhost/tidal?url=' + encodeURIComponent('http://localhost:8080/secret'),
  )
  assert.strictEqual(resTidalInternal.status, 403)

  // Tidal route: evil domain -> 403
  const resTidalEvil = await canvasRouter.request(
    'http://localhost/tidal?url=' + encodeURIComponent('https://evil-tidal.com/canvas.mp4'),
  )
  assert.strictEqual(resTidalEvil.status, 403)
})

test('Security: safeProxyFetch blocks open redirect to internal IP addresses and unapproved domains [BUG-21]', async () => {
  const originalFetch = globalThis.fetch
  const validInitialUrl = 'https://music.youtube.com/watch?v=valid123'

  try {
    // 1. Redirect to private/link-local address
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data' },
      })) as any

    await assert.rejects(
      () =>
        safeProxyFetch(validInitialUrl, {
          domainValidator: isAllowedStreamingDomain,
        }),
      /SSRF blocked: Destination or redirect URL is forbidden \(http:\/\/169\.254\.169\.254\/latest\/meta-data\)/,
    )

    // 2. Redirect to unauthorized external domain
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://malicious-site.attacker.com/payload' },
      })) as any

    await assert.rejects(
      () =>
        safeProxyFetch(validInitialUrl, {
          domainValidator: isAllowedStreamingDomain,
        }),
      /SSRF blocked: Destination or redirect URL is forbidden \(https:\/\/malicious-site\.attacker\.com\/payload\)/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Security: proxyTargetUrlSchema validates schemas and rejects malformed URLs [SMALL-10]', () => {
  assert.strictEqual(proxyTargetUrlSchema.safeParse('https://music.youtube.com/watch?v=123').success, true)
  assert.strictEqual(proxyTargetUrlSchema.safeParse('http://rr1---sn-uxa-i54e.googlevideo.com/videoplayback').success, true)

  // Disallowed schemes
  assert.strictEqual(proxyTargetUrlSchema.safeParse('javascript:alert(1)').success, false)
  assert.strictEqual(proxyTargetUrlSchema.safeParse('data:text/html,evil').success, false)
  assert.strictEqual(proxyTargetUrlSchema.safeParse('ftp://example.com/audio.mp3').success, false)
  assert.strictEqual(proxyTargetUrlSchema.safeParse('not-a-url').success, false)
})

test('Security: safeProxyFetch header sanitization, metrics, and /proxy-telemetry [SMALL-10]', async () => {
  resetProxySecurityMetrics()
  const originalFetch = globalThis.fetch
  let capturedHeaders: Record<string, string> | undefined

  try {
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>
      return new Response('audio data', { status: 200 })
    }) as any

    await safeProxyFetch('https://music.youtube.com/audio.mp3', {
      headers: {
        'User-Agent': 'EchoWeb/1.0',
        'Authorization': 'Bearer secret-token',
        'Cookie': 'session=abc',
        'X-Forwarded-For': '127.0.0.1',
      },
      domainValidator: isAllowedStreamingDomain,
    })

    assert.ok(capturedHeaders)
    assert.strictEqual(capturedHeaders['User-Agent'], 'EchoWeb/1.0')
    assert.strictEqual(capturedHeaders['Authorization'], undefined)
    assert.strictEqual(capturedHeaders['Cookie'], undefined)
    assert.strictEqual(capturedHeaders['X-Forwarded-For'], undefined)

    const metrics = getProxySecurityMetrics()
    assert.ok(metrics.totalEvaluated > 0)

    // Test /proxy-telemetry endpoint on streamRouter
    const telemetryRes = await streamRouter.fetch(new Request('http://localhost/proxy-telemetry'))
    assert.strictEqual(telemetryRes.status, 200)
    const telemetry = await telemetryRes.json() as ReturnType<typeof getProxySecurityMetrics>
    assert.strictEqual(typeof telemetry.totalEvaluated, 'number')
    assert.strictEqual(typeof telemetry.ssrfBlocked, 'number')
  } finally {
    globalThis.fetch = originalFetch
  }
})


