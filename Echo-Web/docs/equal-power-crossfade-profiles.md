# Equal-Power & Configurable Crossfade Profiles (FEATURE-013)

## Architectural Design

Echo Web provides configurable crossfade curve profiles within `DeckController`, shaping the Web Audio `GainNode` transition values applied across consecutive tracks.

### Motivation
Standard linear crossfades suffer from a perceptual volume drop (approximately -3dB) at the center of the transition when tracks have uncorrelated audio content. Conversely, equal-power curves maintain continuous apparent acoustic energy throughout the transition. Depending on audio characteristics and user preference, different curve profiles optimize the listening experience.

### Supported Profiles

1. **Equal Power (`equalPower`)** - Default:
   - Mathematical formula:
     $$\text{fadeOut}(t) = \cos\left(t \cdot \frac{\pi}{2}\right)$$
     $$\text{fadeIn}(t) = \sin\left(t \cdot \frac{\pi}{2}\right)$$
   - Property: $\cos^2(\theta) + \sin^2(\theta) = 1.0$ at all points in time.
   - Preserves constant acoustic power and perceived loudness for independent, uncorrelated stereo recordings.

2. **Linear (`linear`)**:
   - Mathematical formula:
     $$\text{fadeOut}(t) = 1 - t$$
     $$\text{fadeIn}(t) = t$$
   - Property: $\text{fadeOut} + \text{fadeIn} = 1.0$ (constant voltage sum).
   - Prevents center-boost distortion when transitioning between highly correlated or mono audio sources.

3. **Logarithmic (`logarithmic`)**:
   - Mathematical formula:
     $$\text{fadeOut}(t) = \frac{\exp(2(1 - t)) - 1}{e^2 - 1}$$
     $$\text{fadeIn}(t) = \frac{\exp(2t) - 1}{e^2 - 1}$$
   - Monotonic exponential decay matching logarithmic human hearing perception. Ideal for ambient, gradual fades.

4. **S-Curve (`scurve`)**:
   - Cubic Hermite smoothstep polynomial:
     $$s(t) = 3t^2 - 2t^3$$
     $$\text{fadeOut}(t) = 1 - s(t)$$
     $$\text{fadeIn}(t) = s(t)$$
   - Zero first derivative at boundaries ($s'(0) = 0, s'(1) = 0$), providing gentle initial entry, steep center transition, and gentle exit.

### Hardware Web Audio Scheduling
The curves are computed via `generateCrossfadeCurves(profile, steps = 32)` and scheduled using:
```ts
fromGain.gain.setValueCurveAtTime(fadeOutCurve, now, duration)
toGain.gain.setValueCurveAtTime(fadeInCurve, now, duration)
```
This guarantees hardware-accelerated sample-accurate parameter transitions without JavaScript thread jitter.

### Configuration & Persistence
- Managed via `userPreferencesSchema.crossfadeProfile` (options: `'equalPower'`, `'linear'`, `'logarithmic'`, `'scurve'`).
- Interactive select dropdown integrated in `SettingsPage` under "Playback & Audio".
- Real-time bridge synchronization between Zustand and `AudioEngine`.
