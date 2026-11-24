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
| BUG-33 | P2 | Room rate limiting trusts forwarded IP input | `server/routes/listenTogether.ts` | Pending | - | - |
| BUG-34 | P2 | Room resource limits are incomplete | `server/routes/listenTogether.ts` | Pending | - | - |
| BUG-35 | P2 | Range parsing is incomplete | `server/routes/stream.ts` | Pending | - | - |
| BUG-36 | P2 | Stream-info requests are not deduplicated | `server/routes/stream.ts` | Pending | - | - |
| BUG-37 | P2 | Data Saver description overpromises | `src/pages/SettingsPage.tsx, src/engine/AudioEngine.ts` | Pending | - | - |
| BUG-38 | P2 | Lossless marketing metadata is inconsistent | `index.html, server/routes/stream.ts, src/pages/SettingsPage.tsx` | Pending | - | - |
| BUG-39 | P2 | Podcast data exists without a complete podcast product surface | `src/services/db/echoDatabase.ts, src/engine/AudioEngine.ts, src/App.tsx` | Pending | - | - |
| BUG-40 | P2 | Music Flow is absent | `src/App.tsx, src/pages, src/components` | Pending | - | - |
| BUG-41 | P2 | Cloud media providers are absent | `src/services, server/routes` | Pending | - | - |
| BUG-42 | P2 | Extension audio framework is absent | `src/services, server/routes, src/types` | Pending | - | - |
| BUG-43 | P2 | Browser Discord integration is deployment-dependent | `server/routes/discord.ts, src/services` | Pending | - | - |
| BUG-44 | P2 | Recognition is a configured integration, not a complete default service | `server/routes/recognition.ts` | Pending | - | - |
| BUG-45 | P2 | Preferred content region is not propagated | `src/pages/SettingsPage.tsx, src/services/innertube/client.ts, server/utils/potoken.ts` | Pending | - | - |
| BUG-46 | P2 | Explicit-content preference is not applied | `src/pages/SettingsPage.tsx, src/services/innertube/parser.ts` | Pending | - | - |

## Phase 2: Small Improvements (SMALL-01 to SMALL-52)

| Phase ID | Area | Tasks (10 per area) | Status | Commit SHA | Verified |
|---|---|---|---|---|---|
| SMALL-01 | QueueManager invariants | 10 tasks in backlog | Pending | - | - |
| SMALL-02 | Zustand/audio-engine bridge | 10 tasks in backlog | Pending | - | - |
| SMALL-03 | Dual-deck crossfade | 10 tasks in backlog | Pending | - | - |
| SMALL-04 | AudioEngine state/events | 10 tasks in backlog | Pending | - | - |
| SMALL-05 | Playback controls | 10 tasks in backlog | Pending | - | - |
| SMALL-06 | Audio output picker | 10 tasks in backlog | Pending | - | - |
| SMALL-07 | Google Cast adapter | 10 tasks in backlog | Pending | - | - |
| SMALL-08 | Stream resolver | 10 tasks in backlog | Pending | - | - |
| SMALL-09 | HTTP Range streaming | 10 tasks in backlog | Pending | - | - |
| SMALL-10 | Streaming proxy security | 10 tasks in backlog | Pending | - | - |
| SMALL-11 | InnerTube client | 10 tasks in backlog | Pending | - | - |
| SMALL-12 | InnerTube parser | 10 tasks in backlog | Pending | - | - |
| SMALL-13 | Radio continuation | 10 tasks in backlog | Pending | - | - |
| SMALL-14 | Metadata cache | 10 tasks in backlog | Pending | - | - |
| SMALL-15 | Home discovery shelves | 10 tasks in backlog | Pending | - | - |
| SMALL-16 | Search and suggestions | 10 tasks in backlog | Pending | - | - |
| SMALL-17 | Album detail pages | 10 tasks in backlog | Pending | - | - |
| SMALL-18 | Artist detail pages | 10 tasks in backlog | Pending | - | - |
| SMALL-19 | Playlist management | 10 tasks in backlog | Pending | - | - |
| SMALL-20 | Backup and restore | 10 tasks in backlog | Pending | - | - |
| SMALL-21 | Listening history | 10 tasks in backlog | Pending | - | - |
| SMALL-22 | Local music import | 10 tasks in backlog | Pending | - | - |
| SMALL-23 | Local metadata parsing | 10 tasks in backlog | Pending | - | - |
| SMALL-24 | Local artwork lifecycle | 10 tasks in backlog | Pending | - | - |
| SMALL-25 | Lyrics provider orchestration | 10 tasks in backlog | Pending | - | - |
| SMALL-26 | Lyrics player UI | 10 tasks in backlog | Pending | - | - |
| SMALL-27 | AI lyrics translation | 10 tasks in backlog | Pending | - | - |
| SMALL-28 | Canvas resolution | 10 tasks in backlog | Pending | - | - |
| SMALL-29 | Canvas video rendering | 10 tasks in backlog | Pending | - | - |
| SMALL-30 | Music DNA drawer | 10 tasks in backlog | Pending | - | - |
| SMALL-31 | Echo Find recording | 10 tasks in backlog | Pending | - | - |
| SMALL-32 | Spotify URL resolution | 10 tasks in backlog | Pending | - | - |
| SMALL-33 | Spotify track matching | 10 tasks in backlog | Pending | - | - |
| SMALL-34 | Last.fm scrobbling | 10 tasks in backlog | Pending | - | - |
| SMALL-35 | Discord Rich Presence | 10 tasks in backlog | Pending | - | - |
| SMALL-36 | Listen Together client | 10 tasks in backlog | Pending | - | - |
| SMALL-37 | Listen Together server | 10 tasks in backlog | Pending | - | - |
| SMALL-38 | Room security and limits | 10 tasks in backlog | Pending | - | - |
| SMALL-39 | SponsorBlock integration | 10 tasks in backlog | Pending | - | - |
| SMALL-40 | PWA/service worker | 10 tasks in backlog | Pending | - | - |
| SMALL-41 | Application routing | 10 tasks in backlog | Pending | - | - |
| SMALL-42 | Global layout/navigation | 10 tasks in backlog | Pending | - | - |
| SMALL-43 | Desktop player view | 10 tasks in backlog | Pending | - | - |
| SMALL-44 | Settings and preference plumbing | 10 tasks in backlog | Pending | - | - |
| SMALL-45 | Accessibility and keyboard navigation | 10 tasks in backlog | Pending | - | - |
| SMALL-46 | Theme and design tokens | 10 tasks in backlog | Pending | - | - |
| SMALL-47 | Artwork/image loading | 10 tasks in backlog | Pending | - | - |
| SMALL-48 | API fetch layer | 10 tasks in backlog | Pending | - | - |
| SMALL-49 | Production deployment | 10 tasks in backlog | Pending | - | - |
| SMALL-50 | CORS and HTTP headers | 10 tasks in backlog | Pending | - | - |
| SMALL-51 | Error handling and observability | 10 tasks in backlog | Pending | - | - |
| SMALL-52 | CI and automated tests | 10 tasks in backlog | Pending | - | - |

