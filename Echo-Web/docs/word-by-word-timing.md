# Word-by-Word Timing & Karaoke Synchronization [FEATURE-053]

## Overview
This feature completes the word-by-word synchronized lyrics implementation in Echo Music Web, establishing upstream parity with Echo Music Android's karaoke presentation engine.

## Key Capabilities

### 1. Robust Syllable and Word Timing
- Continuous normalized progress calculation `[0.0 - 1.0]` with strict guards against `NaN`, 0-duration words, and timestamp inversions (`calculateWordProgress`).
- Word state calculation (`isPast`, `isCurrent`, `progress`) via `getWordProgressState`.
- Support for background harmony tracks (`isBackground`) with dedicated `{bg}` badge formatting and subtle harmonic styling.

### 2. Isolated Performance & Smooth 60 FPS Sweep
- In `ActiveWordKaraokeLine`, an isolated `requestAnimationFrame` loop drives the sub-word horizontal sweep without triggering full-line re-renders.
- Linear clipping sweep (`clipPath: inset(...)`) creates smooth karaoke fills without jitter.
- Tracks `wordAnimationTicks` telemetry metric to measure frame render frequency.

### 3. Word-Level Direct Seeking
- Every word token is an interactive target with `role="button"`, keyboard accessibility (`Enter`/`Space`), and click handlers.
- Clicking any individual word immediately calculates target seek time `(word.startTimeMs + syncOffsetMs) / 1000` (`calculateWordSeekTime`) and seeks playback directly to that word.
- Tracks `wordSeeks` telemetry metric.

### 4. Static Word Preservation
- When a line is inactive (past or upcoming), `StaticWordKaraokeLine` preserves individual word boundaries, tokens, and background annotations rather than flattening them to raw unspaced strings.
- Allows continuous word-level inspection and seeking across the entire song.
