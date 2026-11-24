import {
  swStatusSchema,
  recordPwaMetric,
  type SwStatus,
} from './pwaTypes.ts'

export type SwStatusListener = (status: SwStatus) => void

export class PwaManager {
  private static instance: PwaManager | null = null

  private listeners = new Set<SwStatusListener>()
  private status: SwStatus
  private registration: ServiceWorkerRegistration | null = null
  private waitingWorker: ServiceWorker | null = null
  private onlineHandler: (() => void) | null = null
  private offlineHandler: (() => void) | null = null

  private constructor() {
    const isOnline =
      typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
        ? navigator.onLine
        : true
    const isSupported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator

    this.status = {
      supported: isSupported,
      registered: false,
      active: false,
      waitingUpdate: false,
      isOnline,
      lastChecked: Date.now(),
    }

    if (typeof window !== 'undefined') {
      this.onlineHandler = () => {
        this.status.isOnline = true
        recordPwaMetric('onlineTransitions')
        this.notify()
      }
      this.offlineHandler = () => {
        this.status.isOnline = false
        recordPwaMetric('offlineTransitions')
        this.notify()
      }
      window.addEventListener('online', this.onlineHandler)
      window.addEventListener('offline', this.offlineHandler)
    }
  }

  public static getInstance(): PwaManager {
    if (!PwaManager.instance) {
      PwaManager.instance = new PwaManager()
    }
    return PwaManager.instance
  }

  public getStatus(): SwStatus {
    return swStatusSchema.parse(this.status)
  }

  public subscribe(listener: SwStatusListener): () => void {
    this.listeners.add(listener)
    listener(this.getStatus())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    const current = this.getStatus()
    for (const listener of this.listeners) {
      listener(current)
    }
  }

  public async register(swUrl = '/sw.js', options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<boolean> {
    if (!this.status.supported || typeof navigator === 'undefined' || !navigator.serviceWorker) {
      return false
    }

    const timeoutMs = options.timeoutMs ?? 8000
    const timeoutCtrl = new AbortController()
    const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs)

    try {
      if (options.signal?.aborted) {
        clearTimeout(timer)
        return false
      }

      const reg = await navigator.serviceWorker.register(swUrl, {
        scope: '/',
      })
      clearTimeout(timer)

      this.registration = reg
      this.status.registered = true
      this.status.active = Boolean(reg.active)
      this.status.scope = reg.scope
      this.status.lastChecked = Date.now()

      if (reg.waiting) {
        this.waitingWorker = reg.waiting
        this.status.waitingUpdate = true
        recordPwaMetric('updatesFound')
      }

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              this.waitingWorker = newWorker
              this.status.waitingUpdate = true
              recordPwaMetric('updatesFound')
              this.notify()
            }
          })
        }
      })

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        this.status.active = true
        this.status.waitingUpdate = false
        this.notify()
      })

      recordPwaMetric('registrations')
      this.notify()
      return true
    } catch {
      clearTimeout(timer)
      recordPwaMetric('errors')
      return false
    }
  }

  public async checkForUpdates(): Promise<boolean> {
    if (!this.registration) return false
    this.status.lastChecked = Date.now()

    try {
      await this.registration.update()
      if (this.registration.waiting) {
        this.waitingWorker = this.registration.waiting
        this.status.waitingUpdate = true
        recordPwaMetric('updatesFound')
        this.notify()
        return true
      }
      this.notify()
      return false
    } catch {
      recordPwaMetric('errors')
      return false
    }
  }

  public applyUpdate(): void {
    if (this.waitingWorker) {
      recordPwaMetric('updatesApplied')
      this.waitingWorker.postMessage({ type: 'SKIP_WAITING' })
      if (typeof window !== 'undefined') {
        window.location.reload()
      }
    }
  }

  public destroy(): void {
    if (typeof window !== 'undefined') {
      if (this.onlineHandler) window.removeEventListener('online', this.onlineHandler)
      if (this.offlineHandler) window.removeEventListener('offline', this.offlineHandler)
    }
    this.listeners.clear()
    this.registration = null
    this.waitingWorker = null
  }
}

export const pwaManager = PwaManager.getInstance()
