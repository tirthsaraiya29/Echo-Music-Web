import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bugs = [
  ['BUG-01', 'P0', 'Crossfade queue promotion is missing', 'src/engine/AudioEngine.ts, src/engine/DeckController.ts, src/engine/QueueManager.ts'],
  ['BUG-02', 'P0', 'Zustand queue actions mutate the same queue twice', 'src/stores/useEchoStore.ts, src/hooks/useAudioEngine.ts, src/engine/AudioEngine.ts'],
  ['BUG-03', 'P0', 'Track object identity changes on playback ticks', 'src/engine/QueueManager.ts, src/engine/AudioEngine.ts, src/hooks/useAudioEngine.ts, src/components/player/LyricsView.tsx, src/components/player/CanvasVideo.tsx'],
  ['BUG-04', 'P0', 'Production API deployment is not defined in the repository', 'vite.config.ts, server/index.ts, src/services/api.ts'],
  ['BUG-05', 'P1', 'Listen Together is HTTP polling, not WebSockets', 'src/services/listenTogether/listenTogetherClient.ts, server/routes/listenTogether.ts, README.md'],
  ['BUG-06', 'P1', 'Listen Together host updates can flood the backend', 'src/components/modals/ListenTogetherModal.tsx, src/hooks/useAudioEngine.ts, src/services/listenTogether/listenTogetherClient.ts'],
  ['BUG-07', 'P1', 'Listen Together room expiry ignores active heartbeats', 'server/routes/listenTogether.ts'],
  ['BUG-08', 'P1', 'Listen Together state is mutated in place', 'src/services/listenTogether/listenTogetherClient.ts, src/components/modals/ListenTogetherModal.tsx'],
  ['BUG-09', 'P1', 'Streaming proxy redirect validation is missing', 'server/routes/stream.ts, server/routes/canvas.ts'],
  ['BUG-10', 'P1', 'Queue snapshot restoration loses source cursor context', 'src/engine/QueueManager.ts'],
  ['BUG-11', 'P1', 'Backup and restore use a second playlist store', 'src/services/db/echoDatabase.ts, src/stores/useEchoStore.ts, src/components/modals/SpotifyImportModal.tsx, src/pages/SettingsPage.tsx'],
  ['BUG-12', 'P1', 'Clear History leaves persisted recent items intact', 'src/pages/SettingsPage.tsx, src/services/db/echoDatabase.ts, src/stores/useEchoStore.ts'],
  ['BUG-13', 'P1', 'Cast is not wired into playback', 'src/services/cast/castService.ts, src/components/player/AudioOutputPicker.tsx'],
  ['BUG-14', 'P1', 'Cast media type is hardcoded', 'src/services/cast/castService.ts'],
  ['BUG-15', 'P1', 'Local Taste skip penalties are unreachable', 'src/services/recommendations/localTasteEngine.ts, src/engine/AudioEngine.ts'],
  ['BUG-16', 'P1', 'Lyrics provider preference is ignored', 'src/pages/SettingsPage.tsx, src/services/lyrics/LyricsOrchestrator.ts'],
  ['BUG-17', 'P1', 'Several settings are inert or only partially implemented', 'src/types/domain.ts, src/pages/SettingsPage.tsx, src/engine/AudioEngine.ts'],
  ['BUG-18', 'P1', 'Negative cache entries never expire', 'src/services/lyrics/LyricsOrchestrator.ts, src/services/canvas/CanvasManager.ts'],
  ['BUG-19', 'P1', 'Stale metadata cache revalidation is not deduplicated', 'src/services/cache/metadataCache.ts'],
  ['BUG-20', 'P1', 'Metadata cache cap is not a hard cap', 'src/services/cache/metadataCache.ts'],
  ['BUG-21', 'P1', 'Security tests do not exercise production allowlist code', 'test/security.test.ts, server/routes/stream.ts, server/routes/canvas.ts'],
  ['BUG-22', 'P1', 'CI does not run tests', '.github/workflows/ci.yml, package.json'],
  ['BUG-23', 'P2', 'Spotify matching accepts the first search result', 'src/services/spotify/spotifyImporter.ts'],
  ['BUG-24', 'P2', 'Spotify importer has no robust pagination or live-library flow', 'server/routes/spotify.ts, src/services/spotify/spotifyImporter.ts'],
  ['BUG-25', 'P2', 'Lyrics loading state is never activated', 'src/components/player/LyricsView.tsx'],
  ['BUG-26', 'P2', 'Lyrics animation re-renders the full view every frame', 'src/components/player/LyricsView.tsx'],
  ['BUG-27', 'P2', 'Local artwork object URLs are not revoked', 'src/services/local/localMusicScanner.ts, src/services/db/echoDatabase.ts'],
  ['BUG-28', 'P2', 'Local metadata parser does not implement its ID3v1 claim', 'src/services/local/localMusicScanner.ts'],
  ['BUG-29', 'P2', 'Audio output selection ignores failure', 'src/components/player/AudioOutputPicker.tsx'],
  ['BUG-30', 'P2', 'First Cast click can silently fail', 'src/services/cast/castService.ts, src/components/player/AudioOutputPicker.tsx'],
  ['BUG-31', 'P2', 'The room code UI length conflicts with generated codes', 'src/components/modals/ListenTogetherModal.tsx, server/routes/listenTogether.ts'],
  ['BUG-32', 'P2', 'Room code entropy is lower than the alphabet suggests', 'server/routes/listenTogether.ts'],
  ['BUG-33', 'P2', 'Room rate limiting trusts forwarded IP input', 'server/routes/listenTogether.ts'],
  ['BUG-34', 'P2', 'Room resource limits are incomplete', 'server/routes/listenTogether.ts'],
  ['BUG-35', 'P2', 'Range parsing is incomplete', 'server/routes/stream.ts'],
  ['BUG-36', 'P2', 'Stream-info requests are not deduplicated', 'server/routes/stream.ts'],
  ['BUG-37', 'P2', 'Data Saver description overpromises', 'src/pages/SettingsPage.tsx, src/engine/AudioEngine.ts'],
  ['BUG-38', 'P2', 'Lossless marketing metadata is inconsistent', 'index.html, server/routes/stream.ts, src/pages/SettingsPage.tsx'],
  ['BUG-39', 'P2', 'Podcast data exists without a complete podcast product surface', 'src/services/db/echoDatabase.ts, src/engine/AudioEngine.ts, src/App.tsx'],
  ['BUG-40', 'P2', 'Music Flow is absent', 'src/App.tsx, src/pages, src/components'],
  ['BUG-41', 'P2', 'Cloud media providers are absent', 'src/services, server/routes'],
  ['BUG-42', 'P2', 'Extension audio framework is absent', 'src/services, server/routes, src/types'],
  ['BUG-43', 'P2', 'Browser Discord integration is deployment-dependent', 'server/routes/discord.ts, src/services'],
  ['BUG-44', 'P2', 'Recognition is a configured integration, not a complete default service', 'server/routes/recognition.ts'],
  ['BUG-45', 'P2', 'Preferred content region is not propagated', 'src/pages/SettingsPage.tsx, src/services/innertube/client.ts, server/utils/potoken.ts'],
  ['BUG-46', 'P2', 'Explicit-content preference is not applied', 'src/pages/SettingsPage.tsx, src/services/innertube/parser.ts']
];

