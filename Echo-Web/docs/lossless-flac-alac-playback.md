# FLAC & ALAC Lossless Playback Architecture

## Overview
Echo Music Web provides native browser playback for lossless audio formats, including FLAC, ALAC (in MP4 container), and uncompressed WAV/PCM, supplied via custom extension providers or imported local media files.

## Lossless Codec & MIME Detection
The engine inspects stream MIME types, container headers, and extension metadata to identify genuine lossless streams:
- **FLAC**: `audio/flac`, `codec: 'flac'` $\rightarrow$ `FLAC (Lossless)`
- **ALAC**: `audio/alac`, `audio/mp4; codecs="alac"`, `codec: 'alac'` $\rightarrow$ `ALAC (Lossless)`
- **WAV**: `audio/wav`, `audio/x-wav` $\rightarrow$ `WAV (PCM)`
- **Lossless Quality**: `quality: 'lossless'` $\rightarrow$ `Lossless Audio`

## Visual Quality Badging
In `DesktopPlayerView`:
- Standard streams: shows codec and bitrate badge (e.g. `Opus (WebM) · ~160 kbps`).
- Verified 320 kbps: shows `HIGH BITRATE` badge.
- Lossless streams ($\le 48$ kHz): shows gold `LOSSLESS` badge.
- High-resolution lossless streams ($> 48$ kHz, e.g. 96 kHz or 192 kHz): shows gold `HI-RES LOSSLESS` badge.
- Bit-perfect 32-bit floating point audio context processing prevents quantization truncation during DSP.
