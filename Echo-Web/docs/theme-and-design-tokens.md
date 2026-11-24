# Theme & Design Tokens Architecture [SMALL-46]

## Overview
Echo Music Web provides a reactive, token-based design system supporting dark, light, OLED (pure black), and system-adaptive theme modes, along with five custom accent palettes (violet, emerald, amber, rose, sky).

## System Architecture
1. **Design Tokens (`tokens.css`)**:
   - CSS variables mapped using modern CSS `@theme` and CSS custom properties (`--echo-bg`, `--echo-surface`, `--echo-text`, `--echo-accent`, `--echo-border`).
   - Dynamic accent variable binding via HTML data attributes: `data-theme="..."` and `data-accent="..."`.
2. **Theme Manager (`themeManager.ts`)**:
   - Singleton resolving themes with runtime Zod validation.
   - Evaluates system `prefers-color-scheme` media queries with listener subscription and cleanup.
   - Prevents unvalidated strings from being assigned to DOM dataset.
3. **Accent Colors**:
   - Violet (`#8b79e8`), Fern/Emerald (`#58ad83`), Ochre/Amber (`#d59b52`), Rose (`#d5798f`), Sky (`#59a4c6`).

## Telemetry
`getThemeMetrics()` instruments:
- `themeChanges`
- `accentChanges`
- `systemThemeEvaluations`
- `tokenResolutions`

## Verification
- Unit & browser integration tests in `Echo-Web/test/theme-tokens.test.ts`.
