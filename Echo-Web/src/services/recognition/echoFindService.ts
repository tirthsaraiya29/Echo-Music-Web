import {
  recognitionResultSchema,
  recognitionStatusSchema,
  echoFindRecordingOptionsSchema,
  recordEchoFindMetric,
  type RecognitionResult,
  type RecognitionStatus,
} from './echoFindTypes.ts'

export type { RecognitionResult, RecognitionStatus }

export interface StartListeningOptions {
  durationMs?: number
  timeoutMs?: number
  signal?: AbortSignal
}

export class EchoFindService {
  private mediaStream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private mediaRecorder: MediaRecorder | null = null
  private isListening = false
  private currentPromise: Promise<RecognitionResult> | null = null

  public async startListening(
    onAudioLevel?: (level: number) => void,
    optionsInput: number | StartListeningOptions = 6000,
  ): Promise<RecognitionResult> {
    const rawOptions =
      typeof optionsInput === 'number' ? { durationMs: optionsInput } : optionsInput

    const parsedOptions = echoFindRecordingOptionsSchema.safeParse({
      durationMs: rawOptions.durationMs ?? 6000,
      timeoutMs: rawOptions.timeoutMs ?? 12000,
    })

    const durationMs = parsedOptions.success ? parsedOptions.data.durationMs : 6000
    const timeoutMs = parsedOptions.success ? parsedOptions.data.timeoutMs : 12000
    const signal = typeof optionsInput === 'object' ? optionsInput.signal : undefined

    // Deduplicate concurrent startListening work
    if (this.isListening && this.currentPromise) {
      return this.currentPromise
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      recordEchoFindMetric('errors')
      throw new Error('Microphone access is not supported by your browser')
    }

    if (signal?.aborted) {
      recordEchoFindMetric('recordingsAborted')
      throw new DOMException('Recording aborted before start', 'AbortError')
    }

    this.isListening = true
    recordEchoFindMetric('recordingsStarted')

    const run = async (): Promise<RecognitionResult> => {
      let animationFrameId: number | null = null

      const abortHandler = () => {
        if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
        this.stopListening()
      }

      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true })
      }

      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: true,
          },
        })

        if (signal?.aborted) {
          throw new DOMException('Microphone stream aborted', 'AbortError')
        }

        // Setup real-time audio analyser for UI pulsing feedback
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        this.audioContext = new AudioContextClass()
        const sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream)
        this.analyser = this.audioContext.createAnalyser()
        this.analyser.fftSize = 256
        sourceNode.connect(this.analyser)

        const dataArray = new Uint8Array(this.analyser.frequencyBinCount)

        const checkAudioLevel = () => {
          if (!this.isListening || !this.analyser) return
          this.analyser.getByteFrequencyData(dataArray)
          let sum = 0
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i]!
          }
          const avg = sum / dataArray.length / 255
          onAudioLevel?.(avg)
          animationFrameId = requestAnimationFrame(checkAudioLevel)
        }

        if (onAudioLevel) {
          animationFrameId = requestAnimationFrame(checkAudioLevel)
        }

        // Record audio slice
        const recordedChunks: Blob[] = []
        const mimeType =
          typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/mp4')
              ? 'audio/mp4'
              : 'audio/wav'

        this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType })
        this.mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            recordedChunks.push(event.data)
          }
        }

        this.mediaRecorder.start(250)

        // Wait for listening duration or abort
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, durationMs)
          if (signal) {
            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer)
                reject(new DOMException('Listening aborted by user', 'AbortError'))
              },
              { once: true },
            )
          }
        })

        // Stop recording and cleanup mic
        if (animationFrameId !== null) {
          cancelAnimationFrame(animationFrameId)
        }
        this.stopListening()
        recordEchoFindMetric('recordingsCompleted')

        const audioBlob = new Blob(recordedChunks, { type: mimeType })
        if (audioBlob.size < 1000) {
          recordEchoFindMetric('identificationsFailed')
          return {
            matched: false,
            message: 'Could not record sufficient audio. Please try again.',
          }
        }

        // Send audio to recognition backend with bounded timeout
        const formData = new FormData()
        formData.append('audio', audioBlob, 'echo_recording.webm')

        const timeoutController = new AbortController()
        const timeoutTimer = setTimeout(() => timeoutController.abort(), timeoutMs)

        const fetchSignal = signal
          ? anySignal([signal, timeoutController.signal])
          : timeoutController.signal

        try {
          const res = await fetch('/api/recognition/identify', {
            method: 'POST',
            body: formData,
            signal: fetchSignal,
          })

          clearTimeout(timeoutTimer)

          if (!res.ok) {
            throw new Error(`Recognition failed with HTTP ${res.status}`)
          }

          const rawData = await res.json()
          const parsed = recognitionResultSchema.safeParse(rawData)
          if (parsed.success) {
            if (parsed.data.provider?.includes('Default') || !parsed.data.provider) {
              recordEchoFindMetric('defaultProviderRequests')
            } else {
              recordEchoFindMetric('customProviderRequests')
            }

            if (parsed.data.matched) {
              recordEchoFindMetric('identificationsMatched')
            } else if (parsed.data.configured === false) {
              recordEchoFindMetric('unconfiguredAttempts')
            } else {
              recordEchoFindMetric('identificationsFailed')
            }
            return parsed.data
          }

          recordEchoFindMetric('errors')
          return {
            matched: false,
            message: 'Invalid response from recognition provider.',
          }
        } catch (fetchErr: unknown) {
          clearTimeout(timeoutTimer)
          if (signal?.aborted) {
            recordEchoFindMetric('recordingsAborted')
            throw new DOMException('Recognition request aborted', 'AbortError')
          }
          recordEchoFindMetric('errors')
          return {
            matched: false,
            message:
              fetchErr instanceof Error
                ? fetchErr.message
                : 'Unable to connect to recognition service',
          }
        }
      } catch (err: unknown) {
        if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          recordEchoFindMetric('recordingsAborted')
        } else {
          recordEchoFindMetric('errors')
        }
        throw err
      } finally {
        if (signal) {
          signal.removeEventListener('abort', abortHandler)
        }
        this.stopListening()
        this.currentPromise = null
      }
    }

    this.currentPromise = run()
    return this.currentPromise
  }

  public stopListening(): void {
    this.isListening = false

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop()
      } catch {
        // Ignore
      }
      this.mediaRecorder = null
    }

    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach((track) => track.stop())
      } catch {
        // Ignore
      }
      this.mediaStream = null
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close()
      } catch {
        // Ignore
      }
      this.audioContext = null
    }

    this.analyser = null
  }

  public async checkStatus(options: { timeoutMs?: number } = {}): Promise<RecognitionStatus> {
    const timeoutMs = options.timeoutMs ?? 5000
    const timeoutController = new AbortController()
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs)

    try {
      const res = await fetch('/api/recognition/status', {
        signal: timeoutController.signal,
      })
      clearTimeout(timer)
      if (res.ok) {
        const raw = await res.json()
        const parsed = recognitionStatusSchema.safeParse(raw)
        if (parsed.success) {
          return parsed.data
        }
      }
    } catch {
      clearTimeout(timer)
    }

    return {
      configured: true,
      provider: 'Shazam Gateway (Default)',
      isDefault: true,
      guidance: 'Echo Find is operating with the built-in default Shazam recognition gateway.',
    }
  }

  public async getStatus(): Promise<RecognitionStatus> {
    return this.checkStatus()
  }
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const s of signals) {
    if (s.aborted) {
      controller.abort()
      return controller.signal
    }
    s.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return controller.signal
}

export const echoFind = new EchoFindService()
