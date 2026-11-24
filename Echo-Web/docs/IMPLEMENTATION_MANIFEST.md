# Echo Music Web — Implementation Manifest

This manifest records the status, commit SHA, and verification for every phase of the autonomous production implementation.

## Phase 0: Repository Integration Baseline

| Phase ID | Description | Status | Commit SHA | Verified |
|---|---|---|---|---|
| P00 | Fast-forward merge web integration branch to main and verify baseline | Completed | ae640dc95fd65a09e92f13e4acdcade80e6287b6 | Yes (pushed to origin/main) |

## Phase 1: Source Findings (BUG-01 to BUG-46)

| Phase ID | Priority | Description | Target Files | Status | Commit SHA | Verified |
|---|---|---|---|---|---|---|
| BUG-01 | P0 | Crossfade queue promotion is missing | `src/engine/AudioEngine.ts, src/engine/DeckController.ts, src/engine/QueueManager.ts` | Completed | c9acb71963329872881908c209edf2f1a15383ef | Yes (verified on origin/main) |
| BUG-02 | P0 | Zustand queue actions mutate the same queue twice | `src/stores/useEchoStore.ts, src/hooks/useAudioEngine.ts, src/engine/AudioEngine.ts` | Completed | 5a4b9d92b6d6b1dbe997f1b0354d8041120f89f5 | Yes (verified on origin/main) |
| BUG-03 | P0 | Track object identity changes on playback ticks | `src/engine/QueueManager.ts, src/engine/AudioEngine.ts, src/hooks/useAudioEngine.ts, src/components/player/LyricsView.tsx, src/components/player/CanvasVideo.tsx` | Completed | 71656d0b98c11e3b6f368c4aa8b69bd7bab06321 | Yes (verified on origin/main) |
| BUG-04 | P0 | Production API deployment is not defined in the repository | `vite.config.ts, server/index.ts, src/services/api.ts` | Completed | bfd7ca262b714ccd0219e4b23da621a283d128d6 | Yes (verified on origin/main) |
| BUG-05 | P1 | Listen Together is HTTP polling, not WebSockets | `src/services/listenTogether/listenTogetherClient.ts, server/routes/listenTogether.ts, README.md` | Completed | cba9946bf8d135409549f39aa1ce54f38e6e5dd2 | Yes (verified on origin/main) |
| BUG-06 | P1 | Listen Together host updates can flood the backend | `src/components/modals/ListenTogetherModal.tsx, src/hooks/useAudioEngine.ts, src/services/listenTogether/listenTogetherClient.ts` | Completed | 461fbac580c85bca3b22bcf428613fc0ebff5869 | Yes (verified on origin/main) |
| BUG-07 | P1 | Listen Together room expiry ignores active heartbeats | `server/routes/listenTogether.ts` | Completed | e1fefebfe8846c268875ea0112a5dbd4d03da0a0 | Yes (verified on origin/main) |
| BUG-08 | P1 | Listen Together state is mutated in place | `src/services/listenTogether/listenTogetherClient.ts, src/components/modals/ListenTogetherModal.tsx` | Completed | 6ef1c2409748fae08f5d054593457a44f8ae7483 | Yes (verified on origin/main) |
| BUG-09 | P1 | Streaming proxy redirect validation is missing | `server/routes/stream.ts, server/routes/canvas.ts` | Completed | d3c624578fe664aa8a960fb58ea0b7593c6665e8 | Yes (verified on origin/main) |
| BUG-10 | P1 | Queue snapshot restoration loses source cursor context | `src/engine/QueueManager.ts` | Completed | 2bdc15264b3c4f74d47d48dc70a5cbb7eb8f4203 | Yes (verified on origin/main) |
| BUG-11 | P1 | Backup and restore use a second playlist store | `src/services/db/echoDatabase.ts, src/stores/useEchoStore.ts, src/components/modals/SpotifyImportModal.tsx, src/pages/SettingsPage.tsx` | Completed | db1887f3b890a9435b5a76c66cf64cf3bf5b61fa | Yes (verified on origin/main) |
| BUG-12 | P1 | Clear History leaves persisted recent items intact | `src/pages/SettingsPage.tsx, src/services/db/echoDatabase.ts, src/stores/useEchoStore.ts` | Completed | cb0eb1bed5b0cf5d3a54b679469248ae3ce2860d | Yes (verified on origin/main) |
| BUG-13 | P1 | Cast is not wired into playback | `src/services/cast/castService.ts, src/components/player/AudioOutputPicker.tsx` | Completed | 1e525ee82ea574eeea22ea794dc2cb927aa8fa2e | Yes (verified on origin/main) |
| BUG-14 | P1 | Cast media type is hardcoded | `src/services/cast/castService.ts, src/engine/AudioEngine.ts` | Completed | 3f8d4c6b | Yes (verified on origin/main) |
| BUG-15 | P1 | Local Taste skip penalties are unreachable | `src/services/recommendations/localTasteEngine.ts, src/engine/AudioEngine.ts` | Completed | cb1b9b4c | Yes (verified on origin/main) |
| BUG-16 | P1 | Lyrics provider preference is ignored | `src/pages/SettingsPage.tsx, src/services/lyrics/LyricsOrchestrator.ts` | Completed | 6977efb6 | Yes (verified on origin/main) |
| BUG-17 | P1 | Several settings are inert or only partially implemented | `src/types/domain.ts, src/pages/SettingsPage.tsx, src/engine/AudioEngine.ts, src/services/innertube/client.ts, src/stores/useEchoStore.ts` | Completed | 93e595d6 | Yes (verified on origin/main) |
| BUG-18 | P1 | Negative cache entries never expire | `src/services/lyrics/LyricsOrchestrator.ts, src/services/canvas/CanvasManager.ts` | Completed | ae98e84d | Yes (verified on origin/main) |
| BUG-19 | P1 | Stale metadata cache revalidation is not deduplicated | `src/services/cache/metadataCache.ts` | Completed | bf35917c | Yes (verified on origin/main) |
| BUG-20 | P1 | Metadata cache cap is not a hard cap | `src/services/cache/metadataCache.ts` | Completed | 94940f68 | Yes (verified on origin/main) |
| BUG-21 | P1 | Security tests do not exercise production allowlist code | `test/security.test.ts, server/routes/stream.ts, server/routes/canvas.ts` | Completed | d6e617c1 | Yes (verified on origin/main) |
| BUG-22 | P1 | CI does not run tests | `.github/workflows/ci.yml, package.json` | Completed | 10861db1 | Yes (verified on origin/main) |
| BUG-23 | P2 | Spotify matching accepts the first search result | `src/services/spotify/spotifyImporter.ts` | Completed | 7cd0beac | Yes (verified on origin/main) |
| BUG-24 | P2 | Spotify importer has no robust pagination or live-library flow | `server/routes/spotify.ts, src/services/spotify/spotifyImporter.ts` | Completed | f1bf5730 | Yes (verified on origin/main) |
| BUG-25 | P2 | Lyrics loading state is never activated | `src/components/player/LyricsView.tsx` | Completed | 913ca8df | Yes (verified on origin/main) |
| BUG-26 | P2 | Lyrics animation re-renders the full view every frame | `src/components/player/LyricsView.tsx` | Completed | b6106009 | Yes (verified on origin/main) |
| BUG-27 | P2 | Local artwork object URLs are not revoked | `src/services/local/localMusicScanner.ts, src/services/db/echoDatabase.ts` | Completed | 0a903e37 | Yes (verified on origin/main) |
| BUG-28 | P2 | Local metadata parser does not implement its ID3v1 claim | `src/services/local/localMusicScanner.ts` | Completed | a04860e4 | Yes (verified on origin/main) |
| BUG-29 | P2 | Audio output selection ignores failure | `src/components/player/AudioOutputPicker.tsx` | Completed | 7f5c8a90 | Yes (verified on origin/main) |
| BUG-30 | P2 | First Cast click can silently fail | `src/services/cast/castService.ts, src/components/player/AudioOutputPicker.tsx` | Completed | 0e6be1d5 | Yes (verified on origin/main) |
| BUG-31 | P2 | The room code UI length conflicts with generated codes | `src/components/modals/ListenTogetherModal.tsx, server/routes/listenTogether.ts` | Completed | a275b8d3 | Yes (verified on origin/main) |
| BUG-32 | P2 | Room code entropy is lower than the alphabet suggests | `server/routes/listenTogether.ts` | Completed | 771dc1d3 | Yes (verified on origin/main) |
| BUG-33 | P2 | Room rate limiting trusts forwarded IP input | `server/routes/listenTogether.ts` | Completed | dc34bbb4 | Yes (verified on origin/main) |
| BUG-34 | P2 | Room resource limits are incomplete | `server/routes/listenTogether.ts` | Completed | be81d3e5 | Yes (verified on origin/main) |
| BUG-35 | P2 | Range parsing is incomplete | `server/routes/stream.ts` | Completed | ff3cad00 | Yes (verified on origin/main) |
| BUG-36 | P2 | Stream-info requests are not deduplicated | `server/routes/stream.ts` | Completed | 88dd7c1a | Yes (verified on origin/main) |
| BUG-37 | P2 | Data Saver description overpromises | `src/pages/SettingsPage.tsx, src/engine/AudioEngine.ts` | Completed | 1f5d00b8 | Yes (verified on origin/main) |
| BUG-38 | P2 | Lossless marketing metadata is inconsistent | `index.html, server/routes/stream.ts, src/pages/SettingsPage.tsx` | Completed | 655a9f54 | Yes (verified on origin/main) |
| BUG-39 | P2 | Podcast data exists without a complete podcast product surface | `src/services/db/echoDatabase.ts, src/engine/AudioEngine.ts, src/App.tsx` | Completed | e3006974 | Yes (verified on origin/main) |
| BUG-40 | P2 | Music Flow is absent | `src/App.tsx, src/pages, src/components` | Completed | 98d232ff | Yes (verified on origin/main) |
| BUG-41 | P2 | Cloud media providers are absent | `src/services, server/routes` | Completed | 434b77bc | Yes (verified on origin/main) |
| BUG-42 | P2 | Extension audio framework is absent | `src/services, server/routes, src/types` | Completed | 80ccc061 | Yes (verified on origin/main) |
| BUG-43 | P2 | Browser Discord integration is deployment-dependent | `server/routes/discord.ts, src/services` | Completed | 73bf0feb | Yes (verified on origin/main) |
| BUG-44 | P2 | Recognition is a configured integration, not a complete default service | `server/routes/recognition.ts` | Completed | c78a453e | Yes (verified on origin/main) |
| BUG-45 | P2 | Preferred content region is not propagated | `src/pages/SettingsPage.tsx, src/services/innertube/client.ts, server/utils/potoken.ts` | Completed | 644589f2 | Yes (verified on origin/main) |
| BUG-46 | P2 | Explicit-content preference is not applied | `src/pages/SettingsPage.tsx, src/services/innertube/parser.ts` | Completed | 6e9819e5 | Yes (verified on origin/main) |