const smallAreas = [
  'QueueManager invariants',
  'Zustand/audio-engine bridge',
  'Dual-deck crossfade',
  'AudioEngine state/events',
  'Playback controls',
  'Audio output picker',
  'Google Cast adapter',
  'Stream resolver',
  'HTTP Range streaming',
  'Streaming proxy security',
  'InnerTube client',
  'InnerTube parser',
  'Radio continuation',
  'Metadata cache',
  'Home discovery shelves',
  'Search and suggestions',
  'Album detail pages',
  'Artist detail pages',
  'Playlist management',
  'Backup and restore',
  'Listening history',
  'Local music import',
  'Local metadata parsing',
  'Local artwork lifecycle',
  'Lyrics provider orchestration',
  'Lyrics player UI',
  'AI lyrics translation',
  'Canvas resolution',
  'Canvas video rendering',
  'Music DNA drawer',
  'Echo Find recording',
  'Spotify URL resolution',
  'Spotify track matching',
  'Last.fm scrobbling',
  'Discord Rich Presence',
  'Listen Together client',
  'Listen Together server',
  'Room security and limits',
  'SponsorBlock integration',
  'PWA/service worker',
  'Application routing',
  'Global layout/navigation',
  'Desktop player view',
  'Settings and preference plumbing',
  'Accessibility and keyboard navigation',
  'Theme and design tokens',
  'Artwork/image loading',
  'API fetch layer',
  'Production deployment',
  'CORS and HTTP headers',
  'Error handling and observability',
  'CI and automated tests'
];

