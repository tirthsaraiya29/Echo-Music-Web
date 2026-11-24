import test from 'node:test'
import assert from 'node:assert'
import {
  normalizeServerUrl,
  isAllowedCloudServer,
  cloudRouter,
} from '../server/routes/cloud.ts'
import { CloudMediaManager } from '../src/services/cloud/cloudMediaManager.ts'
import type { CloudServerConfig } from '../src/services/cloud/cloudMediaTypes.ts'

test('Cloud: normalizeServerUrl formats URLs correctly', () => {
  assert.strictEqual(normalizeServerUrl('jellyfin.local/'), 'https://jellyfin.local')
  assert.strictEqual(normalizeServerUrl('http://navidrome.home:4533/'), 'http://navidrome.home:4533')
  assert.strictEqual(normalizeServerUrl('  https://media.example.com///  '), 'https://media.example.com')
})

test('Cloud: isAllowedCloudServer rejects invalid schemes and SSRF addresses', () => {
  assert.strictEqual(isAllowedCloudServer('file:///etc/passwd'), false)
  assert.strictEqual(isAllowedCloudServer('ftp://subsonic.org'), false)
  assert.strictEqual(isAllowedCloudServer('not-a-url'), false)
  assert.strictEqual(isAllowedCloudServer('http://127.0.0.1:8096'), false)
  assert.strictEqual(isAllowedCloudServer('http://169.254.169.254/latest'), false)
  assert.strictEqual(isAllowedCloudServer('http://localhost:4533'), false)
  assert.strictEqual(isAllowedCloudServer('https://music.example.com'), true)
})

test('Cloud: CloudMediaManager manages server registry and tracks mapping', () => {
  const manager = new CloudMediaManager()
  let notifiedCount = 0
  const unsubscribe = manager.subscribe(() => {
    notifiedCount++
  })

  const initialCount = manager.getServers().length

  const added = manager.addServer({
    name: 'Home Jellyfin',
    type: 'jellyfin',
    serverUrl: 'https://jellyfin.home',
    username: 'alice',
    token: 'test_token_123',
    userId: 'user_abc_456',
  })

  assert.ok(added.id)
  assert.strictEqual(added.name, 'Home Jellyfin')
  assert.strictEqual(manager.getServers().length, initialCount + 1)
  assert.strictEqual(manager.getServer(added.id)?.name, 'Home Jellyfin')

  // Jellyfin mapping
  const jfTrack = manager.mapJellyfinItemToTrack(added, {
    Id: 'item_999',
    Name: 'Midnight City',
    Artists: ['M83'],
    Album: 'Hurry Up, We\'re Dreaming',
    AlbumId: 'album_888',
    RunTimeTicks: 2430000000,
  })

  assert.strictEqual(jfTrack.id, 'jellyfin_item_999')
  assert.strictEqual(jfTrack.title, 'Midnight City')
  assert.strictEqual(jfTrack.artistName, 'M83')
  assert.strictEqual(jfTrack.albumTitle, 'Hurry Up, We\'re Dreaming')
  assert.strictEqual(jfTrack.durationSeconds, 243)
  assert.ok(jfTrack.streamUrl?.includes('/Audio/item_999/stream?static=true&api_key=test_token_123'))
  assert.ok(jfTrack.artwork?.includes('/Items/item_999/Images/Primary?maxWidth=400'))

  // Subsonic / Navidrome mapping
  const naviServer: CloudServerConfig = {
    id: 'navi_1',
    name: 'Navidrome Lab',
    type: 'navidrome',
    serverUrl: 'https://navi.lab',
    username: 'bob',
    token: 'subsonic_token_abc',
    salt: 'salt_xyz',
    createdAt: Date.now(),
  }

  const subTrack = manager.mapSubsonicSongToTrack(naviServer, {
    id: 'song_555',
    title: 'Starboy',
    artist: 'The Weeknd',
    album: 'Starboy',
    duration: 230,
    coverArt: 'cover_123',
  })

  assert.strictEqual(subTrack.id, 'navidrome_song_555')
  assert.strictEqual(subTrack.title, 'Starboy')
  assert.strictEqual(subTrack.artistName, 'The Weeknd')
  assert.strictEqual(subTrack.durationSeconds, 230)
  assert.ok(subTrack.streamUrl?.includes('/rest/stream.view?id=song_555&format=raw'))
  assert.ok(subTrack.artwork?.includes('/rest/getCoverArt.view?id=cover_123'))

  // Removal
  manager.removeServer(added.id)
  assert.strictEqual(manager.getServer(added.id), undefined)
  assert.strictEqual(manager.getServers().length, initialCount)

  unsubscribe()
  assert.ok(notifiedCount >= 2)
})

test('Cloud Router: /api/cloud/test-connection rejects incomplete payloads', async () => {
  const res = await cloudRouter.request('/test-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.strictEqual(res.status, 400)
  const data = (await res.json()) as { error?: string }
  assert.ok(data.error?.includes('required'))
})
