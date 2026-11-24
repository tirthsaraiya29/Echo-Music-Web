# Bluetooth Reconnect Resume

## Overview
Echo Music Web includes **Bluetooth Reconnect Resume**, which monitors media device changes (`navigator.mediaDevices.devicechange`) and automatically resumes playback when a previously disconnected Bluetooth audio accessory (headphones, AirPods, speakers, or wireless headsets) reconnects.

## Design and Safety Invariants
1. **User Opt-In Preference:**
   - Controlled by `bluetoothResumeEnabled` in `UserPreferences`.
   - Validated via `userPreferencesSchema` in `settingsTypes.ts`.
   - Defaults to `false` so audio does not resume unless explicitly desired by the user.
   - Configurable in **Settings > Playback & Audio DSP**.
2. **Contextual Resumption:**
   - Playback is resumed ONLY if audio was actively playing (`PLAYING`) at the moment the device was disconnected.
   - If playback was already paused or idle when the device disconnected, reconnecting will NOT start playback.
3. **Reconnection Window (5 Minutes):**
   - If the device reconnects within a 5-minute window (`300,000ms`), resume is allowed.
   - If more than 5 minutes elapsed between disconnection and reconnection, the resume intent expires to prevent unexpected bursts of sound hours later.
4. **Device Sink Re-routing:**
   - If browser supports `setSinkId` and the reconnected device is recognized, the output sink is re-routed to the reconnected device before resuming playback.
5. **Telemetry & Feedback:**
   - Tracks `deviceChangeEvents`, `devicesConnectedCount`, `devicesDisconnectedCount`, `resumesTriggered`, and `resumesFailed`.
   - Provides non-intrusive toast feedback: `Reconnected to <Device> - playback resumed`.
