import {
  type ShortcutDefinition,
  recordAccessibilityMetric,
} from './accessibilityTypes.ts'

export type ShortcutHandler = (e: KeyboardEvent) => void

export class ShortcutManager {
  private static instance: ShortcutManager | null = null
  private shortcuts = new Map<string, { definition: ShortcutDefinition; handler: ShortcutHandler }>()
  private keydownListener: ((e: KeyboardEvent) => void) | null = null
  private lastTriggerTime = new Map<string, number>()
  private debounceMs = 150

  private constructor() {
    if (typeof window !== 'undefined') {
      this.keydownListener = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          return
        }

        for (const [id, { definition, handler }] of this.shortcuts) {
          const matched = definition.keys.some((key) => {
            if (key === 'Space' && e.code === 'Space') return true
            if (key === 'Esc' && e.key === 'Escape') return true
            if (key.toLowerCase() === e.key.toLowerCase()) return true
            return false
          })

          if (matched) {
            const now = Date.now()
            const lastTime = this.lastTriggerTime.get(id) || 0
            if (now - lastTime < this.debounceMs) {
              return // debounce rapid repeats
            }

            this.lastTriggerTime.set(id, now)
            recordAccessibilityMetric('shortcutsTriggered')
            handler(e)
            break
          }
        }
      }
      window.addEventListener('keydown', this.keydownListener)
    }
  }

  public static getInstance(): ShortcutManager {
    if (!ShortcutManager.instance) {
      ShortcutManager.instance = new ShortcutManager()
    }
    return ShortcutManager.instance
  }

  public registerShortcut(definition: ShortcutDefinition, handler: ShortcutHandler): () => void {
    this.shortcuts.set(definition.id, { definition, handler })
    return () => {
      this.shortcuts.delete(definition.id)
      this.lastTriggerTime.delete(definition.id)
    }
  }

  public getRegisteredShortcuts(): ShortcutDefinition[] {
    return Array.from(this.shortcuts.values()).map((s) => s.definition)
  }

  public destroy(): void {
    if (typeof window !== 'undefined' && this.keydownListener) {
      window.removeEventListener('keydown', this.keydownListener)
      this.keydownListener = null
    }
    this.shortcuts.clear()
    this.lastTriggerTime.clear()
  }
}

export const shortcutManager = ShortcutManager.getInstance()