const majorFeatures = [
  'Custom extension registry',
  'Extension-first playback',
  '320 kbps source support',
  'FLAC/ALAC lossless playback',
  'Extension fallback chain',
  'Extension matching confidence',
  'Extension preloading',
  'Extension health dashboard',
  'Network-aware quality tiers',
  'Verified stream telemetry',
  'Correct crossfade promotion',
  'Gapless playback',
  'Equal-power crossfade profiles',
  'Queue ownership snapshots',
  'Queue continuation paging',
  'Radio retry and recovery',
  'Echo Brain momentum queue',
  'Varispeed mode',
  'Pause on mute',
  'Bluetooth reconnect resume',
  'Music Flow vertical reel',
  'Music Flow queue handoff',
  'Echo Brain auto-injection',
  'Taste Mix',
  'Spotify recommendation bridge',
  'Charts and regional charts',
  'Mood and genre browsing',
  'Shorts filtering',
  'Video-song filtering',
  'Blocked artists',
  'Podcast discovery',
  'Followed podcast library',
  'Continue listening',
  'Episode ordering',
  'Podcast playback speed',
  'Podcast skip controls',
  'Fullscreen video podcast player',
  'Podcast queue',
  'Podcast progress sync',
  'Podcast metadata pages',
  'Live Spotify library',
  'Spotify playlist detail pages',
  'YouTube Music account authentication',
  'Playlist cloud synchronization',
  'Liked albums synchronization',
  'Followed artists synchronization',
  'Multi-device library sync',
  'Library conflict resolution',
  'Listening history controls',
  'Vibe Summary',
  'Lyrics+ provider integration',
  'Provider priority settings',
  'Word-by-word timing',
  'Multiple lyric animations',
  'Romanization-aware cache',
  'AI translation chunking',
  'Translation provider testing',
  'Lyrics export with metadata',
  'Lyrics download',
  'Lyrics sync profiles',
  'Default Echo Find provider',
  'Recognition history',
  'Recognition confidence UI',
  'Music DNA expansion',
  'Artist and song knowledge graph',
  'AutoEQ headphone profiles',
  'Personalized listening insights',
  'Genre taste profiles',
  'Recommendation feedback loop',
  'Local recommendation controls',
  'Jellyfin integration',
  'Navidrome/Subsonic integration',
  'Odesli cross-platform sharing',
  'Complete Google Cast handoff',
  'Discord Rich Presence bridge',
  'Last.fm scrobble controls',
  'ListenBrainz integration',
  'Bluetooth device actions',
  'Ringtone handoff',
  'Playlist share links',
  'WebSocket transport',
  'Shared persistent room state',
  'Latency-compensated sync',
  'Drift correction',
  'Host queue synchronization',
  'Guest playback ownership',
  'Room reconnection',
  'Invite deep links and QR',
  'Room chat and reactions',
  'Room access and moderation',
  'EBU R128 loudness normalization',
  'AudioWorklet DSP pipeline',
  'Verified format badges',
  'Bit-perfect desktop companion',
  'WebUSB capability guidance',
  'Advanced EQ presets',
  'Pitch-linked varispeed',
  'Audio output persistence',
  'Audio focus policy',
  'Playback telemetry panel',
  'UI density scale',
  'High-refresh animation mode',
  'Hide player thumbnail',
  'Album-art crop controls',
  'Multiple themes and monochrome mode',
  'Expanded localization',
  'Keyboard shortcut customization',
  'PWA install onboarding',
  'Responsive accessibility audit'
];

let doc = '# Echo Music Web — Implementation Manifest\n\n';
doc += 'This manifest records the status, commit SHA, and verification for every phase of the autonomous production implementation.\n\n';
doc += '## Phase 0: Repository Integration Baseline\n\n';
doc += '| Phase ID | Description | Status | Commit SHA | Verified |\n';
doc += '|---|---|---|---|---|\n';
doc += '| P00 | Fast-forward merge web integration branch to main and verify baseline | Completed | ae640dc95fd65a09e92f13e4acdcade80e6287b6 | Yes (pushed to origin/main) |\n\n';

doc += '## Phase 1: Source Findings (BUG-01 to BUG-46)\n\n';
doc += '| Phase ID | Priority | Description | Target Files | Status | Commit SHA | Verified |\n';
doc += '|---|---|---|---|---|---|---|\n';
for (const b of bugs) {
  doc += `| ${b[0]} | ${b[1]} | ${b[2]} | \`${b[3]}\` | Pending | - | - |\n`;
}

doc += '\n## Phase 2: Small Improvements (SMALL-01 to SMALL-52)\n\n';
doc += '| Phase ID | Area | Tasks (10 per area) | Status | Commit SHA | Verified |\n';
doc += '|---|---|---|---|---|---|\n';
smallAreas.forEach((area, idx) => {
  const id = `SMALL-${String(idx + 1).padStart(2, '0')}`;
  doc += `| ${id} | ${area} | 10 tasks in backlog | Pending | - | - |\n`;
});

doc += '\n## Phase 3: Major Upstream Features (FEATURE-001 to FEATURE-109)\n\n';
doc += '| Phase ID | Feature Name | Status | Commit SHA | Verified |\n';
doc += '|---|---|---|---|---|\n';
majorFeatures.forEach((feat, idx) => {
  const id = `FEATURE-${String(idx + 1).padStart(3, '0')}`;
  doc += `| ${id} | ${feat} | Pending | - | - |\n`;
});

const docsDir = __dirname;
fs.writeFileSync(path.join(docsDir, 'IMPLEMENTATION_MANIFEST.md'), doc, 'utf8');
console.log('Manifest created successfully with all phases.');
