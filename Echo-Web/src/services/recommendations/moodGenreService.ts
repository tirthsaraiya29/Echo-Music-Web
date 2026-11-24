import { z } from 'zod'
import { db } from '../db/echoDatabase.ts'
import type { Track } from '../../types/domain.ts'
import { InnerTubeClient } from '../innertube/client.ts'
import { useEchoStore } from '../../stores/useEchoStore.ts'

export type MoodGenreType = 'mood' | 'genre'

export interface MoodGenreDefinition {
  id: string
  title: string
  type: MoodGenreType
  icon: string
  gradient: string
  description: string
  subFilters: string[]
  seedQuery: string
}

export const MOOD_DEFINITIONS: MoodGenreDefinition[] = [
  {
    id: 'chill',
    title: 'Chill',
    type: 'mood',
    icon: '☕',
    gradient: 'from-teal-600 to-blue-900',
    description: 'Relax, unwind, and let go with soothing melodies and mellow beats.',
    subFilters: ['All', 'Acoustic', 'Lo-Fi', 'Ambient', 'Chillhop', 'R&B Chill'],
    seedQuery: 'chill relaxing acoustic lofi beats',
  },
  {
    id: 'workout',
    title: 'Workout',
    type: 'mood',
    icon: '⚡',
    gradient: 'from-orange-600 to-red-900',
    description: 'High-octane tracks and pulsing rhythms to power your training.',
    subFilters: ['All', 'Cardio', 'Power Workout', 'HIIT', 'Gym Beats', 'EDM Workout'],
    seedQuery: 'workout motivation gym high energy',
  },
  {
    id: 'focus',
    title: 'Focus',
    type: 'mood',
    icon: '🧠',
    gradient: 'from-indigo-600 to-purple-900',
    description: 'Deep concentration, instrumental soundscapes, and study flow.',
    subFilters: ['All', 'Instrumental', 'Lo-Fi Study', 'Classical Focus', 'Deep Techno'],
    seedQuery: 'focus study instrumental concentration lo-fi',
  },
  {
    id: 'party',
    title: 'Party',
    type: 'mood',
    icon: '🎉',
    gradient: 'from-pink-600 to-rose-900',
    description: 'Dancefloor anthems, upbeat hits, and crowd-pleasing bangers.',
    subFilters: ['All', 'Club Hits', 'Dance Pop', 'Hip-Hop Party', 'Remixes'],
    seedQuery: 'party dance club upbeat pop hits',
  },
  {
    id: 'romance',
    title: 'Romance',
    type: 'mood',
    icon: '💖',
    gradient: 'from-rose-600 to-amber-900',
    description: 'Warm, intimate love songs, slow jams, and passionate ballads.',
    subFilters: ['All', 'Slow Jams', 'Acoustic Love', 'R&B Romance', 'Duets'],
    seedQuery: 'romance love songs acoustic slow jams',
  },
  {
    id: 'sleep',
    title: 'Sleep',
    type: 'mood',
    icon: '🌙',
    gradient: 'from-blue-900 to-slate-950',
    description: 'Gentle ambient textures, sleep soundscapes, and calming lulls.',
    subFilters: ['All', 'Ambient Sleep', 'Piano Lullabies', 'Dreamy Beats', 'Meditation'],
    seedQuery: 'sleep ambient soft calm piano lullaby',
  },
  {
    id: 'energy',
    title: 'Energy',
    type: 'mood',
    icon: '🔥',
    gradient: 'from-amber-600 to-orange-800',
    description: 'Maximum momentum, driving basslines, and adrenaline boosts.',
    subFilters: ['All', 'Bass Boosted', 'Rock Anthems', 'Uptempo Pop', 'Trap'],
    seedQuery: 'energy fast uptempo anthems powerful bass',
  },
  {
    id: 'sad',
    title: 'Melancholy',
    type: 'mood',
    icon: '🌧️',
    gradient: 'from-slate-700 to-blue-950',
    description: 'Emotional, soulful reflections and cathartic heartbreak tunes.',
    subFilters: ['All', 'Heartbreak', 'Sad Indie', 'Acoustic Sad', 'Late Night Blues'],
    seedQuery: 'sad heartbreak emotional acoustic melancholy',
  },
]

