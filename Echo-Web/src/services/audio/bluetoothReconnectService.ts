import { AudioEngine } from '../../engine/AudioEngine.ts'
import { useEchoStore } from '../../stores/useEchoStore.ts'
import {
  audioDeviceSchema,
  type AudioDeviceItem,
  type BluetoothReconnectTelemetry,
} from '../../types/audio.ts'

export class BluetoothReconnectService {
  private static instance: BluetoothReconnectService | null = null

  private isInitialized = false
  private abortController: AbortController | null = null
  private knownDevices = new Map<string, string>() // deviceId -> label
  private lastActiveDeviceId: string | null = null
  private lastActiveDeviceLabel: string | null = null
  private wasPlayingWhenDisconnected = false
  private disconnectTimestamp: number | null = null
  private readonly reconnectWindowMs = 5 * 60 * 1000 // 5 minutes

  private telemetry: BluetoothReconnectTelemetry = {
    deviceChangeEvents: 0,
    devicesConnectedCount: 0,
    devicesDisconnectedCount: 0,
    resumesTriggered: 0,
    resumesFailed: 0,
    lastReconnectedDevice: null,
    lastEventTimestamp: null,
  }

  private constructor() {}

  public static getInstance(): BluetoothReconnectService {
    if (!BluetoothReconnectService.instance) {
      BluetoothReconnectService.instance = new BluetoothReconnectService()
    }
    return BluetoothReconnectService.instance
  }

