import {
  type NavigationEvent,
  recordRoutingMetric,
} from './routeTypes.ts'

export type NavigationListener = (event: NavigationEvent) => void

export class NavigationManager {
  private static instance: NavigationManager | null = null
  private listeners = new Set<NavigationListener>()
  private lastPath: string = ''

  private constructor() {
    if (typeof window !== 'undefined') {
      this.lastPath = window.location.pathname + window.location.search
    }
  }

  public static getInstance(): NavigationManager {
    if (!NavigationManager.instance) {
      NavigationManager.instance = new NavigationManager()
    }
    return NavigationManager.instance
  }

  public shouldNavigate(targetPath: string): boolean {
    if (this.lastPath === targetPath) {
      recordRoutingMetric('redundantNavigationsSkipped')
      return false
    }
    return true
  }

  public recordNavigation(from: string, to: string): void {
    if (from === to) {
      recordRoutingMetric('redundantNavigationsSkipped')
      return
    }

    this.lastPath = to
    recordRoutingMetric('navigations')

    const event: NavigationEvent = {
      from,
      to,
      timestamp: Date.now(),
    }

    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Listener error must not fail routing
      }
    }
  }

  public subscribe(listener: NavigationListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public getLastPath(): string {
    return this.lastPath
  }

  public reset(): void {
    this.listeners.clear()
    this.lastPath = ''
  }
}

export const navigationManager = NavigationManager.getInstance()