export const GENRE_DEFINITIONS: MoodGenreDefinition[] = [
  {
    id: 'pop',
    title: 'Pop',
    type: 'genre',
    icon: '🎤',
    gradient: 'from-fuchsia-600 to-purple-900',
    description: 'Global chart-toppers, catchy hooks, and vibrant pop anthems.',
    subFilters: ['All', 'Top Pop', 'Indie Pop', 'Dance Pop', 'Synthpop'],
    seedQuery: 'pop music top hits trending songs',
  },
  {
    id: 'rock',
    title: 'Rock',
    type: 'genre',
    icon: '🎸',
    gradient: 'from-red-700 to-stone-900',
    description: 'Guitars, raw energy, legendary riffs, and modern rock vibes.',
    subFilters: ['All', 'Classic Rock', 'Alternative', 'Hard Rock', 'Indie Rock'],
    seedQuery: 'rock alternative classic rock guitar',
  },
  {
    id: 'hip-hop',
    title: 'Hip-Hop',
    type: 'genre',
    icon: '🎧',
    gradient: 'from-yellow-600 to-stone-900',
    description: 'Beats, bars, golden-era classics, and cutting-edge flows.',
    subFilters: ['All', 'Rap Hits', 'Boom Bap', 'Trap', 'Melodic Rap'],
    seedQuery: 'hip hop rap beats trap trending',
  },
  {
    id: 'electronic',
    title: 'Electronic',
    type: 'genre',
    icon: '🎛️',
    gradient: 'from-cyan-600 to-blue-900',
    description: 'House, techno, synthwave, trance, and future bass.',
    subFilters: ['All', 'House', 'Techno', 'Synthwave', 'EDM', 'Trance'],
    seedQuery: 'electronic edm house techno synthwave dance',
  },
  {
    id: 'r-and-b',
    title: 'R&B & Soul',
    type: 'genre',
    icon: '🎷',
    gradient: 'from-purple-700 to-indigo-950',
    description: 'Velvet vocals, sultry neo-soul, and classic grooves.',
    subFilters: ['All', 'Contemporary R&B', 'Neo-Soul', 'Classic Soul', 'Slow Jams'],
    seedQuery: 'r&b soul neo-soul contemporary slow jams',
  },
  {
    id: 'jazz',
    title: 'Jazz',
    type: 'genre',
    icon: '🎺',
    gradient: 'from-amber-700 to-yellow-950',
    description: 'Improvisation, cool jazz standards, bebop, and modern jazz fusion.',
    subFilters: ['All', 'Smooth Jazz', 'Bebop', 'Vocal Jazz', 'Late Night Jazz'],
    seedQuery: 'jazz smooth jazz bebop standards quartet',
  },
  {
    id: 'classical',
    title: 'Classical',
    type: 'genre',
    icon: '🎻',
    gradient: 'from-amber-800 to-stone-900',
    description: 'Timeless symphonies, piano sonatas, and cinematic masterpieces.',
    subFilters: ['All', 'Orchestral', 'Solo Piano', 'Baroque', 'Cinematic'],
    seedQuery: 'classical symphony piano orchestra concerto',
  },
  {
    id: 'latin',
    title: 'Latin',
    type: 'genre',
    icon: '🪇',
    gradient: 'from-emerald-600 to-teal-900',
    description: 'Reggaeton, salsa, bachata, cumbia, and Latin pop rhythms.',
    subFilters: ['All', 'Reggaeton', 'Latin Pop', 'Salsa', 'Bachata'],
    seedQuery: 'latin reggaeton salsa bachata pop urbano',
  },
  {
    id: 'indie',
    title: 'Indie & Alternative',
    type: 'genre',
    icon: '🌱',
    gradient: 'from-emerald-700 to-slate-900',
    description: 'Autonomous sounds, indie folk, dream pop, and bedroom lo-fi.',
    subFilters: ['All', 'Indie Rock', 'Indie Folk', 'Dream Pop', 'Shoegaze'],
    seedQuery: 'indie alternative folk dream pop bedroom',
  },
]

export const ALL_MOOD_GENRE_DEFINITIONS: MoodGenreDefinition[] = [
  ...MOOD_DEFINITIONS,
  ...GENRE_DEFINITIONS,
]

export const moodGenreDetailSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: z.enum(['mood', 'genre']),
  icon: z.string(),
  gradient: z.string(),
  description: z.string(),
  subFilters: z.array(z.string()),
  activeFilter: z.string(),
  tracks: z.array(
    z.custom<Track>(
      (val) => typeof val === 'object' && val !== null && 'id' in val && 'title' in val,
    ),
  ),
  updatedAt: z.number().positive(),
})

export type MoodGenreDetail = z.infer<typeof moodGenreDetailSchema>

export const moodGenreTelemetrySchema = z.object({
  viewsLoaded: z.number().nonnegative(),
  radiosStarted: z.number().nonnegative(),
  filterSwitches: z.number().nonnegative(),
  lastMoodGenre: z.string(),
  lastError: z.string().nullable(),
})

export type MoodGenreTelemetry = z.infer<typeof moodGenreTelemetrySchema>

