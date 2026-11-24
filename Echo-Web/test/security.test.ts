import test from 'node:test'
import assert from 'node:assert'
import {
  isAllowedStreamingDomain,
  isAllowedAppleDomain,
  isAllowedTidalDomain,
  isPrivateIp,
  validateDestinationUrl,
  safeProxyFetch,
} from '../server/utils/ssrf.ts'

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
