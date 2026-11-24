# Accessibility & Keyboard Navigation Architecture [SMALL-45]

## Overview
Echo Music Web is engineered for compliance with WCAG 2.1 AA accessibility guidelines, offering complete keyboard operability, screen-reader landmarks, live route announcements, focus traps for modal dialogs, and respects user motion preferences.

## Features
1. **Focus Management**:
   - `useModalFocusTrap` ensures keyboard focus is trapped inside active dialogs (Keyboard Shortcuts, Listen Together, Echo Find, Create Playlist) and restored to previous element on dismissal.
   - Visible skip-to-content anchor for keyboard users.
2. **Keyboard Navigation & Shortcuts**:
   - Unified `ShortcutManager` supporting key combinations with automatic debouncing to prevent repeated rapid keydown executions.
   - Operates safely without intercepting inputs or textareas.
3. **Motion Preferences**:
   - `isReducedMotionPreferred()` queries system preferences via `matchMedia('(prefers-reduced-motion: reduce)')`.
   - Canvas animations and transitions disable automatically under reduced motion settings.
4. **Touch & Target Sizing**:
   - Interactive controls (buttons, links, inputs) enforce minimum touch target sizes (`>= 44px`).

## Telemetry
`getAccessibilityMetrics()` tracks:
- `shortcutsTriggered`
- `focusTrapsActivated`
- `screenReaderAnnouncementsSent`
- `reducedMotionDetected`

## Testing
- Unit and browser integration tests in `Echo-Web/test/accessibility.test.ts`.
