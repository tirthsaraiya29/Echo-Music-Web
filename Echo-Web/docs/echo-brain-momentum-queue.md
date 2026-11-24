# Echo Brain Momentum Queue (FEATURE-017)

## Architectural Design

Echo Web implements real-time session momentum analysis and non-destructive dynamic queue injection via `EchoBrainService` and `AudioEngine`.

### Background
Static radio and shuffle queues are oblivious to real-time user session behavior. When a user is in a focused flow, jarring genre shifts disrupt the experience. Conversely, when a user is restless and rapidly skipping unfamiliar tracks, static queues continue feeding similar long or unengaging content, worsening frustration.

### Echo Brain Session Momentum Engine

1. **Session Velocity Analysis (`analyzeMomentum`)**:
   Tracks live signals within a sliding temporal window (default 5 tracks):
   - `restless`: Characterized by $\ge 2$ rapid skips ($<30$s) or a high skip rate ($\ge 60\%$). Signals that the user is actively hunting for music.
   - `focused`: Characterized by high completion rate ($\ge 60\%$) across multiple consecutive tracks. Signals deep, immersive listening.
   - `exploring`: Characterized by active likes and varied listens without rapid abandonment.
   - `neutral`: Standard default state when session history is low or balanced.

2. **Momentum-Weighted Candidate Scoring (`scoreCandidates`)**:
   - In `restless` state:
     - Proven liked tracks receive a $+17.0$ total affinity boost.
     - Familiar tracks with existing play counts receive $+6.0$.
     - Tracks from artists skipped earlier in the session are penalized $-10.0$.
     - Long tracks ($>5$ min) receive a $-4.0$ penalty to accelerate palate cleansing.
   - In `focused` state:
     - Tracks by the current playing artist receive a $+8.0$ continuity boost.
     - Recently completed artists receive $+5.0$.
   - In `exploring` state:
     - Novelty bonus ($+5.0$) for unplayed catalog items alongside baseline liked tracks ($+4.0$).

3. **Non-Destructive Queue Injection (`injectMomentumTracks`)**:
   - Crucially preserves user-initiated tracks: `upNext` is never touched or reordered.
   - Deduplicates candidate tracks against current playback and queue contents.
   - Appends momentum-curated tracks into the dynamic continuation stream (`radioQueue`).

4. **Telemetry & Observation**:
   - `momentumEvaluations`: Total momentum evaluations executed.
   - `momentumInjections`: Count of momentum track injections.
   - `skipsDetected`, `completionsDetected`: Raw behavioral signals tracked.
   - `recoveryTriggers`: Times restless palate-cleansing mode activated.
   - User preference toggle in `SettingsPage` allows toggling Echo Brain momentum adaptation (`echoBrainEnabled`, default: `true`).