## Phase 2: Small Improvements (SMALL-01 to SMALL-52)

| Phase ID | Area | Tasks (10 per area) | Status | Commit SHA | Verified |
|---|---|---|---|---|---|
| SMALL-01 | QueueManager invariants | 10 tasks in backlog | Completed | d3151875 | Yes (verified on origin/main) |
| SMALL-02 | Zustand/audio-engine bridge | 10 tasks in backlog | Completed | a30ef8c4 | Yes (verified on origin/main) |
| SMALL-03 | Dual-deck crossfade | 10 tasks in backlog | Completed | 08675e3a | Yes (verified on origin/main) |
| SMALL-04 | AudioEngine state/events | 10 tasks in backlog | Completed | 33aa4a9c | Yes (verified on origin/main) |
| SMALL-05 | Playback controls | 10 tasks in backlog | Completed | 14efde44 | Yes (verified on origin/main) |
| SMALL-06 | Audio output picker | 10 tasks in backlog | Completed | a9dd7057 | Yes (verified on origin/main) |
| SMALL-07 | Google Cast adapter | 10 tasks in backlog | Completed | 4e6654f7 | Yes (verified on origin/main) |
| SMALL-08 | Stream resolver | 10 tasks in backlog | Completed | 78a360cd | Yes (verified on origin/main) |
| SMALL-09 | HTTP Range streaming | 10 tasks in backlog | Completed | f5596cda | Yes (verified on origin/main) |
| SMALL-10 | Streaming proxy security | 10 tasks in backlog | Completed | a6a0674c | Yes (verified on origin/main) |
| SMALL-11 | InnerTube client | 10 tasks in backlog | Completed | 7fbcb420 | Yes (verified on origin/main) |
| SMALL-12 | InnerTube parser | 10 tasks in backlog | Completed | e68bc1b4 | Yes (verified on origin/main) |
| SMALL-13 | Radio continuation | 10 tasks in backlog | Completed | faee1036 | Yes (verified on origin/main) |
| SMALL-14 | Metadata cache | 10 tasks in backlog | Completed | fec180ad | Yes (verified on origin/main) |
| SMALL-15 | Home discovery shelves | 10 tasks in backlog | Completed | 5364984d | Yes (verified on origin/main) |
| SMALL-16 | Search and suggestions | 10 tasks in backlog | Completed | 7d6cdb40 | Yes (verified on origin/main) |
| SMALL-17 | Album detail pages | 10 tasks in backlog | Completed | ece6d751 | Yes (verified on origin/main) |
| SMALL-18 | Artist detail pages | 10 tasks in backlog | Completed | 55bafdf6 | Yes (verified on origin/main) |
| SMALL-19 | Playlist management | 10 tasks in backlog | Completed | dcd5c6a5 | Yes (verified on origin/main) |
| SMALL-20 | Backup and restore | 10 tasks in backlog | Completed | 6a2929c6 | Yes (verified on origin/main) |
| SMALL-21 | Listening history | 10 tasks in backlog | Completed | 62447000 | Yes (verified on origin/main) |
| SMALL-22 | Local music import | 10 tasks in backlog | Completed | acb89558 | Yes (verified on origin/main) |
| SMALL-23 | Local metadata parsing | 10 tasks in backlog | Completed | 65c6a0ae | Yes (verified on origin/main) |
| SMALL-24 | Local artwork lifecycle | 10 tasks in backlog | Completed | 8df76420 | Yes (verified on origin/main) |
| SMALL-25 | Lyrics provider orchestration | 10 tasks in backlog | Completed | 55695385 | Yes (verified on origin/main) |
| SMALL-26 | Lyrics player UI | 10 tasks in backlog | Completed | 5cd147e4 | Yes (verified on origin/main) |
| SMALL-27 | AI lyrics translation | 10 tasks in backlog | Completed | 9d745787 | Yes (verified on origin/main) |
| SMALL-28 | Canvas resolution | 10 tasks in backlog | Completed | a6163299 | Yes (verified on origin/main) |
| SMALL-29 | Canvas video rendering | 10 tasks in backlog | Completed | 65c7d1f6 | Yes (verified on origin/main) |
| SMALL-30 | Music DNA drawer | 10 tasks in backlog | Completed | db6431f4 | Yes (verified on origin/main) |
| SMALL-31 | Echo Find recording | 10 tasks in backlog | Completed | 5dbae9e2 | Yes (verified on origin/main) |
| SMALL-32 | Spotify URL resolution | 10 tasks in backlog | Completed | 6a42744f | Yes (verified on origin/main) |
| SMALL-33 | Spotify track matching | 10 tasks in backlog | Completed | 383b033f | Yes (verified on origin/main) |
| SMALL-34 | Last.fm scrobbling | 10 tasks in backlog | Completed | b0648340 | Yes (verified on origin/main) |
| SMALL-35 | Discord Rich Presence | 10 tasks in backlog | Completed | 09afe3b5 | Yes (verified on origin/main) |
| SMALL-36 | Listen Together client | 10 tasks in backlog | Completed | 99a09f44 | Yes (verified on origin/main) |
| SMALL-37 | Listen Together server | 10 tasks in backlog | Completed | d118d275 | Yes (verified on origin/main) |
| SMALL-38 | Room security and limits | 10 tasks in backlog | Completed | c448abb1 | Yes (verified on origin/main) |
| SMALL-39 | SponsorBlock integration | 10 tasks in backlog | Completed | 1d8a9267 | Yes (verified on origin/main) |
| SMALL-40 | PWA/service worker | 10 tasks in backlog | Completed | 4d64f256 | Yes (verified on origin/main) |
| SMALL-41 | Application routing | 10 tasks in backlog | Completed | 122dc654 | Yes (verified on origin/main) |
| SMALL-42 | Global layout/navigation | 10 tasks in backlog | Completed | 0e0031db | Yes (verified on origin/main) |
| SMALL-43 | Desktop player view | 10 tasks in backlog | Completed | 8ce8d56b | Yes (verified on origin/main) |
| SMALL-44 | Settings and preference plumbing | 10 tasks in backlog | Completed | 870483d7 | Yes (verified on origin/main) |
| SMALL-45 | Accessibility and keyboard navigation | 10 tasks in backlog | Completed | 58bf99f6 | Yes (verified on origin/main) |
| SMALL-46 | Theme and design tokens | 10 tasks in backlog | Completed | 1c014ee2 | Yes (verified on origin/main) |
| SMALL-47 | Artwork/image loading | 10 tasks in backlog | Completed | e4f701e4 | Yes (verified on origin/main) |
| SMALL-48 | API fetch layer | 10 tasks in backlog | Completed | 190cc973 | Yes (verified on origin/main) |
| SMALL-49 | Production deployment | 10 tasks in backlog | Completed | e024f14e | Yes (verified on origin/main) |
| SMALL-50 | CORS and HTTP headers | 10 tasks in backlog | Completed | 818718a8 | Yes (verified on origin/main) |
| SMALL-51 | Error handling and observability | 10 tasks in backlog | Completed | 91b49c2e | Yes (verified on origin/main) |
| SMALL-52 | CI and automated tests | 10 tasks in backlog | Completed | f87c95e9 | Yes (verified on origin/main) |

