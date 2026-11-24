# Multiple Lyric Presentation Styles & Animations [FEATURE-054]

## Overview
This feature introduces selectable lyrics presentation styles and animations in Echo Music Web, establishing upstream feature parity with Echo Music Android's `LyricsAnimationStyle` (`echo.music.iad1tya.constants.PreferenceKeys`).

## Available Animation & Presentation Styles

1. **Karaoke Sweep (`karaoke` - Default)**:
   - Real-time sub-word horizontal progressive fill sweep with linear clipping.
   - Smooth 60 FPS animation loop with isolated requestAnimationFrame runner.

2. **Apple Style (`apple`)**:
   - Fluid kinetic zoom magnification on the active line (`scale-[1.05]`) with drop-shadow luminescent depth.
   - Cinematic defocus blur (`blur-[1px]` / `blur-[1.5px]`) on inactive lines with smooth focus transitions on hover or progress.

3. **Neon Glow (`glow`)**:
   - High-contrast luminescent neon aura (`drop-shadow-[0_0_24px_rgba(176,156,255,0.85)]`) and purple edge highlight.
   - Designed for vibrant aesthetic visual listening sessions.

4. **Kinetic Slide (`slide`)**:
   - Vertical glide animation with subtle translation offsets (`-translate-y-0.5` past to `translate-y-0` active).
   - Mimics kinetic typography in motion graphics.

5. **Gentle Fade (`fade`)**:
   - Slow-paced 500ms opacity crossfade between lines.
   - Ideal for acoustic, ambient, and classical music.

6. **Metro Minimal (`metro`)**:
   - Ultra-bold, flat, uppercase typography inspired by Windows Phone Metro UI.
   - High-contrast instantaneous state snap without motion blur.

7. **Static Snap (`none`)**:
   - Instantaneous zero-motion line switching without transitions or continuous RAF loops.
   - Optimal for low-power battery saving or minimal CPU environments.

## Controls & Telemetry
- **Settings**: Persistent configuration in Settings under "Lyrics presentation style" (`UserPreferences.lyricsAnimationStyle`).
- **Quick Stage Switcher**: Dedicated dropdown on the player lyrics stage for seamless on-the-fly switching.
- **Telemetry**: Measures `animationStyleSwitches` in `lyricsUiMetrics`.
