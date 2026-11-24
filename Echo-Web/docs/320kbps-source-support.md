# 320 kbps High-Bitrate Source Support

## Overview
Echo Music Web supports genuine high-bitrate audio streaming up to 320 kbps (and beyond for lossless) provided through custom extension providers and upstream streams.

## Bitrate Verification & Telemetry
In `AudioEngine.getAudioTelemetry()`:
- **Bitrate Calculation**:
  - Streamed tracks with known byte/bitrate formats reflect their actual bitrate (e.g., `320 kbps`, `~160 kbps`).
  - Extension streams report their verified bitrate or quality label (`320 kbps`, `Lossless`).
  - Overstating bitrates is strictly prevented: standard YouTube streams indicate `~160 kbps` or Opus WebM, never falsely claiming 320 kbps.
- **High-Bitrate Indicator (`isHighBitrate`)**:
  - Automatically flags streams with verified bitrate $\ge 320,000$ bps or lossless encoding.
  - Visual badge in the Desktop Player View dynamically indicates `HIGH BITRATE` when verified.

## User Controls
Users can set their preferred quality tier in Settings (`Audio Quality: Low | Medium | High | Lossless`). When high or lossless is selected and high-bitrate extension streams are configured, the engine prioritizes verified 320 kbps or lossless sources.