## Phase 3: Major Upstream Features (FEATURE-001 to FEATURE-109)

| Phase ID | Feature Name | Status | Commit SHA | Verified |
|---|---|---|---|---|
| FEATURE-001 | Custom extension registry | Completed | 0ad8c86a | Yes (verified on origin/main) |
| FEATURE-002 | Extension-first playback | Completed | 94612eff | Yes (verified on origin/main) |
| FEATURE-003 | 320 kbps source support | Completed | 473bf8ad | Yes (verified on origin/main) |
| FEATURE-004 | FLAC/ALAC lossless playback | Completed | 0998221d | Yes (verified on origin/main) |
| FEATURE-005 | Extension fallback chain | Completed | 2ae064c7 | Yes (verified on origin/main) |
| FEATURE-006 | Extension matching confidence | Completed | c5f0033e | Yes (verified on origin/main) |
| FEATURE-007 | Extension preloading | Completed | 2a321ee9 | Yes (verified on origin/main) |
| FEATURE-008 | Extension health dashboard | Completed | 1a54d5c9 | Yes (verified on origin/main) |
| FEATURE-009 | Network-aware quality tiers | Completed | fdda3c76 | Yes (verified on origin/main) |
| FEATURE-010 | Verified stream telemetry | Completed | b0032d15 | Yes (verified on origin/main) |
| FEATURE-011 | Correct crossfade promotion | Completed | 65397072 | Yes (verified on origin/main) |
| FEATURE-012 | Gapless playback | Completed | af799c2d | Yes (verified on origin/main) |
| FEATURE-013 | Equal-power crossfade profiles | Completed | 7ef179ca | Yes (verified on origin/main) |
| FEATURE-014 | Queue ownership snapshots | Completed | e96dc127 | Yes (verified on origin/main) |
| FEATURE-015 | Queue continuation paging | Completed | 235b4c97 | Yes (verified on origin/main) |
| FEATURE-016 | Radio retry and recovery | Completed | 3228c67c | Yes (verified on origin/main) |
| FEATURE-017 | Echo Brain momentum queue | Completed | 6fb4e976 | Yes (verified on origin/main) |
| FEATURE-018 | Varispeed mode | Completed | ab81cc61 | Yes (verified on origin/main) |
| FEATURE-019 | Pause on mute | Completed | 0b0eb7c3 | Yes (verified on origin/main) |
| FEATURE-020 | Bluetooth reconnect resume | Completed | 761d3bd0 | Yes (verified on origin/main) |
| FEATURE-021 | Music Flow vertical reel | Completed | a59f1e6d | Yes (verified on origin/main) |
| FEATURE-022 | Music Flow queue handoff | Completed | 456c0a7e | Yes (verified on origin/main) |
| FEATURE-023 | Echo Brain auto-injection | Completed | 6703a0c0 | Yes (verified on origin/main) |
| FEATURE-024 | Taste Mix | Completed | dde57c68 | Yes (verified on origin/main) |
| FEATURE-025 | Spotify recommendation bridge | Completed | 9dbeb56e | Yes (verified on origin/main) |
| FEATURE-026 | Charts and regional charts | Completed | af7badc0 | Yes (verified on origin/main) |
| FEATURE-027 | Mood and genre browsing | Completed | edd28ed2 | Yes (verified on origin/main) |
| FEATURE-028 | Shorts filtering | Completed | e4ff222e | Yes (verified on origin/main) |
| FEATURE-029 | Video-song filtering | Completed | f17fedc2 | Yes (verified on origin/main) |
| FEATURE-030 | Blocked artists | Completed | a8cdac09 | Yes |
| FEATURE-031 | Podcast discovery | Completed | b3dadc64 | Yes |
| FEATURE-032 | Followed podcast library | Completed | c52042ce | Yes |
| FEATURE-033 | Continue listening | Completed | fc3467f6 | Yes |
| FEATURE-034 | Episode ordering | Completed | 61c9696e | Yes |
| FEATURE-035 | Podcast playback speed | Completed | 54fbec54 | Yes |
| FEATURE-036 | Podcast skip controls | Completed | 9a1aeedd | Yes |
| FEATURE-037 | Fullscreen video podcast player | Completed | 2241b8e5 | Yes |
| FEATURE-038 | Podcast queue | Completed | 82572c18 | Yes |
| FEATURE-039 | Podcast progress sync | Completed | d192da43 | Yes |
| FEATURE-040 | Podcast metadata pages | Completed | 4bb1cc38 | Yes |
| FEATURE-041 | Live Spotify library | Completed | 26f5cf61 | Yes |
| FEATURE-042 | Spotify playlist detail pages | Completed | d7d5a5f9 | Yes |
| FEATURE-043 | YouTube Music account authentication | Completed | 4d2b9a5d | Yes |
| FEATURE-044 | Playlist cloud synchronization | Completed | fc038779 | Yes |
| FEATURE-045 | Liked albums synchronization | Completed | 3be08ac0 | Yes |
| FEATURE-046 | Followed artists synchronization | Completed | 1bd3d214 | Yes |
| FEATURE-047 | Multi-device library sync | Completed | 78ce2eb1 | Yes |
| FEATURE-048 | Library conflict resolution | Completed | 1297ecca | Yes |
| FEATURE-049 | Listening history controls | Completed | b19c1d54 | Yes |
| FEATURE-050 | Vibe Summary | Completed | 356147bf | Yes |
| FEATURE-051 | Lyrics+ provider integration | Completed | 0c31b639 | Yes |
| FEATURE-052 | Provider priority settings | Completed | 76975127 | Yes |
| FEATURE-053 | Word-by-word timing | Completed | 8fc43d3d | Yes |
| FEATURE-054 | Multiple lyric animations | Completed | 76b1cadd | Yes |
| FEATURE-055 | Romanization-aware cache | Pending | - | - |
| FEATURE-056 | AI translation chunking | Pending | - | - |
| FEATURE-057 | Translation provider testing | Pending | - | - |
| FEATURE-058 | Lyrics export with metadata | Pending | - | - |
| FEATURE-059 | Lyrics download | Pending | - | - |
| FEATURE-060 | Lyrics sync profiles | Pending | - | - |
| FEATURE-061 | Default Echo Find provider | Pending | - | - |
| FEATURE-062 | Recognition history | Pending | - | - |
| FEATURE-063 | Recognition confidence UI | Pending | - | - |
| FEATURE-064 | Music DNA expansion | Pending | - | - |
| FEATURE-065 | Artist and song knowledge graph | Pending | - | - |
| FEATURE-066 | AutoEQ headphone profiles | Pending | - | - |
| FEATURE-067 | Personalized listening insights | Pending | - | - |
| FEATURE-068 | Genre taste profiles | Pending | - | - |
| FEATURE-069 | Recommendation feedback loop | Pending | - | - |
| FEATURE-070 | Local recommendation controls | Pending | - | - |
| FEATURE-071 | Jellyfin integration | Pending | - | - |
| FEATURE-072 | Navidrome/Subsonic integration | Pending | - | - |
| FEATURE-073 | Odesli cross-platform sharing | Pending | - | - |
| FEATURE-074 | Complete Google Cast handoff | Pending | - | - |
| FEATURE-075 | Discord Rich Presence bridge | Pending | - | - |
| FEATURE-076 | Last.fm scrobble controls | Pending | - | - |
| FEATURE-077 | ListenBrainz integration | Pending | - | - |
| FEATURE-078 | Bluetooth device actions | Pending | - | - |
| FEATURE-079 | Ringtone handoff | Pending | - | - |
| FEATURE-080 | Playlist share links | Pending | - | - |
| FEATURE-081 | WebSocket transport | Pending | - | - |
| FEATURE-082 | Shared persistent room state | Pending | - | - |
| FEATURE-083 | Latency-compensated sync | Pending | - | - |
| FEATURE-084 | Drift correction | Pending | - | - |
| FEATURE-085 | Host queue synchronization | Pending | - | - |
| FEATURE-086 | Guest playback ownership | Pending | - | - |
| FEATURE-087 | Room reconnection | Pending | - | - |
| FEATURE-088 | Invite deep links and QR | Pending | - | - |
| FEATURE-089 | Room chat and reactions | Pending | - | - |
| FEATURE-090 | Room access and moderation | Pending | - | - |
| FEATURE-091 | EBU R128 loudness normalization | Pending | - | - |
| FEATURE-092 | AudioWorklet DSP pipeline | Pending | - | - |
| FEATURE-093 | Verified format badges | Pending | - | - |
| FEATURE-094 | Bit-perfect desktop companion | Pending | - | - |
| FEATURE-095 | WebUSB capability guidance | Pending | - | - |
| FEATURE-096 | Advanced EQ presets | Pending | - | - |
| FEATURE-097 | Pitch-linked varispeed | Pending | - | - |
| FEATURE-098 | Audio output persistence | Pending | - | - |
| FEATURE-099 | Audio focus policy | Pending | - | - |
| FEATURE-100 | Playback telemetry panel | Pending | - | - |
| FEATURE-101 | UI density scale | Pending | - | - |
| FEATURE-102 | High-refresh animation mode | Pending | - | - |
| FEATURE-103 | Hide player thumbnail | Pending | - | - |
| FEATURE-104 | Album-art crop controls | Pending | - | - |
| FEATURE-105 | Multiple themes and monochrome mode | Pending | - | - |
| FEATURE-106 | Expanded localization | Pending | - | - |
| FEATURE-107 | Keyboard shortcut customization | Pending | - | - |
| FEATURE-108 | PWA install onboarding | Pending | - | - |
| FEATURE-109 | Responsive accessibility audit | Pending | - | - |
