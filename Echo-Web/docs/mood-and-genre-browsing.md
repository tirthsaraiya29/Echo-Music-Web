# Mood and Genre Browsing Architecture

## Overview
The **Mood and Genre Browsing** system provides dedicated discovery hubs and landing pages for moods (Chill, Workout, Focus, Party, Romance, Sleep, Energy, Melancholy) and musical genres (Pop, Rock, Hip-Hop, Electronic, R&B, Jazz, Classical, Latin, Indie). Each category features dynamic color gradients, contextual descriptions, sub-category filters, and one-click radio actions.

## Key Capabilities

1. **Curated Moods & Genres Catalog**:
   - **8 Core Moods**:
     - ☕ **Chill**: Relaxing acoustic, lo-fi, ambient, and chillhop.
     - ⚡ **Workout**: High-energy cardio, HIIT, and gym beats.
     - 🧠 **Focus**: Deep concentration, instrumental soundscapes, and study flow.
     - 🎉 **Party**: Upbeat dance, club anthems, and remixes.
     - 💖 **Romance**: Slow jams, acoustic love songs, and R&B duets.
     - 🌙 **Sleep**: Ambient textures, piano lullabies, and calm meditation.
     - 🔥 **Energy**: Bass-boosted, driving uptempo anthems and rock tracks.
     - 🌧️ **Melancholy**: Soulful reflections, sad indie, and cathartic acoustics.
   - **9 Core Genres**:
     - 🎤 **Pop**: Chart-toppers, dance pop, and synthpop.
     - 🎸 **Rock**: Classic rock, alternative, and hard rock.
     - 🎧 **Hip-Hop**: Rap hits, boom bap, trap, and melodic flows.
     - 🎛️ **Electronic**: House, techno, synthwave, trance, and future bass.
     - 🎷 **R&B & Soul**: Contemporary R&B, neo-soul, and classic soul.
     - 🎺 **Jazz**: Smooth jazz, bebop, and modern jazz fusion.
     - 🎻 **Classical**: Orchestral symphonies, solo piano, and baroque.
     - 🪇 **Latin**: Reggaeton, Latin pop, and bachata.
     - 🌱 **Indie & Alternative**: Indie rock, folk, dream pop, and shoegaze.

2. **Dedicated Landing Pages (`/moods/:id` and `/genre/:id`)**:
   - Accessible from the Discover view or direct URL navigation.
   - Implemented in [`MoodGenrePage.tsx`](file:///c:/Users/tirth/Downloads/Projects/Echo-Music/Echo-Web/src/pages/MoodGenrePage.tsx).
   - Features dynamic hero gradients matching the mood's atmosphere.
   - Sub-filters allow instant filtering (e.g., switching from "All" to "Lo-Fi" or "Ambient").

3. **Mood & Genre Radio Engine**:
   - **Start Radio** action launches an infinite radio queue centered on the mood or genre.
   - Automatically names the playback queue (e.g. `Chill Radio`, `Rock Radio`).
   - Seamlessly pairs with `QueueManager` continuation to maintain continuous playback.

4. **Discover View Integration**:
   - Under the "Moods & Genres" tab in `DiscoverPage`, users are greeted with responsive visual tiles.
   - Every tile features $\ge 44$px touch targets, accessible titles, and smooth hover elevation.

5. **Caching & Telemetry**:
   - Queries are cached locally in Dexie database `metadataCache` with a 2-hour TTL.
   - Metrics tracked:
     - `viewsLoaded`: Total landing page views loaded.
     - `radiosStarted`: Radio sessions initiated from mood/genre views.
     - `filterSwitches`: Category sub-filter refinements triggered.
     - `lastMoodGenre`: Most recent mood/genre viewed.
     - `lastError`: Error message if any fetch failed.
