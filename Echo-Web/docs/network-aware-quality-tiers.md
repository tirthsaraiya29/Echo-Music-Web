# Network-Aware Quality Tiers

## Overview
Echo Music Web implements adaptive network-aware streaming quality tiers matching upstream Echo Music capabilities. Users configure separate audio quality ceilings for Wi-Fi/unmetered networks versus cellular/metered connections, preventing unexpected data consumption while guaranteeing full lossless fidelity whenever high-bandwidth networks are available.

## Architecture

### 1. Network Detection
The `networkQuality` service queries the browser's NetworkInformation API (`navigator.connection`) across modern browser runtimes:
- Connection types: `wifi`, `cellular`, `ethernet`, `bluetooth`, `other`, `unknown`.
- Metered criteria: explicitly cellular interfaces (`type: 'cellular'`), user data-saver flags (`saveData: true`), or constrained bandwidth profiles (`slow-2g`, `2g`).
- Live event subscription: listens to network state transitions dynamically (`navigator.connection.addEventListener('change')`).

### 2. Dual Quality Ceilings
- **Wi-Fi & Unmetered Quality (`audioQualityWifi`)**: Default `lossless`. Delivers FLAC/ALAC up to 24-bit/96kHz bit-perfect decoding or YouTube high-bitrate Opus streams.
- **Cellular & Metered Quality (`audioQualityCellular`)**: Default `medium`. Constrains stream payloads and suppresses high-bandwidth FLAC preloading.
- **Data Saver Override**: Explicit data saver toggle or client network saveData flags supersede quality ceilings, forcing low-bitrate streams and disabling background prebuffering.

### 3. AudioEngine Resolution Integration
During stream resolution, `AudioEngine.resolveTrackAudio()` queries `getEffectiveAudioQuality(prefs)`.
- Cellular networks set to `low` or `medium` bypass heavy lossless extension stream resolution, preventing unexpected multi-megabyte cellular transfers.
- Stream resolvers request the negotiated tier from both YouTube Innertube endpoints and custom extension resolvers.
