import test from 'node:test'
import assert from 'node:assert'
import type { Track, Album, Artist, PlaylistSummary, HomeShelf } from '../src/types/domain.ts'
import type { SearchResultCatalog } from '../src/services/innertube/client.ts'
import {
  formatBlockedArtistEntry,
  parseBlockedArtistEntry,
  extractBlockedSets,
  isArtistBlocked,
  isTrackBlocked,
  isAlbumBlocked,
  isPlaylistBlocked,
  filterBlockedArtistsFromTracks,
  filterBlockedArtistsFromShelves,
  filterBlockedArtistsFromSearchResults,
  filterBlockedArtistsFromQueue,
  getBlockedArtistsMetrics,
  resetBlockedArtistsMetrics,
} from '../src/services/innertube/blockedArtistsService.ts'
import { QueueManager } from '../src/engine/QueueManager.ts'

test('formatBlockedArtistEntry and parseBlockedArtistEntry handle upstream delimited format', () => {
  const formatted = formatBlockedArtistEntry('UC12345', 'Radiohead')
  assert.strictEqual(formatted, 'UC12345||Radiohead')

  const parsed = parseBlockedArtistEntry('UC12345||Radiohead')
  assert.strictEqual(parsed.id, 'UC12345')
  assert.strictEqual(parsed.name, 'Radiohead')

  // Entry with no delimiter (plain ID or name fallback)
  const plain = parseBlockedArtistEntry('Radiohead')
  assert.strictEqual(plain.id, 'Radiohead')
  assert.strictEqual(plain.name, 'Radiohead')
})

test('extractBlockedSets extracts fast lookup sets correctly', () => {
  const blockedList = ['UC1||Artist One', 'UC2||Artist Two', 'Artist Three']
  const { blockedIds, blockedNames } = extractBlockedSets(blockedList)

  assert.strictEqual(blockedIds.has('UC1'), true)
  assert.strictEqual(blockedIds.has('UC2'), true)
  assert.strictEqual(blockedNames.has('artist one'), true)
  assert.strictEqual(blockedNames.has('artist two'), true)
  assert.strictEqual(blockedNames.has('artist three'), true)
})

test('isArtistBlocked accurately identifies blocked artists by ID and Name', () => {
  resetBlockedArtistsMetrics()
  const blocked = ['UC_radiohead||Radiohead', 'UC_coldplay||Coldplay']

  assert.strictEqual(isArtistBlocked('UC_radiohead', 'Radiohead', blocked), true)
  assert.strictEqual(isArtistBlocked('unknown_id', 'Coldplay', blocked), true)
  assert.strictEqual(isArtistBlocked('unknown_id', 'coldplay', blocked), true) // Case-insensitive
  assert.strictEqual(isArtistBlocked('UC_muse', 'Muse', blocked), false)
})

test('isTrackBlocked checks primary and collaborative artists', () => {
  resetBlockedArtistsMetrics()
  const blocked = ['UC_drake||Drake']

  // 1. Primary artist blocked
  const soloTrack: Track = {
    id: 't1',
    title: 'Hotline Bling',
    artistId: 'UC_drake',
    artistName: 'Drake',
    albumId: 'al1',
    albumTitle: 'Views',
    albumImage: 'https://example.com/views.jpg',
    artwork: 'https://example.com/views.jpg',
    durationMs: 267000,
    durationSeconds: 267,
    explicit: false,
    playCount: 100,
  }
  assert.strictEqual(isTrackBlocked(soloTrack, blocked), true)

  // 2. Collaborative artist blocked in artists array
  const collabTrack: Track = {
    id: 't2',
    title: 'Work',
    artistId: 'UC_rihanna',
    artistName: 'Rihanna',
    artists: [
      { id: 'UC_rihanna', name: 'Rihanna', image: '' },
      { id: 'UC_drake', name: 'Drake', image: '' },
    ],
    albumId: 'al2',
    albumTitle: 'Anti',
    albumImage: 'https://example.com/anti.jpg',
    artwork: 'https://example.com/anti.jpg',
    durationMs: 219000,
    durationSeconds: 219,
    explicit: false,
    playCount: 50,
  }
  assert.strictEqual(isTrackBlocked(collabTrack, blocked), true)

  // 3. Unblocked track
  const unblockedTrack: Track = {
    id: 't3',
    title: 'Diamonds',
    artistId: 'UC_rihanna',
    artistName: 'Rihanna',
    albumId: 'al3',
    albumTitle: 'Unapologetic',
    albumImage: 'https://example.com/diamonds.jpg',
    artwork: 'https://example.com/diamonds.jpg',
    durationMs: 225000,
    durationSeconds: 225,
    explicit: false,
    playCount: 40,
  }
  assert.strictEqual(isTrackBlocked(unblockedTrack, blocked), false)
})

