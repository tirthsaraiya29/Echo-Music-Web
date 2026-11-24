# Varispeed Mode (Pitch-Linked Speed Control)

## Overview
Echo Music Web provides **Varispeed Mode**, inspired by analog tape machines and vinyl turntable pitch sliders (e.g. Technics SL-1200 +/- pitch faders).

When Varispeed is active:
- Adjusting the playback rate simultaneously changes both tempo and musical pitch.
- Pitch shift is calculated according to the acoustic frequency doubling formula:
  $$\Delta \text{semitones} = 12 \cdot \log_2(\text{playbackRate})$$
- For example:
  - `0.5x` playback rate shifts pitch down by $-12.0$ semitones (one full octave down).
  - `0.75x` playback rate shifts pitch down by approximately $-5.0$ semitones.
  - `1.0x` playback rate has $0.0$ semitones shift.
  - `1.25x` playback rate shifts pitch up by approximately $+3.9$ semitones.
  - `1.5x` playback rate shifts pitch up by approximately $+7.0$ semitones (a perfect fifth).
  - `2.0x` playback rate shifts pitch up by $+12.0$ semitones (one full octave up).

When Varispeed is disabled (default):
- Standard digital time-stretching preserves original pitch (`preservesPitch = true`).
- The musical key remains unmodified regardless of speed.

## Web Audio / HTMLMediaElement Integration
Varispeed toggles browser media element pitch-preservation properties:
- `preservesPitch` (Standard HTML5 Media Element)
- `mozPreservesPitch` (Mozilla Firefox)
- `webkitPreservesPitch` (WebKit / Safari / Chromium)

When `varispeedEnabled` is `true`, these flags are set to `false`. When `false`, they are restored to `true`.
