# Verified Stream Telemetry

## Overview
Echo Music Web implements authentic, non-inferred audio pipeline stream telemetry. Unlike naive clients that display assumed constant bitrates (e.g. static "160k" or "320k" text regardless of source), Echo inspects decoded container headers, Web Audio AudioContext hardware DAC properties, and extension stream descriptors to report exact, measured facts.

## Telemetry Fields

| Field | Source | Meaning |
|---|---|---|
| `source` | Resolution provider | Exact stream origin (e.g. `YouTube Innertube Stream`, `Extension Provider`, or `Local Decoded PCM`) |
| `codec` | Container mimeType | Verified audio codec (`Opus`, `AAC`, `FLAC`, `ALAC`, `WAV`, `MP3`) |
| `container` | File container | Transport container (`WebM`, `MP4`, `FLAC`, etc.) |
| `bitrate` | Container header | Exact numeric bitrate (e.g. `160 kbps (verified)`, `320 kbps`, `Lossless`) |
| `sourceSampleRate` | Audio header | Audio encoding sample rate (e.g. `44.1 kHz`, `48.0 kHz`, `96.0 kHz`) |
| `outputSampleRate` | Web Audio DAC | Hardware output DAC clock rate (e.g. `48.0 kHz`) |
| `bitDepth` | Codec profile | Source encoding bit-depth (`16-bit`, `24-bit`, etc.) |
| `dspBitDepth` | Web Audio Graph | Web Audio DSP internal processing precision (`32-bit Float DSP`) |
| `channels` | Audio stream info | Channel layout (`Stereo (2.0)`) |
| `verified` | Verification gate | Boolean verifying whether metrics represent measured container facts |

## Accessibility & Interaction
- The desktop player header displays an interactive telemetry pill.
- Clicking the pill opens the Engine Telemetry panel in `MusicDnaDrawer`, presenting all verified audio pipeline parameters.