test('isAlbumBlocked and isPlaylistBlocked detect blocked artist content', () => {
  resetBlockedArtistsMetrics()
  const blocked = ['UC_kanye||Kanye West']

  const album: Album = {
    id: 'al_grad',
    title: 'Graduation',
    artistId: 'UC_kanye',
    artistName: 'Kanye West',
    image: 'https://example.com/grad.jpg',
  }
  assert.strictEqual(isAlbumBlocked(album, blocked), true)

  const playlist: PlaylistSummary = {
    id: 'pl_1',
    title: 'Best Beats',
    author: 'Kanye West',
    image: 'https://example.com/pl.jpg',
  }
  assert.strictEqual(isPlaylistBlocked(playlist, blocked), true)
})

test('filterBlockedArtistsFromTracks strips blocked songs', () => {
  resetBlockedArtistsMetrics()
  const blocked = ['UC_bad||Bad Artist']

  const goodTrack: Track = {
    id: 'g1',
    title: 'Good Song',
    artistId: 'UC_good',
    artistName: 'Good Artist',
    albumId: 'a1',
    albumTitle: 'Album',
    albumImage: '',
    artwork: '',
    durationMs: 180000,
    durationSeconds: 180,
    explicit: false,
    playCount: 1,
  }

  const badTrack: Track = {
    id: 'b1',
    title: 'Bad Song',
    artistId: 'UC_bad',
    artistName: 'Bad Artist',
    albumId: 'a2',
    albumTitle: 'Album',
    albumImage: '',
    artwork: '',
    durationMs: 180000,
    durationSeconds: 180,
    explicit: false,
    playCount: 1,
  }

  const result = filterBlockedArtistsFromTracks([goodTrack, badTrack], blocked)
  assert.strictEqual(result.length, 1)
  assert.strictEqual(result[0]!.id, 'g1')
})

test('filterBlockedArtistsFromShelves eliminates items and drops empty shelves', () => {
  resetBlockedArtistsMetrics()
  const blocked = ['UC_blocked||Blocked Artist']

  const goodTrack: Track = {
    id: 'gt1',
    title: 'Good Track',
    artistId: 'UC_good',
    artistName: 'Good Artist',
    albumId: 'a1',
    albumTitle: 'Album',
    albumImage: '',
    artwork: '',
    durationMs: 180000,
    durationSeconds: 180,
    explicit: false,
    playCount: 1,
  }

  const blockedTrack: Track = {
    id: 'bt1',
    title: 'Blocked Track',
    artistId: 'UC_blocked',
    artistName: 'Blocked Artist',
    albumId: 'a2',
    albumTitle: 'Album',
    albumImage: '',
    artwork: '',
    durationMs: 180000,
    durationSeconds: 180,
    explicit: false,
    playCount: 1,
  }

  const shelves: HomeShelf[] = [
    {
      title: 'Mixed Shelf',
      items: [goodTrack, blockedTrack],
    },
    {
      title: 'Only Blocked Shelf',
      items: [blockedTrack], // Becomes empty and gets dropped
    },
  ]

  const cleaned = filterBlockedArtistsFromShelves(shelves, blocked)
  assert.strictEqual(cleaned.length, 1)
  assert.strictEqual(cleaned[0]!.title, 'Mixed Shelf')
  assert.strictEqual(cleaned[0]!.items.length, 1)
  assert.strictEqual(cleaned[0]!.items[0]!.id, 'gt1')
})

