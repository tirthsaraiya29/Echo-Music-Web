# Global Layout & Navigation Architecture [SMALL-42]

## Overview
The Echo Music Web global layout orchestrates the primary application frame, comprising the persistent sidebar, top navigation bar, main content scroll area, playback bar, and accessible modal overlays.

## Components & State
1. **Sidebar Navigation**:
   - Primary links: Home, Discover, Music Flow, Podcasts, Search, Library.
   - Collections links: Liked Songs, Recently Played, Play Queue.
   - User Playlists: Direct shortcuts with fallback artwork and an empty state when no playlists exist.
   - Collapse / Expand: Supports responsive collapse toggle with ARIA expanded states and persisted state.
2. **Top Navigation Bar (Header)**:
   - History navigation: Back/Forward buttons with accessible touch targets (min 44px) and telemetry recording.
   - Quick Action tools: Echo Find audio recognition, Listen Together host/join, Keyboard Shortcuts dialog, Liked songs count badge, and Settings profile shortcut.
3. **Keyboard Accessibility**:
   - "Skip to main content" link for keyboard and screen-reader users.
   - ARIA labels on all navigation elements and landmark roles (`<aside>`, `<header>`, `<main id="main-content">`).

## Telemetry
`getLayoutMetrics()` instruments:
- `sidebarToggles`
- `navigationClicks`
- `historyBackNavigations`
- `historyForwardNavigations`
- `shortcutsModalOpens`

## Verification
- Unit & browser integration tests in `Echo-Web/test/layout.test.ts`.