## Phase 3: Major Upstream Features (FEATURE-001 to FEATURE-109)

| Phase ID | Feature Name | Status | Commit SHA | Verified |
|---|---|---|---|---|
| FEATURE-001 | Custom extension registry | Pending | - | - |
| FEATURE-002 | Extension-first playback | Pending | - | - |
| FEATURE-003 | 320 kbps source support | Pending | - | - |
| FEATURE-004 | FLAC/ALAC lossless playback | Pending | - | - |
| FEATURE-005 | Extension fallback chain | Pending | - | - |
| FEATURE-006 | Extension matching confidence | Pending | - | - |
| FEATURE-007 | Extension preloading | Pending | - | - |
| FEATURE-008 | Extension health dashboard | Pending | - | - |
| FEATURE-009 | Network-aware quality tiers | Pending | - | - |
| FEATURE-010 | Verified stream telemetry | Pending | - | - |
| FEATURE-011 | Correct crossfade promotion | Pending | - | - |
| FEATURE-012 | Gapless playback | Pending | - | - |
| FEATURE-013 | Equal-power crossfade profiles | Pending | - | - |
| FEATURE-014 | Queue ownership snapshots | Pending | - | - |
| FEATURE-015 | Queue continuation paging | Pending | - | - |
| FEATURE-016 | Radio retry and recovery | Pending | - | - |
| FEATURE-017 | Echo Brain momentum queue | Pending | - | - |
| FEATURE-018 | Varispeed mode | Pending | - | - |
| FEATURE-019 | Pause on mute | Pending | - | - |
| FEATURE-020 | Bluetooth reconnect resume | Pending | - | - |
| FEATURE-021 | Music Flow vertical reel | Pending | - | - |
| FEATURE-022 | Music Flow queue handoff | Pending | - | - |
| FEATURE-023 | Echo Brain auto-injection | Pending | - | - |
| FEATURE-024 | Taste Mix | Pending | - | - |
| FEATURE-025 | Spotify recommendation bridge | Pending | - | - |
| FEATURE-026 | Charts and regional charts | Pending | - | - |
| FEATURE-027 | Mood and genre browsing | Pending | - | - |
| FEATURE-028 | Shorts filtering | Pending | - | - |
| FEATURE-029 | Video-song filtering | Pending | - | - |
| FEATURE-030 | Blocked artists | Pending | - | - |
| FEATURE-031 | Podcast discovery | Pending | - | - |
| FEATURE-032 | Followed podcast library | Pending | - | - |
| FEATURE-033 | Continue listening | Pending | - | - |
| FEATURE-034 | Episode ordering | Pending | - | - |
| FEATURE-035 | Podcast playback speed | Pending | - | - |
| FEATURE-036 | Podcast skip controls | Pending | - | - |
| FEATURE-037 | Fullscreen video podcast player | Pending | - | - |
| FEATURE-038 | Podcast queue | Pending | - | - |
| FEATURE-039 | Podcast progress sync | Pending | - | - |
| FEATURE-040 | Podcast metadata pages | Pending | - | - |
| FEATURE-041 | Live Spotify library | Pending | - | - |
| FEATURE-042 | Spotify playlist detail pages | Pending | - | - |
| FEATURE-043 | YouTube Music account authentication | Pending | - | - |
| FEATURE-044 | Playlist cloud synchronization | Pending | - | - |
| FEATURE-045 | Liked albums synchronization | Pending | - | - |
| FEATURE-046 | Followed artists synchronization | Pending | - | - |
| FEATURE-047 | Multi-device library sync | Pending | - | - |
| FEATURE-048 | Library conflict resolution | Pending | - | - |
| FEATURE-049 | Listening history controls | Pending | - | - |
| FEATURE-050 | Vibe Summary | Pending | - | - |
| FEATURE-051 | Lyrics+ provider integration | Pending | - | - |
| FEATURE-052 | Provider priority settings | Pending | - | - |
| FEATURE-053 | Word-by-word timing | Pending | - | - |
| FEATURE-054 | Multiple lyric animations | Pending | - | - |
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