test('filterBlockedArtistsFromSearchResults sanitizes catalog across all categories', () => {
  resetBlockedArtistsMetrics()
  const blocked = ['UC_blocked||Blocked Artist']

  const catalog: SearchResultCatalog = {
    tracks: [
      {
        id: 't_good',
        title: 'Song Good',
        artistId: 'UC_good',
        artistName: 'Good Artist',
        albumId: 'a1',
        albumTitle: 'A1',
        albumImage: '',
        artwork: '',
        durationMs: 180000,
        durationSeconds: 180,
        explicit: false,
        playCount: 1,
      },
      {
        id: 't_bad',
        title: 'Song Bad',
        artistId: 'UC_blocked',
        artistName: 'Blocked Artist',
        albumId: 'a2',
        albumTitle: 'A2',
        albumImage: '',
        artwork: '',
        durationMs: 180000,
        durationSeconds: 180,
        explicit: false,
        playCount: 1,
      },
    ],
    albums: [
      {
        id: 'al_good',
        title: 'Album Good',
        artistId: 'UC_good',
        artistName: 'Good Artist',
        image: '',
      },
      {
        id: 'al_bad',
        title: 'Album Bad',
        artistId: 'UC_blocked',
        artistName: 'Blocked Artist',
        image: '',
      },
    ],
    artists: [
      { id: 'UC_good', name: 'Good Artist', image: '' },
      { id: 'UC_blocked', name: 'Blocked Artist', image: '' },
    ],
    playlists: [
      { id: 'p_good', title: 'P Good', author: 'Good Artist', image: '' },
      { id: 'p_bad', title: 'P Bad', author: 'Blocked Artist', image: '' },
    ],
  }

  const result = filterBlockedArtistsFromSearchResults(catalog, blocked)
  assert.strictEqual(result.tracks.length, 1)
  assert.strictEqual(result.tracks[0]!.id, 't_good')
  assert.strictEqual(result.albums.length, 1)
  assert.strictEqual(result.albums[0]!.id, 'al_good')
  assert.strictEqual(result.artists.length, 1)
  assert.strictEqual(result.artists[0]!.id, 'UC_good')
  assert.strictEqual(result.playlists.length, 1)
  assert.strictEqual(result.playlists[0]!.id, 'p_good')
})

test('QueueManager.purgeBlockedArtists cleans active queue and detects activeTrack purging', () => {
  const qm = new QueueManager()
  const blocked = ['UC_bad||Bad Artist']

  const goodTrack: Track = {
    id: 'good1',
    title: 'Good Track',
    artistId: 'UC_good',
    artistName: 'Good Artist',
    albumId: 'a1',
    albumTitle: 'A1',
    albumImage: '',
    artwork: '',
    durationMs: 180000,
    durationSeconds: 180,
    explicit: false,
    playCount: 1,
  }

  const badTrack: Track = {
    id: 'bad1',
    title: 'Bad Track',
    artistId: 'UC_bad',
    artistName: 'Bad Artist',
    albumId: 'a2',
    albumTitle: 'A2',
    albumImage: '',
    artwork: '',
    durationMs: 180000,
    durationSeconds: 180,
    explicit: false,
    playCount: 1,
  }

  qm.setSourceQueue([goodTrack, badTrack], 1) // badTrack is activeTrack
  assert.strictEqual(qm.currentTrack?.id, 'bad1')

  const { purgedCount, currentTrackPurged } = qm.purgeBlockedArtists(blocked)
  assert.strictEqual(currentTrackPurged, true)
  assert.strictEqual(purgedCount >= 1, true)
  assert.strictEqual(qm.currentTrack, null)
})
