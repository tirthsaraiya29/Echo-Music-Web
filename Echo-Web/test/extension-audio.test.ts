import test from 'node:test'
import assert from 'node:assert'
import {
  normalizeForMatch,
  tokenize,
  tokensMatch,
  artistMatches,
  selectBestMatch,
  extensionsRouter,
} from '../server/routes/extensions.ts'
import { ExtensionManager } from '../src/services/extensions/extensionManager.ts'
import type { AddonTrack } from '../src/types/extension.ts'

test('Extension Audio: Tokenizer and normalization handle punctuation and case', () => {
  assert.strictEqual(normalizeForMatch('Portami Via / Fabrizio Moro'), 'portami via fabrizio moro')
  assert.deepStrictEqual(tokenize('Starboy (Remix) [feat. Daft Punk]'), [
    'starboy',
    'remix',
    'feat',
    'daft',
    'punk',
  ])
  assert.strictEqual(tokensMatch('remix', 'remixes'), true)
  assert.strictEqual(tokensMatch('star', 'starboy'), true)
  assert.strictEqual(tokensMatch('yes', 'yesterday'), false)
})

test('Extension Audio: artistMatches rejects different artist and matches shared significant tokens', () => {
  // Matching artist token
  assert.strictEqual(artistMatches(['daft', 'punk'], ['daft', 'punk']), true)
  assert.strictEqual(artistMatches(['the', 'weeknd'], ['weeknd']), true)

  // Rejects different artist
  assert.strictEqual(artistMatches(['the', 'fray'], ['the', 'band']), false)
  assert.strictEqual(artistMatches(['coldplay'], ['radiohead']), false)
})

test('Extension Audio: selectBestMatch scores and validates candidates per upstream rules', () => {
  const tracks: AddonTrack[] = [
    {
      id: 'trk_wrong_artist',
      title: 'Midnight City',
      artist: 'Kavinsky',
      duration: 243,
    },
    {
      id: 'trk_plain',
      title: 'Midnight City',
      artist: 'M83',
      duration: 243,
    },
    {
      id: 'trk_remix',
      title: 'Midnight City (Eric Prydz Remix)',
      artist: 'M83',
      duration: 360,
    },
  ]

  // 1. Plain original request must match plain original candidate, not remix or wrong artist
  const plainMatch = selectBestMatch(tracks, 'Midnight City', 'M83', 243000)
  assert.ok(plainMatch)
  assert.strictEqual(plainMatch.track.id, 'trk_plain')

  // 2. Remix request must strictly match the remix candidate and NOT the plain original
  const remixMatch = selectBestMatch(tracks, 'Midnight City Remix', 'M83', 360000)
  assert.ok(remixMatch)
  assert.strictEqual(remixMatch.track.id, 'trk_remix')

  // 3. Artist mismatch must be rejected even if title is identical
  const mismatch = selectBestMatch(tracks, 'Midnight City', 'Taylor Swift', 243000)
  assert.strictEqual(mismatch, null)

  // 4. Empty candidate list returns null
  assert.strictEqual(selectBestMatch([], 'Any', 'Artist'), null)
})

test('Extension Audio: ExtensionManager manages registry, priorities, and telemetry', async () => {
  const manager = new ExtensionManager()
  let notified = 0
  const unsub = manager.subscribe(() => {
    notified++
  })

  const initialCount = manager.getAddons().length

  // Add addon
  const added = await manager.addAddon({
    name: 'FlacLossless Source',
    url: 'https://flac.example.com',
    enabled: true,
  })

  assert.ok(added.id)
  assert.strictEqual(added.name, 'FlacLossless Source')
  assert.strictEqual(added.url, 'https://flac.example.com')
  assert.strictEqual(manager.getAddons().length, initialCount + 1)
  assert.strictEqual(manager.hasEnabledAddons(), true)

  // Toggle addon
  manager.toggleAddon(added.id, false)
  const toggled = manager.getAddons().find((a) => a.id === added.id)
  assert.strictEqual(toggled?.enabled, false)

  // Telemetry tracking
  const tel = manager.getTelemetry()
  assert.strictEqual(tel.totalAttempts, 0)
  assert.strictEqual(tel.fallbackCount, 0)

  // Reorder addons
  manager.reorderAddons([added.id])
  assert.strictEqual(manager.getAddons()[0]?.id, added.id)

  // Remove addon
  manager.removeAddon(added.id)
  assert.strictEqual(manager.getAddons().length, initialCount)

  unsub()
  assert.ok(notified >= 2)
})

test('Extension Audio: extensionsRouter endpoints validate requests and block SSRF', async () => {
  // Missing url
  const res1 = await extensionsRouter.request('/health')
  assert.strictEqual(res1.status, 400)

  // SSRF blocked url
  const res2 = await extensionsRouter.request('/health?url=http://127.0.0.1:9999')
  assert.strictEqual(res2.status, 403)

  // Missing match payload
  const res3 = await extensionsRouter.request('/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.strictEqual(res3.status, 400)

  // Missing resolve payload
  const res4 = await extensionsRouter.request('/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.strictEqual(res4.status, 400)
})
