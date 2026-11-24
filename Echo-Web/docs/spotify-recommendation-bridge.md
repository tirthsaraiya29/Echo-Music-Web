# Spotify Recommendation Bridge Architecture

## Overview
The **Spotify Recommendation Bridge** enables Echo Music Web to leverage taste signals from a user's imported Spotify playlists and library to jump-start and refine on-device music recommendations. By extracting artist affinities, frequencies, and seed queries upon import, Echo Web bridges Spotify listening tastes directly into the Local Taste Engine, Daily Taste Mix, Quick Picks, and InnerTube discovery feeds without compromising privacy.

## Key Capabilities

1. **Taste Signal Ingestion**:
   - Ingests track metadata (artist names, track titles, source playlists) whenever users import from Spotify URLs via `SpotifyImportModal` or library portability tools.
   - Normalizes artist names across variations, collaborative releases, and formatting.
   - Computes calibrated logarithmic artist affinity weights:
     $$weight = \min(3.0, 1.0 + \log_2(count) \times 0.5)$$
   - Automatically generates discovery seed queries (e.g. `"${artist} mix"`) for InnerTube exploration.

2. **Integration with Local Taste Engine & Daily Taste Mix**:
   - In `calculateTasteScore`, tracks by top Spotify artists receive a calibrated score boost (up to +3.0).
   - In `buildTasteMix`, the discovery pool prioritizes catalog fallback tracks by favored Spotify artists.
   - Even when a user has minimal native playback history, the bridge allows Echo Music Web to immediately offer relevant, personalized recommendations.

3. **User Controls & Privacy**:
   - **Preference toggle**: Users can enable or disable Spotify taste signals at any time in Settings under Connected Services.
   - **Signal clearing**: Users can wipe indexed Spotify signals via a single click in Settings (`Clear Signals`), without affecting their saved playlists or local files.
   - **On-device storage**: All taste profiles are persisted locally in Dexie database `metadataCache` with zero external tracking or phone-home telemetry.

4. **Telemetry**:
   - `signalsIngested`: Total track signals recorded.
   - `boostedTracksCount`: Number of recommendation candidates elevated by Spotify signals.
   - `seedQueriesGenerated`: Count of exploration seeds derived from top artists.
   - `lastSyncTimestamp`: Timestamp of the most recent signal ingestion.
   - `lastError`: Error description if any operation failed.