  public init(): void {
    if (this.isInitialized) return
    this.isInitialized = true
    this.abortController = new AbortController()

    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
      const signal = this.abortController.signal
      void this.refreshKnownDevices()

      navigator.mediaDevices.addEventListener(
        'devicechange',
        () => {
          void this.onMediaDevicesChange()
        },
        { signal },
      )
    }
  }

  public destroy(): void {
    if (!this.isInitialized) return
    this.abortController?.abort()
    this.abortController = null
    this.isInitialized = false
    this.knownDevices.clear()
    this.wasPlayingWhenDisconnected = false
    this.disconnectTimestamp = null
    this.lastActiveDeviceId = null
    this.lastActiveDeviceLabel = null
  }

  public getTelemetry(): Readonly<BluetoothReconnectTelemetry> {
    return { ...this.telemetry }
  }

  public resetTelemetry(): void {
    this.telemetry = {
      deviceChangeEvents: 0,
      devicesConnectedCount: 0,
      devicesDisconnectedCount: 0,
      resumesTriggered: 0,
      resumesFailed: 0,
      lastReconnectedDevice: null,
      lastEventTimestamp: null,
    }
  }

  public notifyPlaybackState(state: string): void {
    if (state === 'PLAYING') {
      this.wasPlayingWhenDisconnected = false
      this.disconnectTimestamp = null
    }
  }

  public notifyActiveSink(sinkId: string, label?: string): void {
    this.lastActiveDeviceId = sinkId
    if (label) {
      this.lastActiveDeviceLabel = label
    } else if (this.knownDevices.has(sinkId)) {
      this.lastActiveDeviceLabel = this.knownDevices.get(sinkId) || null
    }
  }

  public isResumeEnabled(): boolean {
    return Boolean(useEchoStore.getState().preferences.bluetoothResumeEnabled)
  }

  private async refreshKnownDevices(): Promise<AudioDeviceItem[]> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return []
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      const audioOutputs: AudioDeviceItem[] = []
      this.knownDevices.clear()

      for (let i = 0; i < all.length; i++) {
        const d = all[i]!
        if (d.kind === 'audiooutput') {
          const parsed = audioDeviceSchema.safeParse({
            deviceId: d.deviceId || (i === 0 ? 'default' : `device-${i}`),
            label: d.label || `Output ${i + 1}`,
          })
          if (parsed.success) {
            audioOutputs.push(parsed.data)
            this.knownDevices.set(parsed.data.deviceId, parsed.data.label)
          }
        }
      }
      return audioOutputs
    } catch {
      return []
    }
  }

  private async onMediaDevicesChange(): Promise<void> {
    this.telemetry.deviceChangeEvents++
    this.telemetry.lastEventTimestamp = Date.now()
    const currentOutputs = await this.refreshKnownDevices()
    await this.processDeviceListChange(currentOutputs)
  }

  public async processDeviceListChange(currentOutputs: AudioDeviceItem[]): Promise<boolean> {
    const currentIds = new Set(currentOutputs.map((d) => d.deviceId))
    const currentMap = new Map(currentOutputs.map((d) => [d.deviceId, d.label]))

    // 1. Detect disconnected devices
    const disconnectedDeviceIds: string[] = []
    for (const [prevId] of this.knownDevices) {
      if (!currentIds.has(prevId) && prevId !== 'default') {
        disconnectedDeviceIds.push(prevId)
      }
    }

    if (disconnectedDeviceIds.length > 0) {
      this.telemetry.devicesDisconnectedCount += disconnectedDeviceIds.length
      const engine = AudioEngine.getInstance()
      const isPlaying = engine.getState().playbackState === 'PLAYING'
      const currentSink = engine.getAudioOutput()

      if (isPlaying || disconnectedDeviceIds.includes(currentSink)) {
        this.wasPlayingWhenDisconnected = true
        this.disconnectTimestamp = Date.now()
        this.lastActiveDeviceId = currentSink
        this.lastActiveDeviceLabel = this.knownDevices.get(currentSink) || null
      }
    }

    // 2. Detect reconnected / newly added devices
    let reconnectedDevice: AudioDeviceItem | null = null
    for (const [currId, currLabel] of currentMap) {
      if (!this.knownDevices.has(currId) && currId !== 'default') {
        this.telemetry.devicesConnectedCount++
        // Check if this matches our last active device or is a bluetooth / headphone output
        if (
          currId === this.lastActiveDeviceId ||
          (this.lastActiveDeviceLabel && currLabel === this.lastActiveDeviceLabel) ||
          this.isLikelyBluetoothDevice(currLabel)
        ) {
          reconnectedDevice = { deviceId: currId, label: currLabel }
        }
      }
    }

    // Update known devices map
    this.knownDevices.clear()
    for (const [k, v] of currentMap) {
      this.knownDevices.set(k, v)
    }

    // 3. Attempt resume if criteria met
    if (reconnectedDevice && this.shouldAttemptResume()) {
      return await this.executeResume(reconnectedDevice)
    }

    return false
  }

  private isLikelyBluetoothDevice(label: string): boolean {
    const lower = label.toLowerCase()
    return (
      lower.includes('bluetooth') ||
      lower.includes('airpods') ||
      lower.includes('buds') ||
      lower.includes('headphone') ||
      lower.includes('headset') ||
      lower.includes('wireless') ||
      lower.includes('wh-') ||
      lower.includes('wf-')
    )
  }

  private shouldAttemptResume(): boolean {
    if (!this.isResumeEnabled()) return false
    if (!this.wasPlayingWhenDisconnected) return false
    if (!this.disconnectTimestamp) return false
    const elapsed = Date.now() - this.disconnectTimestamp
    return elapsed <= this.reconnectWindowMs
  }

  private async executeResume(device: AudioDeviceItem): Promise<boolean> {
    const engine = AudioEngine.getInstance()
    try {
      if (device.deviceId && device.deviceId !== 'default') {
        await engine.setAudioOutput(device.deviceId)
      }

      await engine.play()
      this.telemetry.resumesTriggered++
      this.telemetry.lastReconnectedDevice = device.label || device.deviceId
      this.wasPlayingWhenDisconnected = false
      this.disconnectTimestamp = null

      useEchoStore.getState().setToast(
        `Reconnected to ${device.label || 'Bluetooth device'} - playback resumed`,
      )
      return true
    } catch {
      this.telemetry.resumesFailed++
      return false
    }
  }

  // Testing helpers
  public setTestDisconnectedState(wasPlaying: boolean, deviceId: string, label: string): void {
    this.wasPlayingWhenDisconnected = wasPlaying
    this.disconnectTimestamp = Date.now()
    this.lastActiveDeviceId = deviceId
    this.lastActiveDeviceLabel = label
    this.knownDevices.set(deviceId, label)
  }
}

export const bluetoothReconnectService = BluetoothReconnectService.getInstance()
export type { BluetoothReconnectTelemetry }
export { bluetoothReconnectTelemetrySchema } from '../../types/audio.ts'
