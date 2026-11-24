import type { AccentColor, ThemeMode } from '../../types/domain.ts'
import {
  themeModeSchema,
  accentColorSchema,
  recordThemeMetric,
} from './themeTypes.ts'

export type ResolvedTheme = 'light' | 'dark'

export class ThemeManager {
  private static instance: ThemeManager | null = null
  private mediaQuery: MediaQueryList | null = null

  private constructor() {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: light)')
    }
  }

  public static getInstance(): ThemeManager {
    if (!ThemeManager.instance) {
      ThemeManager.instance = new ThemeManager()
    }
    return ThemeManager.instance
  }

  public resolveTheme(mode: ThemeMode): ResolvedTheme {
    const validatedMode = themeModeSchema.safeParse(mode).success ? mode : 'dark'

    if (validatedMode === 'system') {
      recordThemeMetric('systemThemeEvaluations')
      if (this.mediaQuery?.matches) {
        return 'light'
      }
      return 'dark'
    }

    if (validatedMode === 'light') return 'light'
    return 'dark'
  }

  public applyTheme(mode: ThemeMode, root: HTMLElement | null = null): ResolvedTheme {
    const target = root ?? (typeof document !== 'undefined' ? document.documentElement : null)
    const resolved = this.resolveTheme(mode)

    recordThemeMetric('themeChanges')
    if (target) {
      target.dataset['theme'] = resolved
    }
    return resolved
  }

  public applyAccent(accent: AccentColor, root: HTMLElement | null = null): AccentColor {
    const target = root ?? (typeof document !== 'undefined' ? document.documentElement : null)
    const validated = accentColorSchema.safeParse(accent).success ? accent : 'violet'

    recordThemeMetric('accentChanges')
    if (target) {
      target.dataset['accent'] = validated
    }
    return validated
  }

  public subscribeSystemTheme(callback: (resolved: ResolvedTheme) => void): () => void {
    if (!this.mediaQuery) return () => {}

    const listener = () => {
      callback(this.resolveTheme('system'))
    }

    this.mediaQuery.addEventListener('change', listener)
    return () => {
      this.mediaQuery?.removeEventListener('change', listener)
    }
  }
}

export const themeManager = ThemeManager.getInstance()
