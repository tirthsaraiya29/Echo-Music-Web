import test from 'node:test'
import assert from 'node:assert/strict'

if (typeof globalThis.localStorage === 'undefined') {
  const mem = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, val: string) => mem.set(key, String(val)),
    removeItem: (key: string) => mem.delete(key),
    clear: () => mem.clear(),
    key: (i: number) => Array.from(mem.keys())[i] ?? null,
    length: 0,
  } as unknown as Storage
}

if (typeof globalThis.Audio === 'undefined') {
  class MockAudio {
    src = ''
    currentTime = 0
    duration = 180
    volume = 1
    muted = false
    paused = true
    playbackRate = 1
    preservesPitch = true
    crossOrigin = null
    buffered = { length: 0, start: () => 0, end: () => 0 }
    private listeners = new Map<string, Set<() => void>>()
    play() {
      this.paused = false
      return Promise.resolve()
    }
    pause() {
      this.paused = true
    }
    load() {}
    addEventListener(event: string, cb: () => void) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set())
      this.listeners.get(event)!.add(cb)
    }
    removeEventListener(event: string, cb: () => void) {
      this.listeners.get(event)?.delete(cb)
    }
  }
  globalThis.Audio = MockAudio as unknown as typeof Audio
}

if (typeof globalThis.window === 'undefined') {
  class MockAudioNode {
    gain = {
      value: 1,
      setValueAtTime: () => {},
      cancelScheduledValues: () => {},
      linearRampToValueAtTime: () => {},
      setValueCurveAtTime: () => {},
      setTargetAtTime: () => {},
    }
    connect() { return this }
    disconnect() {}
  }

  class MockAudioContext {
    currentTime = 0
    sampleRate = 44100
    state = 'running'
    destination = new MockAudioNode()
    createGain() { return new MockAudioNode() }
    createDynamicsCompressor() {
      const param = { setValueAtTime: () => {}, setTargetAtTime: () => {}, cancelScheduledValues: () => {} }
      const node = new MockAudioNode()
      return Object.assign(node, {
        threshold: param,
        knee: param,
        ratio: param,
        attack: param,
        release: param,
      })
    }
    createBiquadFilter() {
      const param = { setValueAtTime: () => {}, setTargetAtTime: () => {}, cancelScheduledValues: () => {} }
      return {
        type: 'peaking',
        gain: param,
        frequency: param,
        Q: param,
        connect() { return this },
        disconnect() {},
      }
    }
    createAnalyser() {
      return {
        fftSize: 2048,
        frequencyBinCount: 1024,
        getByteFrequencyData: () => {},
        getByteTimeDomainData: () => {},
        connect() { return this },
        disconnect() {},
      }
    }
    createChannelSplitter() { return { connect() { return this }, disconnect() {} } }
    createChannelMerger() { return { connect() { return this }, disconnect() {} } }
    createMediaElementSource() { return new MockAudioNode() }
    resume() { return Promise.resolve() }
    close() { return Promise.resolve() }
  }

  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext
  if (typeof (globalThis as unknown as { addEventListener?: unknown }).addEventListener === 'undefined') {
    ;(globalThis as unknown as { addEventListener: unknown }).addEventListener = () => {}
    ;(globalThis as unknown as { removeEventListener: unknown }).removeEventListener = () => {}
  }
}

import { bluetoothReconnectService } from '../src/services/audio/bluetoothReconnectService.ts'
import { bluetoothReconnectTelemetrySchema } from '../src/types/audio.ts'
import { userPreferencesSchema } from '../src/services/settings/settingsTypes.ts'
import { useEchoStore } from '../src/stores/useEchoStore.ts'

test('Bluetooth reconnect: preference schema validation', () => {
  const defaultParsed = userPreferencesSchema.parse({})
  assert.equal(defaultParsed.bluetoothResumeEnabled, false)

  const activeParsed = userPreferencesSchema.parse({ bluetoothResumeEnabled: true })
  assert.equal(activeParsed.bluetoothResumeEnabled, true)
})

test('Bluetooth reconnect: telemetry schema validation', () => {
  const initial = bluetoothReconnectService.getTelemetry()
  const validated = bluetoothReconnectTelemetrySchema.parse(initial)
  assert.equal(typeof validated.deviceChangeEvents, 'number')
  assert.equal(typeof validated.resumesTriggered, 'number')
})

test('Bluetooth reconnect: disconnection and reconnection lifecycle', async () => {
  bluetoothReconnectService.resetTelemetry()
  useEchoStore.getState().setPreference('bluetoothResumeEnabled', true)

  const btDevice = { deviceId: 'bt-airpods-01', label: 'AirPods Pro' }
  const defaultDevice = { deviceId: 'default', label: 'Internal Speakers' }

  // 1. Initial state with device connected
  await bluetoothReconnectService.processDeviceListChange([defaultDevice, btDevice])

  // 2. Disconnect device while in active simulated playing state
  bluetoothReconnectService.setTestDisconnectedState(true, btDevice.deviceId, btDevice.label)

  // Trigger device list change without the btDevice
  await bluetoothReconnectService.processDeviceListChange([defaultDevice])
  assert.equal(bluetoothReconnectService.getTelemetry().devicesDisconnectedCount >= 1, true)

  // 3. Reconnect the device within the window
  const resumed = await bluetoothReconnectService.processDeviceListChange([defaultDevice, btDevice])
  assert.equal(resumed, true, 'Reconnecting while preference is active and was playing should resume')
  assert.equal(bluetoothReconnectService.getTelemetry().resumesTriggered >= 1, true)
  assert.equal(bluetoothReconnectService.getTelemetry().lastReconnectedDevice, 'AirPods Pro')

  // 4. Test when preference is disabled
  useEchoStore.getState().setPreference('bluetoothResumeEnabled', false)
  bluetoothReconnectService.setTestDisconnectedState(true, btDevice.deviceId, btDevice.label)
  await bluetoothReconnectService.processDeviceListChange([defaultDevice])

  const resumedWhenDisabled = await bluetoothReconnectService.processDeviceListChange([defaultDevice, btDevice])
  assert.equal(resumedWhenDisabled, false, 'Should not resume when preference is disabled')

  // Cleanup
  bluetoothReconnectService.destroy()
})