const telemetry: MoodGenreTelemetry = {
  viewsLoaded: 0,
  radiosStarted: 0,
  filterSwitches: 0,
  lastMoodGenre: 'chill',
  lastError: null,
}

export function getMoodGenreTelemetry(): MoodGenreTelemetry {
  return { ...telemetry }
}

export function resetMoodGenreTelemetry(): void {
  telemetry.viewsLoaded = 0
  telemetry.radiosStarted = 0
  telemetry.filterSwitches = 0
  telemetry.lastMoodGenre = 'chill'
  telemetry.lastError = null
}

export function getMoodGenreDefinition(id: string): MoodGenreDefinition {
  const norm = id.toLowerCase().trim()
  const found = ALL_MOOD_GENRE_DEFINITIONS.find((d) => d.id === norm)
  if (found) return found

  // Fallback for custom or unknown category
  return {
    id: norm,
    title: norm.charAt(0).toUpperCase() + norm.slice(1),
    type: 'mood',
    icon: '🎵',
    gradient: 'from-purple-700 to-indigo-900',
    description: `Curated music and radio stream for ${norm}.`,
    subFilters: ['All', 'Popular', 'Recent', 'Essential'],
    seedQuery: `${norm} music hits`,
  }
}

/**
 * Fetch detailed landing page content and tracks for a mood or genre
 */
export async function fetchMoodGenreDetail(
  id: string,
  subFilter = 'All',
  options?: { signal?: AbortSignal; fallbackTracks?: Track[] },
): Promise<MoodGenreDetail> {
  const def = getMoodGenreDefinition(id)
  telemetry.lastMoodGenre = def.id

  const cacheKey = `mood_genre_${def.id}_${subFilter.toLowerCase().replace(/\s+/g, '_')}`

  // 1. Check Dexie metadataCache
  if (typeof indexedDB !== 'undefined' && db?.metadataCache) {
    try {
      const cached = await db.metadataCache.get(cacheKey)
      if (cached && cached.data) {
        const parsed = moodGenreDetailSchema.safeParse(cached.data)
        if (parsed.success && Date.now() < cached.expiresAt) {
          telemetry.viewsLoaded++
          return parsed.data
        }
      }
    } catch {
      // Non-fatal
    }
  }

  let tracks: Track[] = []

  // 2. Query InnerTube search/browse for mood/genre tracks
  try {
    const queryTerm = subFilter === 'All' ? def.seedQuery : `${def.title} ${subFilter}`
    const searchRes = await InnerTubeClient.search(
      queryTerm,
      'songs',
      options?.signal ? { signal: options.signal } : undefined,
    )
    if (searchRes && searchRes.tracks && searchRes.tracks.length > 0) {
      tracks = searchRes.tracks
    }
  } catch (err) {
    telemetry.lastError = err instanceof Error ? err.message : String(err)
  }

  // Fallback tracks if remote query fails or returns empty
  if (tracks.length === 0 && options?.fallbackTracks && options.fallbackTracks.length > 0) {
    tracks = options.fallbackTracks
  }

  const detail: MoodGenreDetail = {
    id: def.id,
    title: def.title,
    type: def.type,
    icon: def.icon,
    gradient: def.gradient,
    description: def.description,
    subFilters: def.subFilters,
    activeFilter: subFilter,
    tracks,
    updatedAt: Date.now(),
  }

  // 3. Persist to Dexie metadataCache (2h TTL)
  if (typeof indexedDB !== 'undefined' && db?.metadataCache && tracks.length > 0) {
    try {
      await db.metadataCache.put({
        key: cacheKey,
        kind: 'shelf',
        data: detail,
        updatedAt: Date.now(),
        expiresAt: Date.now() + 2 * 60 * 60 * 1000,
      })
    } catch {
      // Non-fatal
    }
  }

  telemetry.viewsLoaded++
  return moodGenreDetailSchema.parse(detail)
}

/**
 * Launch an infinite radio queue for a specific mood or genre
 */
export function startMoodGenreRadio(
  moodOrGenreId: string,
  tracks: Track[],
  startIndex = 0,
): { radioStarted: boolean; title: string; trackCount: number } {
  const def = getMoodGenreDefinition(moodOrGenreId)
  if (!tracks || tracks.length === 0) {
    return { radioStarted: false, title: `${def.title} Radio`, trackCount: 0 }
  }

  const radioTitle = `${def.title} Radio`
  const store = useEchoStore.getState()
  store.playQueue(tracks, startIndex)
  store.setToast(`Started ${radioTitle}`)

  telemetry.radiosStarted++
  return { radioStarted: true, title: radioTitle, trackCount: tracks.length }
}
