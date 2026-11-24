import { useState, useEffect } from 'react'
import { Speaker, Headphones, Check, X, ShieldAlert, Cast } from 'lucide-react'
import { useAudioEngine } from '../../hooks/useAudioEngine'
import { useEchoStore } from '../../stores/useEchoStore'
import { castService } from '../../services/cast/castService'

interface AudioOutputPickerProps {
  isOpen: boolean
  onClose: () => void
}

interface AudioDeviceItem {
  deviceId: string
  label: string
}

export function AudioOutputPicker({ isOpen, onClose }: AudioOutputPickerProps) {
  const [devices, setDevices] = useState<AudioDeviceItem[]>([])
  const { setAudioOutput, getAudioOutput, audioSinkId } = useAudioEngine()
  const currentEngineSink = getAudioOutput?.() || audioSinkId || 'default'
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const activeDeviceId = selectedDeviceId ?? currentEngineSink

  const [hasPermission, setHasPermission] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSwitching, setIsSwitching] = useState(false)
  const [isCastConnected, setIsCastConnected] = useState(() => castService.getIsConnected())
  const isCastEnabled = useEchoStore((state) => state.preferences.googleCast)

  const isRoutingSupported =
    typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype

  useEffect(() => {
    return castService.subscribe((connected) => {
      setIsCastConnected(connected)
    })
  }, [])

  useEffect(() => {
    if (!isOpen) return

    const loadDevices = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        setHasPermission(false)
        return
      }

      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices()
        const outputs = allDevices
          .filter((d) => d.kind === 'audiooutput')
          .map((d, index) => ({
            deviceId: d.deviceId,
            label: d.label || `Audio Output ${index + 1}`,
          }))

        if (outputs.length === 0) {
          outputs.push({ deviceId: 'default', label: 'Default System Output' })
        }

        setDevices(outputs)
      } catch {
        setHasPermission(false)
      }
    }

    void loadDevices()

    const onDeviceChange = () => {
      void loadDevices()
    }

    navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange)
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleClose = () => {
    setErrorMessage(null)
    onClose()
  }

  const handleSelectDevice = async (deviceId: string) => {
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Audio output device picker"
    >
      <div className="relative w-full max-w-xs rounded-2xl border border-white/10 bg-[#16141e] p-5 text-[#f4f1f7] shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-[#7c5cff]/15 p-1.5 text-[#b09cff]">
              <Speaker size={16} />
            </div>
            <h3 className="text-sm font-bold text-white">Audio Output Sink</h3>
          </div>
          <button
            type="button"
            onClick={handleClose}
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
        ) : (
          <div className="custom-scrollbar flex max-h-60 flex-col gap-1.5 overflow-y-auto">
            {isCastEnabled && (
              <button
                type="button"
                onClick={async () => {
                  await castService.requestSession()
                  handleClose()
                }}
                className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs font-medium transition-colors ${
                  isCastConnected
                    ? 'border border-[#7c5cff]/30 bg-[#7c5cff]/15 text-[#b09cff]'
                    : 'text-white hover:bg-white/6'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate pr-2">
                  <Cast
                    size={15}
                    className={isCastConnected ? 'text-[#7c5cff]' : 'text-[#a59fad]'}
                  />
                  <span className="truncate">Google Cast Receiver</span>
                </span>
                {isCastConnected && (
                  <Check size={14} className="shrink-0 text-[#7c5cff]" />
                )}
              </button>
            )}
            {devices.map((device) => {
              const isSelected = activeDeviceId === device.deviceId
              const isHeadphones = /headphone|earbud|airpod|headset/i.test(device.label)
              const Icon = isHeadphones ? Headphones : Speaker

              return (
                <button
                  key={device.deviceId}
                  type="button"
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
            })}
          </div>
        )}

        <p className="mt-3 border-t border-white/4 pt-3 text-[11px] leading-normal text-[#a59fad]/80">
          Select USB DACs, Bluetooth headphones, or external monitor speakers directly.
        </p>
      </div>
    </div>
  )
}
