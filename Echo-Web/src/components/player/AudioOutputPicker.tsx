import { useState, useEffect, useCallback } from 'react'
import { Speaker, Headphones, Check, X, ShieldAlert, Cast, Loader2 } from 'lucide-react'
import { useAudioEngine } from '../../hooks/useAudioEngine'
import { useEchoStore } from '../../stores/useEchoStore'
import { castService } from '../../services/cast/castService'
import { audioDeviceSchema, type AudioDeviceItem } from '../../types/audio.ts'

interface AudioOutputPickerProps {
  isOpen: boolean
  onClose: () => void
}

export function AudioOutputPicker({ isOpen, onClose }: AudioOutputPickerProps) {
  const [devices, setDevices] = useState<AudioDeviceItem[]>([])
  const [isLoadingDevices, setIsLoadingDevices] = useState(false)
  const { setAudioOutput, getAudioOutput, audioSinkId } = useAudioEngine()
  const currentEngineSink = getAudioOutput?.() || audioSinkId || 'default'
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const activeDeviceId = selectedDeviceId ?? currentEngineSink

  const [hasPermission, setHasPermission] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSwitching, setIsSwitching] = useState(false)
  const [isCastLoading, setIsCastLoading] = useState(false)
  const [isCastConnected, setIsCastConnected] = useState(() => castService.getIsConnected())
  const [isSdkReady, setIsSdkReady] = useState(() => castService.isSdkReady())
  const isCastEnabled = useEchoStore((state) => state.preferences.googleCast)

  const isRoutingSupported =
    typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype

  const handleClose = useCallback(() => {
    setErrorMessage(null)
    onClose()
  }, [onClose])

  useEffect(() => {
    const unsubConnected = castService.subscribe((connected) => {
      setIsCastConnected(connected)
    })
    const unsubReady = castService.subscribeReady((ready) => {
      setIsSdkReady(ready)
    })
    return () => {
      unsubConnected()
      unsubReady()
    }
  }, [])

  useEffect(() => {
    if (isOpen && isCastEnabled && !castService.isSdkReady()) {
      void castService.init()
    }
  }, [isOpen, isCastEnabled])

  // Keyboard navigation: Escape key closes picker
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleClose])

  // Device enumeration with cancellation and schema validation
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false

    const loadDevices = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        if (!cancelled) {
          setHasPermission(false)
          setIsLoadingDevices(false)
        }
        return
      }

      setIsLoadingDevices(true)
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices()
        if (cancelled) return

        const rawOutputs = allDevices.filter((d) => d.kind === 'audiooutput')
        const outputs: AudioDeviceItem[] = []

        for (let i = 0; i < rawOutputs.length; i++) {
          const d = rawOutputs[i]!
          const parsed = audioDeviceSchema.safeParse({
            deviceId: d.deviceId || (i === 0 ? 'default' : `device-${i}`),
            label: d.label || `Audio Output ${i + 1}`,
          })
          if (parsed.success) {
            outputs.push(parsed.data)
          }
        }

        if (outputs.length === 0) {
          outputs.push({ deviceId: 'default', label: 'Default System Output' })
        }

        setDevices(outputs)
        setHasPermission(true)
      } catch {
        if (!cancelled) setHasPermission(false)
      } finally {
        if (!cancelled) setIsLoadingDevices(false)
      }
    }

    void loadDevices()

    const onDeviceChange = () => {
      if (!cancelled) void loadDevices()
    }

    navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange)
    return () => {
      cancelled = true
      navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSelectDevice = async (deviceId: string) => {
    if (isSwitching) return
    if (!deviceId || typeof deviceId !== 'string') return
    if (deviceId === activeDeviceId) {
      handleClose()
      return
    }

    setIsSwitching(true)
    setErrorMessage(null)

    try {
      const success = await setAudioOutput(deviceId)
      if (success) {
        setSelectedDeviceId(deviceId)
        handleClose()
      } else {
        // Retain the previous device on failure and display the actual state
        setErrorMessage(
          'Failed to switch audio output. Device may be unavailable or restricted by browser policies.',
        )
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Error changing audio output device',
      )
    } finally {
      setIsSwitching(false)
    }
  }

  const handleCastClick = async () => {
    if (isCastLoading) return
    if (isCastConnected) {
      await castService.disconnect()
      return
    }

    setIsCastLoading(true)
    setErrorMessage(null)

    try {
      const success = await castService.requestSession()
      if (success) {
        handleClose()
      } else {
        // Keep picker open and inform user of failure instead of silent drop
        setErrorMessage(
          'Could not connect to Google Cast. Please ensure a Cast receiver is turned on and connected to the same network.',
        )
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Error requesting Cast session')
    } finally {
      setIsCastLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="audio-output-title"
    >
      <div className="relative w-full max-w-xs rounded-2xl border border-white/10 bg-[#16141e] p-5 text-[#f4f1f7] shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-[#7c5cff]/15 p-1.5 text-[#b09cff]">
              <Speaker size={16} />
            </div>
            <h3 id="audio-output-title" className="text-sm font-bold text-white">
              Audio Output Sink
            </h3>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close audio output picker"
            className="rounded-lg bg-white/4 p-1.5 text-[#a59fad] transition-colors hover:bg-white/8 hover:text-white"
          >
            <X size={15} />
          </button>
        </div>

        {errorMessage && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">
            <ShieldAlert size={15} className="mt-0.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {!isRoutingSupported && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-200">
            <ShieldAlert size={15} className="mt-0.5 shrink-0" />
            <span>Audio device routing is not supported by this browser. Output will follow system defaults.</span>
          </div>
        )}

        {!hasPermission ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            <span>Audio device enumeration is restricted by browser security policies.</span>
          </div>
        ) : isLoadingDevices ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-xs text-[#a59fad]">
            <Loader2 size={20} className="animate-spin text-[#7c5cff]" />
            <span>Enumerating audio devices...</span>
          </div>
        ) : (
          <div
            role="radiogroup"
            aria-label="Audio output devices"
            className="custom-scrollbar flex max-h-60 flex-col gap-1.5 overflow-y-auto"
          >
            {isCastEnabled && (
              <button
                type="button"
                disabled={isCastLoading}
                onClick={() => void handleCastClick()}
                className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs font-medium transition-colors ${
                  isCastConnected
                    ? 'border border-[#7c5cff]/30 bg-[#7c5cff]/15 text-[#b09cff]'
                    : 'text-white hover:bg-white/6'
                } ${isCastLoading ? 'opacity-70 cursor-wait' : ''}`}
              >
                <span className="flex items-center gap-2.5 truncate pr-2">
                  <Cast
                    size={15}
                    className={
                      isCastConnected
                        ? 'text-[#7c5cff]'
                        : isCastLoading
                          ? 'animate-pulse text-[#b09cff]'
                          : 'text-[#a59fad]'
                    }
                  />
                  <span className="truncate">
                    {isCastLoading
                      ? isSdkReady
                        ? 'Connecting to Cast...'
                        : 'Loading Cast SDK...'
                      : isCastConnected
                        ? 'Google Cast Receiver (Connected)'
                        : 'Google Cast Receiver'}
                  </span>
                </span>
                {isCastConnected && (
                  <Check size={14} className="shrink-0 text-[#7c5cff]" />
                )}
              </button>
            )}
            {devices.length === 0 ? (
              <div className="py-4 text-center text-xs text-[#a59fad]">
                No audio output devices found.
              </div>
            ) : (
              devices.map((device) => {
                const isSelected = activeDeviceId === device.deviceId
                const isHeadphones = /headphone|earbud|airpod|headset/i.test(device.label)
                const Icon = isHeadphones ? Headphones : Speaker

                return (
                  <button
                    key={device.deviceId}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    tabIndex={isSelected ? 0 : -1}
                    disabled={isSwitching}
                    onClick={() => void handleSelectDevice(device.deviceId)}
                    className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs font-medium transition-colors ${
                      isSelected
                        ? 'border border-[#7c5cff]/30 bg-[#7c5cff]/15 text-[#b09cff]'
                        : 'text-white hover:bg-white/6'
                    } ${isSwitching ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span className="flex items-center gap-2.5 truncate pr-2">
                      <Icon size={15} className={isSelected ? 'text-[#7c5cff]' : 'text-[#a59fad]'} />
                      <span className="truncate">{device.label}</span>
                    </span>
                    {isSelected && <Check size={14} className="shrink-0 text-[#7c5cff]" />}
                  </button>
                )
              })
            )}
          </div>
        )}

        <p className="mt-3 border-t border-white/4 pt-3 text-[11px] leading-normal text-[#a59fad]/80">
          Select USB DACs, Bluetooth headphones, or external monitor speakers directly.
        </p>
      </div>
    </div>
  )
}
