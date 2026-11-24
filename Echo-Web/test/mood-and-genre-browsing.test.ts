import test from 'node:test'
import assert from 'node:assert'
import {
  MOOD_DEFINITIONS,
  GENRE_DEFINITIONS,
  ALL_MOOD_GENRE_DEFINITIONS,
  getMoodGenreDefinition,
  fetchMoodGenreDetail,
  startMoodGenreRadio,
  getMoodGenreTelemetry,
  resetMoodGenreTelemetry,
  moodGenreDetailSchema,
} from '../src/services/recommendations/moodGenreService.ts'
import type { Track } from '../src/types/domain.ts'
import { useEchoStore } from '../src/stores/useEchoStore.ts'

function createMockTrack(id: string, title: string, artistName: string): Track {
  return {
    id,
    title,
    artistName,
    artistId: `artist-${id}`,
    albumId: `album-${id}`,
    albumTitle: `${title} Album`,
    albumImage: 'https://example.com/art.jpg',
    artwork: 'https://example.com/art.jpg',
    thumbnailUrl: 'https://example.com/art.jpg',
    durationSeconds: 195,
    durationMs: 195000,
    explicit: false,
    playCount: 50,
    videoId: id,
    streamUrl: `https://cdn.example.com/audio/${id}.mp3`,
  }
}

test('Mood and Genre: catalog definitions provide rich metadata, icons, and gradients', () => {
  assert.strictEqual(MOOD_DEFINITIONS.length >= 8, true)
  assert.strictEqual(GENRE_DEFINITIONS.length >= 9, true)
  assert.strictEqual(ALL_MOOD_GENRE_DEFINITIONS.length >= 17, true)

  const chill = getMoodGenreDefinition('chill')
  assert.strictEqual(chill.id, 'chill')
  assert.strictEqual(chill.type, 'mood')
  assert.strictEqual(chill.icon, '☕')
  assert.ok(chill.gradient.includes('from-teal-600'))
  assert.ok(chill.subFilters.includes('Lo-Fi'))

  const rock = getMoodGenreDefinition('rock')
  assert.strictEqual(rock.id, 'rock')
  assert.strictEqual(rock.type, 'genre')
  assert.strictEqual(rock.icon, '🎸')
  assert.ok(rock.subFilters.includes('Alternative'))

  const fallback = getMoodGenreDefinition('custom_mood')
  assert.strictEqual(fallback.id, 'custom_mood')
  assert.strictEqual(fallback.title, 'Custom_mood')
})

test('Mood and Genre: fetchMoodGenreDetail returns structured detail conforming to schema', async () => {
  resetMoodGenreTelemetry()

  const fallbackTracks: Track[] = [
    createMockTrack('m1', 'Chill Breeze', 'Lo-Fi Master'),
    createMockTrack('m2', 'Mellow Waves', 'Ambient Project'),
  ]

  const detail = await fetchMoodGenreDetail('chill', 'All', { fallbackTracks })

  // Schema validation
  assert.doesNotThrow(() => moodGenreDetailSchema.parse(detail))

  assert.strictEqual(detail.id, 'chill')
  assert.strictEqual(detail.title, 'Chill')
  assert.strictEqual(detail.activeFilter, 'All')
  assert.strictEqual(detail.tracks.length, 2)

  const telemetry = getMoodGenreTelemetry()
  assert.strictEqual(telemetry.viewsLoaded, 1)
  assert.strictEqual(telemetry.lastMoodGenre, 'chill')
})

test('Mood and Genre: sub-filter refinement returns sub-category tracks and state', async () => {
  resetMoodGenreTelemetry()

  const fallbackTracks: Track[] = [
    createMockTrack('wf1', 'Heavy Lifts', 'Gym Beast'),
  ]

  const detail = await fetchMoodGenreDetail('workout', 'HIIT', { fallbackTracks })

  assert.strictEqual(detail.id, 'workout')
  assert.strictEqual(detail.activeFilter, 'HIIT')
  assert.strictEqual(detail.tracks.length, 1)

  const telemetry = getMoodGenreTelemetry()
  assert.strictEqual(telemetry.viewsLoaded, 1)
  assert.strictEqual(telemetry.lastMoodGenre, 'workout')
})

test('Mood and Genre: startMoodGenreRadio initiates queue with mood context', () => {
  resetMoodGenreTelemetry()

  const originalPlayQueue = useEchoStore.getState().playQueue
  let queuedTracks: Track[] = []
  useEchoStore.setState({
    playQueue: (tracks: Track[]) => {
      queuedTracks = tracks
    },
  })

  try {
    const tracks: Track[] = [
      createMockTrack('p1', 'Party Beat', 'DJ Floor'),
      createMockTrack('p2', 'Dance Anthem', 'Club Queen'),
    ]

    const result = startMoodGenreRadio('party', tracks, 0)
    assert.strictEqual(result.radioStarted, true)
    assert.strictEqual(result.title, 'Party Radio')
    assert.strictEqual(result.trackCount, 2)
    assert.strictEqual(queuedTracks.length, 2)

    const telemetry = getMoodGenreTelemetry()
    assert.strictEqual(telemetry.radiosStarted, 1)
  } finally {
    useEchoStore.setState({ playQueue: originalPlayQueue })
  }
})
