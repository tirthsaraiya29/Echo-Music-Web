# Desktop Player View Architecture [SMALL-43]

## Overview
The Desktop Player View provides a high-fidelity, full-screen playback environment featuring canvas visuals, synchronized lyrics, audio equalizer controls, Music DNA lore, sleep timer configuration, and output device routing.

## Capabilities & Controls
1. **Backdrop & Visual Presentation**:
   - `CanvasVideo`: Dynamic looping canvas visuals with automatic reduced-motion detection.
   - Glass-frosting backdrop filter overlay.
   - High-resolution cover artwork fallback.
2. **Accessible Interaction & Keyboard Shortcuts**:
   - `Space`: Play/Pause toggle.
   - `ArrowLeft` / `ArrowRight`: 5-second relative seeking.
   - `Escape`: Progressive modal dismissal (EQ -> DNA -> Sleep Timer -> Output -> Player dismiss).
   - `?` or `Shift + /`: In-player keyboard shortcuts reference.
3. **Telemetry & Synchronization**:
   - Fullscreen state synchronized with native `fullscreenchange` event listener.
   - Bounded playback speed stepping (`0.75x`, `1.0x`, `1.25x`, `1.5x`).
   - Instrumentation via `getDesktopPlayerMetrics()` for opens, closes, fullscreen toggles, speed changes, and keyboard triggers.

## Testing
- Unit and browser integration tests verified in `Echo-Web/test/desktop-player.test.ts`.
