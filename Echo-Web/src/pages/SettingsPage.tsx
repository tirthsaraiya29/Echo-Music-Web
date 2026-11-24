import { useState, useEffect, useRef } from 'react'
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  HardDrive,
  Info,
  Languages,
  Moon,
  Palette,
  Radio,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Sun,
  Trash2,
  DownloadCloud,
  FileUp,
  X,
  Cloud,
  Server,
  Puzzle,
  RefreshCw,
  Wifi,
} from 'lucide-react'
import { EchoMusicLogo } from '../components/EchoMusicLogo.tsx'
import { useLatestRelease } from '../hooks/useLatestRelease.ts'
import type { AccentColor, AudioQuality, CrossfadeProfile, UserPreferences } from '../types/domain.ts'
import { useEchoStore } from '../stores/useEchoStore.ts'
import { classNames } from '../utils/classNames.ts'
import { useAudioEngine } from '../hooks/useAudioEngine.ts'
import { getLastFmAuthUrl, fetchLastFmSession } from '../services/lastfm/lastfmService.ts'
import { checkDiscordStatus } from '../services/discord/discordService.ts'
import { castService } from '../services/cast/castService.ts'
import {
  getStorageUsage,
  exportFullBackup,
  importFullBackup,
  clearListeningHistory,
} from '../services/db/echoDatabase.ts'
import {
  getExcludedTracks,
  restoreExcludedTrack,
} from '../services/recommendations/localTasteEngine.ts'
import { triggerFileDownload } from '../services/sharing/playlistPortability.ts'
import { cloudMediaManager } from '../services/cloud/cloudMediaManager.ts'
import type { CloudServerConfig, CloudProviderType } from '../services/cloud/cloudMediaTypes.ts'
import { extensionManager } from '../services/extensions/extensionManager.ts'
import type { AddonEndpoint, ExtensionTelemetry } from '../types/extension.ts'
import { pwaManager } from '../services/pwa/pwaManager.ts'
import type { SwStatus } from '../services/pwa/pwaTypes.ts'
import {
  getNetworkConnectionInfo,
  subscribeNetworkChange,
  getEffectiveAudioQuality,
} from '../services/networkQuality.ts'

const accents: { value: AccentColor; label: string; color: string }[] = [
  { value: 'violet', label: 'Violet', color: '#8b79e8' },
  { value: 'emerald', label: 'Fern', color: '#58ad83' },
  { value: 'amber', label: 'Ochre', color: '#d59b52' },
  { value: 'rose', label: 'Rose', color: '#d5798f' },
  { value: 'sky', label: 'Sky', color: '#59a4c6' },
]

const qualityOptions: { value: AudioQuality; label: string; description: string }[] = [
  { value: 'low', label: 'Low', description: 'Smallest data footprint (AAC ~128 kbps)' },
  { value: 'medium', label: 'Standard', description: 'Balanced Opus quality (~100 kbps)' },
  { value: 'high', label: 'High', description: 'Highest available YouTube stream quality (Opus ~160 kbps)' },
  {
    value: 'lossless',
    label: 'Lossless',
    description: 'Bit-perfect playback for local and extension FLAC/WAV files (YouTube streams map to High ~160 kbps)',
  },
]

const regions = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'IN', name: 'India' },
  { code: 'JP', name: 'Japan' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'BR', name: 'Brazil' },
  { code: 'KR', name: 'South Korea' },
]

type BooleanPreference = {
  [K in keyof UserPreferences]: UserPreferences[K] extends boolean | undefined ? K : never
}[keyof UserPreferences]

function PreferenceToggle<K extends BooleanPreference>({
  label,
  description,
  preference,
  value,
  onChange,
}: {
  label: string
  description: string
  preference: K
  value: boolean | undefined
  onChange: (key: K, value: boolean) => void
}) {
  const checked = Boolean(value)
  return (
    <label className="setting-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        className="switch"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(preference, event.target.checked)}
      />
    </label>
  )
}

export function SettingsPage() {
  const release = useLatestRelease()
  const preferences = useEchoStore((state) => state.preferences)
  const setPreference = useEchoStore((state) => state.setPreference)
  const resetPreferences = useEchoStore((state) => state.resetPreferences)
  const likedTrackIds = useEchoStore((state) => state.likedTrackIds)
  const notify = useEchoStore((state) => state.setToast)
  const {
    setCrossfadeDuration,
    setCrossfadeProfile,
    setVolumeNormalization,
    setGaplessPlayback,
    getAudioTelemetry,
    clearHistory,
  } = useAudioEngine()

  const [activeSection, setActiveSection] = useState('all')
  const [settingsFilter, setSettingsFilter] = useState('')
  const [storageStats, setStorageStats] = useState<{
    localFilesCount: number
    historyCount: number
  } | null>(null)
  const [excludedTracks, setExcludedTracks] = useState<
    Array<{ trackId: string; trackTitle: string; artistName: string }>
  >([])
  const [cloudServers, setCloudServers] = useState<CloudServerConfig[]>(() =>
    cloudMediaManager.getServers(),
  )
  const [cloudType, setCloudType] = useState<CloudProviderType>('jellyfin')
  const [cloudUrl, setCloudUrl] = useState('')
  const [cloudUser, setCloudUser] = useState('')
  const [cloudPassword, setCloudPassword] = useState('')
  const [cloudConnecting, setCloudConnecting] = useState(false)
  const [cloudError, setCloudError] = useState<string | null>(null)

  const [discordCheckStatus, setDiscordCheckStatus] = useState<
    'idle' | 'checking' | 'connected' | 'disconnected'
  >('idle')
  const [discordStatusMessage, setDiscordStatusMessage] = useState<string>('')
  const [swStatus, setSwStatus] = useState<SwStatus>(() => pwaManager.getStatus())
  const [checkingForUpdates, setCheckingForUpdates] = useState(false)

  useEffect(() => {
    const unsubscribe = pwaManager.subscribe((status) => {
      setSwStatus(status)
    })
    return () => unsubscribe()
  }, [])

  const handleTestDiscord = async () => {
    setDiscordCheckStatus('checking')
    setDiscordStatusMessage('')
    try {
      const status = await checkDiscordStatus({ timeoutMs: 3000 })
      if (status && (status.socketConnected || status.isLocalDeployment)) {
        setDiscordCheckStatus('connected')
        setDiscordStatusMessage(status.hint || 'Discord service reachable.')
      } else {
        const bridgeUrl = (preferences.discordBridgeUrl || 'http://127.0.0.1:6463').replace(/\/+$/, '')
        let companionOk = false
        try {
          const compRes = await fetch(`${bridgeUrl}/status`, { signal: AbortSignal.timeout(1500) })
          companionOk = compRes.ok
        } catch {
          companionOk = false
        }
        if (companionOk) {
          setDiscordCheckStatus('connected')
          setDiscordStatusMessage('Connected via Desktop Companion Bridge.')
        } else {
          setDiscordCheckStatus('disconnected')
          setDiscordStatusMessage(
            status?.hint ||
              'Discord desktop app or companion bridge not detected. Launch Discord locally or start the companion app.',
          )
        }
      }
    } catch {
      setDiscordCheckStatus('disconnected')
      setDiscordStatusMessage('Unable to reach Discord status endpoint.')
    }
  }

  const [addons, setAddons] = useState<AddonEndpoint[]>(() => extensionManager.getAddons())
  const [addonUrl, setAddonUrl] = useState('')
  const [addonName, setAddonName] = useState('')
  const [addonTesting, setAddonTesting] = useState(false)
  const [addonError, setAddonError] = useState<string | null>(null)
  const [addonTelemetry, setAddonTelemetry] = useState<ExtensionTelemetry>(() =>
    extensionManager.getTelemetry(),
  )

  const restoreInputRef = useRef<HTMLInputElement>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const telemetry = getAudioTelemetry()
  const [networkInfo, setNetworkInfo] = useState(() => getNetworkConnectionInfo())

  useEffect(() => {
    return subscribeNetworkChange((info) => setNetworkInfo(info))
  }, [])

  const sections = [
    {
      id: 'playback',
      label: 'Playback & Audio',
      icon: SlidersHorizontal,
      keywords: 'quality crossfade normalize data saver streaming silence audio dsp',
    },
    {
      id: 'appearance',
      label: 'Appearance',
      icon: Palette,
      keywords: 'theme accent scroll compact layout dark light system',
    },
    {
      id: 'content',
      label: 'Content & Region',
      icon: Globe,
      keywords: 'region explicit start tab catalog language',
    },
    {
      id: 'lyrics',
      label: 'Lyrics & Providers',
      icon: Languages,
      keywords: 'lyrics provider romanize translation lrclib kugou',
    },
    {
      id: 'integrations',
      label: 'Connected Services',
      icon: Radio,
      keywords: 'lastfm scrobble discord presence cast streaming chromecast',
    },
    {
      id: 'cloud',
      label: 'Cloud Media',
      icon: Cloud,
      keywords: 'cloud jellyfin navidrome subsonic server self-hosted streaming library',
    },
    {
      id: 'extensions',
      label: 'Extension Audio',
      icon: Puzzle,
      keywords: 'extensions addon audio lossless sources high quality manifest stream',
    },
    {
      id: 'taste',
      label: 'Recommendation Exclusions',
      icon: Sparkles,
      keywords: 'exclude recommend restore taste songs',
    },
    {
      id: 'storage',
      label: 'Storage & Backup',
      icon: HardDrive,
      keywords: 'backup export restore history clear diagnostics database reset',
    },
    {
      id: 'about',
      label: 'About Echo',
      icon: Info,
      keywords: 'version telemetry engine legal info license',
    },
  ]

  useEffect(() => {
    let active = true
    Promise.all([getStorageUsage(), getExcludedTracks()])
      .then(([stats, exclusions]) => {
        if (active) {
          setStorageStats(stats)
          setExcludedTracks(exclusions)
        }
      })
      .catch(() => {})

    // Check for Last.fm OAuth callback token
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (token) {
      params.delete('token')
      const rest = params.toString()
      window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''))
      void fetchLastFmSession(token)
        .then((session) => {
          setPreference('lastfmSession', session)
          setPreference('lastfmScrobbling', true)
          notify(`Connected to Last.fm as ${session.username}`)
        })
        .catch((err) => {
          notify(err instanceof Error ? err.message : 'Failed to connect to Last.fm')
        })
    }

    return () => {
      active = false
    }
  }, [setPreference, notify])

  useEffect(() => {
    return cloudMediaManager.subscribe((servers) => {
      setCloudServers(servers)
    })
  }, [])

  const handleConnectCloud = async () => {
    if (!cloudUrl.trim()) {
      setCloudError('Server URL is required')
      return
    }
    setCloudConnecting(true)
    setCloudError(null)
    try {
      const res = await cloudMediaManager.testConnection({
        type: cloudType,
        serverUrl: cloudUrl.trim(),
        username: cloudUser.trim() || undefined,
        password: cloudPassword || undefined,
      })
      if (!res.success) {
        setCloudError(res.error || 'Connection failed')
      } else {
        cloudMediaManager.addServer({
          name:
            res.serverName || (cloudType === 'jellyfin' ? 'Jellyfin Server' : 'Navidrome Server'),
          type: cloudType,
          serverUrl: cloudUrl.trim(),
          username: cloudUser.trim(),
          token: res.token,
          userId: res.userId,
          salt: res.salt,
        })
        setCloudUrl('')
        setCloudUser('')
        setCloudPassword('')
        notify(`Connected to ${res.serverName || cloudType}`)
      }
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setCloudConnecting(false)
    }
  }

  const handleRemoveCloud = (id: string, name: string) => {
    cloudMediaManager.removeServer(id)
    notify(`Removed ${name}`)
  }

  useEffect(() => {
    return extensionManager.subscribe((list) => {
      setAddons(list)
      setAddonTelemetry(extensionManager.getTelemetry())
    })
  }, [])

  const handleAddAddon = async () => {
    if (!addonUrl.trim()) {
      setAddonError('Extension URL is required')
      return
    }
    setAddonTesting(true)
    setAddonError(null)
    try {
      const added = await extensionManager.addAddon({
        name: addonName.trim() || undefined,
        url: addonUrl.trim(),
      })
      setAddonUrl('')
      setAddonName('')
      notify(`Added audio extension: ${added.name}`)
    } catch (err) {
      setAddonError(err instanceof Error ? err.message : 'Could not add extension')
    } finally {
      setAddonTesting(false)
    }
  }

  const handleToggleAddon = (id: string, enabled: boolean) => {
    extensionManager.toggleAddon(id, enabled)
  }

  const handleRemoveAddon = (id: string, name: string) => {
    extensionManager.removeAddon(id)
    notify(`Removed extension ${name}`)
  }

  const [pingingId, setPingingId] = useState<string | null>(null)

  const handleTestEndpoint = async (id: string) => {
    setPingingId(id)
    try {
      const res = await extensionManager.testEndpointHealth(id)
      if (res.status === 'online') {
        notify(`Endpoint is online (${res.latencyMs ?? 0}ms)`)
      } else {
        notify(`Endpoint check: ${res.status}${res.error ? ` - ${res.error}` : ''}`)
      }
    } catch {
      notify('Health check failed')
    } finally {
      setPingingId(null)
    }
  }

  const handleTestAllEndpoints = async () => {
    setPingingId('all')
    try {
      await extensionManager.testAllEndpoints()
      notify('Checked health for all endpoints')
    } finally {
      setPingingId(null)
    }
  }

  const save = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    setPreference(key, value)
    if (key === 'crossfadeDuration' && typeof value === 'number') {
      setCrossfadeDuration(value)
    }
    if (key === 'crossfadeProfile' && typeof value === 'string') {
      setCrossfadeProfile(value as CrossfadeProfile)
    }
    if (key === 'volumeNormalization' && typeof value === 'boolean') {
      setVolumeNormalization(value)
    }
    if (key === 'gaplessPlayback' && typeof value === 'boolean') {
      setGaplessPlayback(value)
    }
    notify('Preference saved')
  }

  const jumpTo = (id: string) => {
    setActiveSection(id)
    if (id === 'all') {
      window.scrollTo({ top: 0, behavior: preferences.smoothScrolling ? 'smooth' : 'auto' })
      return
    }
    document.getElementById(`settings-${id}`)?.scrollIntoView({
      behavior: preferences.smoothScrolling ? 'smooth' : 'auto',
      block: 'start',
    })
  }

  const handleExportBackup = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      const playlists = useEchoStore.getState().playlists
      const json = await exportFullBackup(
        preferences as unknown as Record<string, unknown>,
        likedTrackIds,
        playlists,
      )
      triggerFileDownload(
        json,
        `echo-backup-${new Date().toISOString().slice(0, 10)}.json`,
        'application/json',
      )
      notify('Exported full database backup')
    } catch (err) {
      notify('Failed to export backup: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setIsExporting(false)
    }
  }

  const refreshStorageData = async () => {
    try {
      const stats = await getStorageUsage()
      setStorageStats(stats)
      const exclusions = await getExcludedTracks()
      setExcludedTracks(exclusions)
    } catch {
      // Ignore
    }
  }

  const handleRestoreBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || isRestoring) return
    setIsRestoring(true)
    try {
      const content = await file.text()
      const res = await importFullBackup(content, 'merge')

      // Hydrate Zustand store with restored playlists
      if (res.restoredPlaylists && res.restoredPlaylists.length > 0) {
        const store = useEchoStore.getState()
        const existingMap = new Map(store.playlists.map((p) => [p.id, p]))
        for (const p of res.restoredPlaylists) {
          existingMap.set(p.id, {
            id: p.id,
            title: p.title,
            description: p.description || '',
            owner: 'You',
            image: p.coverUrl || '',
            trackIds: p.trackIds || [],
            curated: false,
            createdAt: p.createdAt || Date.now(),
          })
        }
        useEchoStore.setState({ playlists: Array.from(existingMap.values()) })
      }

      // Hydrate liked tracks if present in backup
      if (res.likedTrackIds && res.likedTrackIds.length > 0) {
        const currentLikes = new Set(useEchoStore.getState().likedTrackIds)
        for (const id of res.likedTrackIds) {
          currentLikes.add(id)
        }
        useEchoStore.setState({ likedTrackIds: Array.from(currentLikes) })
      }

      notify(`Restored ${res.playlistsRestored} playlists and ${res.historyRestored} history items`)
      await refreshStorageData()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Invalid backup file')
    } finally {
      setIsRestoring(false)
      if (e.target) e.target.value = ''
    }
  }

  const handleRestoreExcluded = async (trackId: string, trackTitle: string) => {
    await restoreExcludedTrack(trackId)
    notify(`Restored "${trackTitle}" to recommendations`)
    await refreshStorageData()
  }

  const handleClearHistoryAction = async () => {
    await clearListeningHistory()
    useEchoStore.getState().clearRecentHistory()
    clearHistory()
    notify('Cleared listening history, recent items, and playback queue history')
    await refreshStorageData()
  }

  const matchesFilter = (sectionId: string, label: string, keywords: string) => {
    if (!settingsFilter.trim()) return true
    const q = settingsFilter.toLowerCase().trim()
    return (
      label.toLowerCase().includes(q) || keywords.toLowerCase().includes(q) || sectionId.includes(q)
    )
  }

  return (
    <div className="page settings-page">
      <header className="settings-header">
        <div className="settings-header__copy">
          <h1>Settings</h1>
          <p>Configure playback DSP, visual theme, regional catalog, and local data persistence.</p>
        </div>
        <div className="settings-header__search">
          <Search size={15} />
          <input
            type="search"
            placeholder="Search settings..."
            value={settingsFilter}
            onChange={(e) => setSettingsFilter(e.target.value)}
            aria-label="Filter settings"
          />
          {settingsFilter && (
            <button
              type="button"
              onClick={() => setSettingsFilter('')}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 text-white/40 hover:text-white"
              aria-label="Clear filter"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </header>

      <div className="settings-pills" role="tablist" aria-label="Settings categories">
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === 'all'}
          className={classNames('settings-pill', activeSection === 'all' && 'is-active')}
          onClick={() => jumpTo('all')}
        >
          All Categories
        </button>
        {sections.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeSection === id}
            className={classNames('settings-pill', activeSection === id && 'is-active')}
            onClick={() => jumpTo(id)}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="settings-content">
        {/* Section: Playback & Audio DSP */}
        {matchesFilter(
          'playback',
          'Playback & Audio DSP',
          'quality crossfade normalize data saver streaming silence',
        ) && (
          <section id="settings-playback" className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-section__icon">
                <SlidersHorizontal size={18} />
              </span>
              <div>
                <h2>Playback & Audio DSP</h2>
                <p>Fine-tune crossfades, volume normalization, and streaming fidelity.</p>
              </div>
            </div>

            {/* Real-time Network Quality Indicator */}
            <div className="mb-4 flex items-center justify-between rounded-xl border border-white/6 bg-white/3 p-3 text-xs">
              <div className="flex items-center gap-2.5">
                <Wifi size={15} className="text-[#b09cff]" />
                <div>
                  <span className="text-[#a59fad]">Active Network: </span>
                  <strong className="text-white capitalize">
                    {networkInfo.isMetered ? 'Cellular / Metered' : 'Wi-Fi / Unmetered'}
                  </strong>
                  {networkInfo.saveData && (
                    <span className="ml-2 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                      Data Saver Active
                    </span>
                  )}
                </div>
              </div>
              <div className="text-[11px] text-[#a59fad]">
                Effective Tier:{' '}
                <strong className="font-semibold text-[#b09cff] uppercase">
                  {getEffectiveAudioQuality(preferences)}
                </strong>
              </div>
            </div>

            {/* Wi-Fi / Unmetered Quality Tier */}
            <div className="quality-setting">
              <div>
                <strong>Wi-Fi & Unmetered streaming quality</strong>
                <small>Quality ceiling applied over Wi-Fi, Ethernet, and high-speed unmetered links.</small>
              </div>
              <div
                className="quality-options"
                role="radiogroup"
                aria-label="Wi-Fi audio quality preference"
              >
                {qualityOptions.map((option) => (
                  <button
                    key={option.value}
                    className={classNames(
                      'quality-option',
                      (preferences.audioQualityWifi ?? 'lossless') === option.value && 'is-active',
                    )}
                    type="button"
                    role="radio"
                    aria-checked={(preferences.audioQualityWifi ?? 'lossless') === option.value}
                    onClick={() => {
                      save('audioQualityWifi', option.value)
                      save('audioQuality', option.value)
                    }}
                  >
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                    {(preferences.audioQualityWifi ?? 'lossless') === option.value && <Check size={16} />}
                  </button>
                ))}
              </div>
            </div>

            {/* Cellular / Metered Quality Tier */}
            <div className="quality-setting mt-4">
              <div>
                <strong>Cellular & Metered streaming quality</strong>
                <small>Quality ceiling enforced over mobile cellular networks and metered connections.</small>
              </div>
              <div
                className="quality-options"
                role="radiogroup"
                aria-label="Cellular audio quality preference"
              >
                {qualityOptions.map((option) => (
                  <button
                    key={option.value}
                    className={classNames(
                      'quality-option',
                      (preferences.audioQualityCellular ?? 'medium') === option.value && 'is-active',
                    )}
                    type="button"
                    role="radio"
                    aria-checked={(preferences.audioQualityCellular ?? 'medium') === option.value}
                    onClick={() => save('audioQualityCellular', option.value)}
                  >
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                    {(preferences.audioQualityCellular ?? 'medium') === option.value && <Check size={16} />}
                  </button>
                ))}
              </div>
            </div>

            <div className="setting-row">
              <span>
                <strong>Crossfade duration</strong>
                <small>
                  Transition time between consecutive tracks ({preferences.crossfadeDuration ?? 3}
                  s).
                </small>
              </span>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={12}
                  step={1}
                  value={preferences.crossfadeDuration ?? 3}
                  onChange={(e) => save('crossfadeDuration', Number(e.target.value))}
                  className="w-32 accent-[#7c5cff]"
                  aria-label="Crossfade duration in seconds"
                />
                <span className="w-8 font-mono text-xs text-[#a59fad]">
                  {preferences.crossfadeDuration ?? 3}s
                </span>
              </div>
            </div>

            <div className="setting-row">
              <span>
                <strong>Crossfade profile</strong>
                <small>Acoustic curve shaping volume transition between consecutive tracks.</small>
              </span>
              <select
                className="select"
                value={preferences.crossfadeProfile ?? 'equalPower'}
                onChange={(e) => save('crossfadeProfile', e.target.value as CrossfadeProfile)}
                aria-label="Crossfade curve profile"
              >
                <option value="equalPower">Equal Power (Constant loudness)</option>
                <option value="linear">Linear (Constant gain sum)</option>
                <option value="logarithmic">Logarithmic (Smooth exponential decay)</option>
                <option value="scurve">S-Curve (Gentle start & finish)</option>
              </select>
            </div>

            <PreferenceToggle
              label="Volume normalization"
              description="DynamicsCompressorNode evens out perceived loudness across diverse master recordings."
              preference="volumeNormalization"
              value={preferences.volumeNormalization}
              onChange={save}
            />

            <PreferenceToggle
              label="Gapless playback"
              description="Continuous playback without silence or reloading between consecutive tracks using dual-deck prebuffering."
              preference="gaplessPlayback"
              value={preferences.gaplessPlayback ?? true}
              onChange={save}
            />

            <PreferenceToggle
              label="Echo Brain momentum queue"
              description="Dynamically adapts upcoming radio recommendations based on listening momentum, rapid skips, and session likes."
              preference="echoBrainEnabled"
              value={preferences.echoBrainEnabled ?? true}
              onChange={save}
            />

            <PreferenceToggle
              label="Skip silence"
              description="Automatically detects and skips leading silence at the start of tracks."
              preference="skipSilence"
              value={preferences.skipSilence}
              onChange={save}
            />

            <PreferenceToggle
              label="Data saver"
              description="Prefers lower stream bitrates, suspends background track preloading, and respects browser Data Saver network policies."
              preference="dataSaver"
              value={preferences.dataSaver}
              onChange={save}
            />
          </section>
        )}

        {/* Section: Appearance */}
        {matchesFilter('appearance', 'Appearance', 'theme accent scroll compact layout') && (
          <section id="settings-appearance" className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-section__icon">
                <Palette size={18} />
              </span>
              <div>
                <h2>Appearance</h2>
                <p>Customize the visual presentation and layout density.</p>
              </div>
            </div>

            <div className="setting-row">
              <span>
                <strong>Theme mode</strong>
                <small>Select light, dark, or system color scheme.</small>
              </span>
              <div className="segmented-control" role="group" aria-label="Theme mode">
                <button
                  type="button"
                  className={preferences.themeMode === 'light' ? 'is-active' : ''}
                  aria-pressed={preferences.themeMode === 'light'}
                  onClick={() => save('themeMode', 'light')}
                >
                  <Sun size={14} /> Light
                </button>
                <button
                  type="button"
                  className={preferences.themeMode === 'dark' ? 'is-active' : ''}
                  aria-pressed={preferences.themeMode === 'dark'}
                  onClick={() => save('themeMode', 'dark')}
                >
                  <Moon size={14} /> Dark
                </button>
                <button
                  type="button"
                  className={preferences.themeMode === 'system' ? 'is-active' : ''}
                  aria-pressed={preferences.themeMode === 'system'}
                  onClick={() => save('themeMode', 'system')}
                >
                  <Sparkles size={14} /> System
                </button>
              </div>
            </div>

            <div className="setting-row">
              <span>
                <strong>Accent colour</strong>
                <small>
                  Highlight tint applied to playback progress, active badges, and focus rings.
                </small>
              </span>
              <div className="accent-options" role="radiogroup" aria-label="Accent colour">
                {accents.map((accent) => (
                  <button
                    key={accent.value}
                    className={classNames(
                      'accent-swatch',
                      preferences.accentColor === accent.value && 'is-selected',
                    )}
                    style={{ '--swatch-color': accent.color } as React.CSSProperties}
                    type="button"
                    role="radio"
                    aria-checked={preferences.accentColor === accent.value}
                    aria-label={accent.label}
                    onClick={() => save('accentColor', accent.value)}
                  >
                    {preferences.accentColor === accent.value && <Check size={16} />}
                  </button>
                ))}
              </div>
            </div>

            <PreferenceToggle
              label="Smooth scrolling"
              description="Smooth animated transitions when jumping through playlists and queues."
              preference="smoothScrolling"
              value={preferences.smoothScrolling}
              onChange={save}
            />

            <PreferenceToggle
              label="Compact list view"
              description="Denser track rows designed for large collections and desktop displays."
              preference="compactLists"
              value={preferences.compactLists}
              onChange={save}
            />
          </section>
        )}

        {/* Section: Content & Region */}
        {matchesFilter('content', 'Content & Regional Catalog', 'region explicit start tab') && (
          <section id="settings-content" className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-section__icon">
                <Globe size={18} />
              </span>
              <div>
                <h2>Content & Regional Catalog</h2>
                <p>Configure geographical catalog target and content filtering.</p>
              </div>
            </div>

            <div className="setting-row">
              <span>
                <strong>Default startup tab</strong>
                <small>Which screen Echo opens when launched.</small>
              </span>
              <select
                className="settings-select"
                value={preferences.defaultTab || 'home'}
                onChange={(e) =>
                  save('defaultTab', e.target.value as UserPreferences['defaultTab'])
                }
              >
                <option value="home">Home</option>
                <option value="search">Search</option>
                <option value="discover">Discover</option>
                <option value="library">Library</option>
                <option value="settings">Settings</option>
              </select>
            </div>

            <div className="setting-row">
              <span>
                <strong>Catalog region</strong>
                <small>
                  Geographical locale for trending charts, new releases, and discover shelves.
                </small>
              </span>
              <select
                className="settings-select"
                value={preferences.contentRegion || 'US'}
                onChange={(e) => save('contentRegion', e.target.value)}
              >
                {regions.map((reg) => (
                  <option key={reg.code} value={reg.code}>
                    {reg.name} ({reg.code})
                  </option>
                ))}
              </select>
            </div>

            <PreferenceToggle
              label="Show explicit content"
              description="Include tracks with explicit language markers in search results and charts."
              preference="showExplicit"
              value={preferences.showExplicit}
              onChange={save}
            />
          </section>
        )}

        {/* Section: Lyrics & Providers */}
        {matchesFilter(
          'lyrics',
          'Lyrics & Providers',
          'lyrics provider romanize translation lrclib kugou',
        ) && (
          <section id="settings-lyrics" className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-section__icon">
                <Languages size={18} />
              </span>
              <div>
                <h2>Lyrics & Providers</h2>
                <p>Configure synchronized lyric sources and phonetic transliteration.</p>
              </div>
            </div>

            <div className="setting-row">
              <label htmlFor="preferred-lyrics-provider">
                <strong>Preferred synchronized provider</strong>
                <small>
                  Primary database queried for word-by-word and line-by-line lyric tracks.
                </small>
              </label>
              <select
                id="preferred-lyrics-provider"
                aria-label="Preferred synchronized lyrics provider"
                className="settings-select"
                value={preferences.preferredLyricsProvider || 'LRCLIB'}
                onChange={(e) =>
                  save(
                    'preferredLyricsProvider',
                    e.target.value as UserPreferences['preferredLyricsProvider'],
                  )
                }
              >
                <option value="LRCLIB">LRCLIB (Fast & Open Source)</option>
                <option value="BETTER_LYRICS">BetterLyrics (TTML Word Timing)</option>
                <option value="KUGOU">KuGou (Global Asian Catalog)</option>
              </select>
            </div>

            <PreferenceToggle
              label="Romanize lyrics"
              description="Show phonetic romanizations (pinyin / romaja / romaji) when non-Latin scripts are present."
              preference="romanizeLyrics"
              value={preferences.romanizeLyrics}
              onChange={save}
            />
          </section>
        )}

        {/* Section: Connected Services */}
        {matchesFilter(
          'integrations',
          'Connected Services',
          'lastfm scrobble discord presence cast streaming',
        ) && (
          <section id="settings-integrations" className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-section__icon">
                <Radio size={18} />
              </span>
              <div>
                <h2>Connected Services</h2>
                <p>External scrobbling, local desktop presence, and casting bridges.</p>
              </div>
            </div>

            <div className="setting-row">
              <span>
                <strong>Last.fm scrobbling</strong>
                <small>
                  {preferences.lastfmSession?.username
                    ? `Connected as ${preferences.lastfmSession.username}`
                    : 'Scrobble listening history to your Last.fm profile as tracks play.'}
                </small>
              </span>
              <div>
                {preferences.lastfmSession ? (
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() => {
                      save('lastfmSession', undefined)
                      save('lastfmScrobbling', false)
                      notify('Disconnected from Last.fm')
                    }}
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={async () => {
                      try {
                        const url = await getLastFmAuthUrl()
                        window.location.href = url
                      } catch (err) {
                        notify(err instanceof Error ? err.message : 'Could not start Last.fm auth')
                      }
                    }}
                  >
                    Connect Last.fm
                  </button>
                )}
              </div>
            </div>

            {preferences.lastfmSession && (
              <PreferenceToggle
                label="Automatic scrobbling"
                description="Submits scrobbles once a song reaches 50% or 4 minutes of playback."
                preference="lastfmScrobbling"
                value={preferences.lastfmScrobbling}
                onChange={save}
              />
            )}

            <PreferenceToggle
              label="Discord Rich Presence"
              description="Broadcasts current track title and artist to your Discord desktop status."
              preference="discordRpc"
              value={preferences.discordRpc}
              onChange={save}
            />

            {preferences.discordRpc && (
              <div className="space-y-3 rounded-xl border border-white/6 bg-white/2 p-3 text-xs">
                <div>
                  <label className="mb-1 block text-xs text-[#a59fad]">
                    Discord Connection Mode
                  </label>
                  <select
                    className="settings-select w-full"
                    value={preferences.discordMode || 'auto'}
                    onChange={(e) =>
                      save('discordMode', e.target.value as UserPreferences['discordMode'])
                    }
                  >
                    <option value="auto">Auto (Backend IPC with Desktop Companion fallback)</option>
                    <option value="companion">Desktop Companion Bridge (Remote web client)</option>
                    <option value="backend">Backend IPC Socket (Local server only)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[#a59fad]">
                    Desktop Companion Bridge URL
                  </label>
                  <input
                    type="url"
                    placeholder="http://127.0.0.1:6463"
                    value={preferences.discordBridgeUrl || 'http://127.0.0.1:6463'}
                    onChange={(e) => save('discordBridgeUrl', e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white placeholder-white/30 focus:border-[#7c5cff] focus:outline-none"
                  />
                  <small className="mt-1 block text-[#a59fad]">
                    Enables Rich Presence when running Echo Web in a remote browser or hosted cloud
                    deployment.
                  </small>
                </div>

                <div className="flex flex-col gap-2 pt-1 border-t border-white/6">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleTestDiscord}
                      disabled={discordCheckStatus === 'checking'}
                      className="min-h-[44px] rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-[#7c5cff] disabled:opacity-50"
                      aria-label="Test Discord connection"
                    >
                      {discordCheckStatus === 'checking'
                        ? 'Testing Connection...'
                        : 'Test Discord Connection'}
                    </button>
                    {discordCheckStatus === 'connected' && (
                      <span
                        className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-1 text-[11px] font-medium text-emerald-400"
                        role="status"
                      >
                        Connected
                      </span>
                    )}
                    {discordCheckStatus === 'disconnected' && (
                      <span
                        className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-2 py-1 text-[11px] font-medium text-amber-400"
                        role="status"
                      >
                        Not Detected
                      </span>
                    )}
                  </div>
                  {discordStatusMessage && (
                    <p className="text-[11px] text-[#a59fad]" aria-live="polite">
                      {discordStatusMessage}
                    </p>
                  )}
                </div>
              </div>
            )}

            <PreferenceToggle
              label="Google Cast"
              description="Enables streaming directly to Google Cast-compatible hardware and speakers."
              preference="googleCast"
              value={preferences.googleCast}
              onChange={(key, val) => {
                save(key, val)
                if (val) castService.init()
              }}
            />

            <div className="setting-row">
              <span>
                <strong>Echo Find audio recognition</strong>
                <small>
                  Microphone-based music identification service for background audio. External live
                  matching requires RECOGNITION_PROVIDER_URL.
                </small>
              </span>
              <span className="rounded bg-white/6 px-2.5 py-1 text-[11px] font-semibold text-[#b09cff]">
                Configurable Gateway
              </span>
            </div>
          </section>
        )}

        {/* Section: Cloud Media Providers */}
        {matchesFilter(
          'cloud',
          'Cloud Media Providers',
          'cloud jellyfin navidrome subsonic server self-hosted streaming library',
        ) && (
          <section id="settings-cloud" className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-section__icon">
                <Cloud size={18} />
              </span>
              <div>
                <h2>Cloud Media Providers</h2>
                <p>Connect your self-hosted Jellyfin or Navidrome / Subsonic music servers.</p>
              </div>
            </div>

            <div className="space-y-4 rounded-xl border border-white/6 bg-white/2 p-4">
              <h3 className="text-sm font-semibold text-white">Add Cloud Server</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-[#a59fad]">Server Type</label>
                  <select
                    className="settings-select w-full"
                    value={cloudType}
                    onChange={(e) => setCloudType(e.target.value as CloudProviderType)}
                  >
                    <option value="jellyfin">Jellyfin</option>
                    <option value="navidrome">Navidrome (Subsonic API)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[#a59fad]">Server URL</label>
                  <input
                    type="url"
                    placeholder="https://jellyfin.example.com"
                    value={cloudUrl}
                    onChange={(e) => setCloudUrl(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white placeholder-white/30 focus:border-[#7c5cff] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[#a59fad]">Username</label>
                  <input
                    type="text"
                    placeholder="Username"
                    value={cloudUser}
                    onChange={(e) => setCloudUser(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white placeholder-white/30 focus:border-[#7c5cff] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[#a59fad]">Password / API Key</label>
                  <input
                    type="password"
                    placeholder="Password"
                    value={cloudPassword}
                    onChange={(e) => setCloudPassword(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white placeholder-white/30 focus:border-[#7c5cff] focus:outline-none"
                  />
                </div>
              </div>

              {cloudError && (
                <div className="rounded-lg bg-red-500/10 p-2 text-xs text-red-400">
                  {cloudError}
                </div>
              )}

              <button
                type="button"
                disabled={cloudConnecting || !cloudUrl.trim()}
                onClick={handleConnectCloud}
                className="button button--primary disabled:opacity-50"
              >
                {cloudConnecting ? 'Connecting...' : 'Connect Server'}
              </button>
            </div>

            <div className="mt-4 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#a59fad]">
                Connected Servers ({cloudServers.length})
              </h3>
              {cloudServers.length === 0 ? (
                <p className="rounded-xl border border-white/5 bg-white/2 p-4 text-xs text-[#a59fad]">
                  No cloud media servers connected. Add a Jellyfin or Navidrome server above.
                </p>
              ) : (
                cloudServers.map((server) => (
                  <div
                    key={server.id}
                    className="flex items-center justify-between rounded-xl border border-white/6 bg-white/3 p-3.5 text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-[#b09cff]">
                        <Server size={16} />
                      </div>
                      <div>
                        <strong className="block text-white">{server.name}</strong>
                        <span className="text-[#a59fad]">
                          {server.serverUrl} &bull; <span className="capitalize">{server.type}</span>
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveCloud(server.id, server.name)}
                      className="rounded-lg p-2 text-[#a59fad] transition-colors hover:bg-white/5 hover:text-red-400"
                      title="Remove server"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {/* Section: Extension Audio Sources */}
        {matchesFilter(
          'extensions',
          'Extension Audio Sources',
          'extensions addon audio lossless sources high quality manifest stream',
        ) && (
          <section id="settings-extensions" className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-section__icon">
                <Puzzle size={18} />
              </span>
              <div>
                <h2>Extension Audio Sources</h2>
                <p>
                  Configure external audio source extensions matching upstream Echo Music. When
                  enabled, matching catalog songs resolve bit-perfect lossless or high-res audio
                  before falling back to YouTube.
                </p>
              </div>
            </div>

            <div className="mb-4 flex items-center justify-between rounded-xl border border-white/6 bg-white/2 p-4">
              <div>
                <h3 className="text-sm font-semibold text-white">Extension-First Resolution</h3>
                <p className="text-xs text-[#a59fad]">
                  Resolve high-quality audio from extensions before falling back to YouTube
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={preferences.extensionSourcePriority !== 'youtube-first'}
                onClick={() =>
                  save(
                    'extensionSourcePriority',
                    preferences.extensionSourcePriority === 'youtube-first'
                      ? 'extension-first'
                      : 'youtube-first',
                  )
                }
                className={`relative inline-flex h-6 w-11 min-h-[44px] min-w-[44px] items-center rounded-full transition-colors ${
                  preferences.extensionSourcePriority !== 'youtube-first'
                    ? 'bg-[#7c5cff]'
                    : 'bg-white/20'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    preferences.extensionSourcePriority !== 'youtube-first'
                      ? 'translate-x-6'
                      : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="space-y-4 rounded-xl border border-white/6 bg-white/2 p-4">
              <h3 className="text-sm font-semibold text-white">Add Extension Endpoint</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-[#a59fad]">Addon Base URL</label>
                  <input
                    type="url"
                    placeholder="https://addon.example.com"
                    value={addonUrl}
                    onChange={(e) => setAddonUrl(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white placeholder-white/30 focus:border-[#7c5cff] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[#a59fad]">
                    Custom Name (optional)
                  </label>
                  <input
                    type="text"
                    placeholder="Auto-discovered from manifest.json"
                    value={addonName}
                    onChange={(e) => setAddonName(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white placeholder-white/30 focus:border-[#7c5cff] focus:outline-none"
                  />
                </div>
              </div>

              {addonError && (
                <div className="rounded-lg bg-red-500/10 p-2 text-xs text-red-400">
                  {addonError}
                </div>
              )}

              <button
                type="button"
                disabled={addonTesting || !addonUrl.trim()}
                onClick={handleAddAddon}
                className="button button--primary disabled:opacity-50"
              >
                {addonTesting ? 'Verifying Manifest...' : 'Add Extension'}
              </button>
            </div>

            {/* Extension Telemetry Summary */}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-white/6 bg-white/3 p-3 text-xs">
                <span className="mb-1 block text-[#a59fad]">Attempts</span>
                <strong className="font-mono text-base text-white">
                  {addonTelemetry.totalAttempts}
                </strong>
              </div>
              <div className="rounded-xl border border-white/6 bg-white/3 p-3 text-xs">
                <span className="mb-1 block text-[#a59fad]">Matches Found</span>
                <strong className="font-mono text-base text-[#58ad83]">
                  {addonTelemetry.matchesFound}
                </strong>
              </div>
              <div className="rounded-xl border border-white/6 bg-white/3 p-3 text-xs">
                <span className="mb-1 block text-[#a59fad]">Lossless Resolves</span>
                <strong className="font-mono text-base text-[#b09cff]">
                  {addonTelemetry.resolutionSuccesses}
                </strong>
              </div>
              <div className="rounded-xl border border-white/6 bg-white/3 p-3 text-xs">
                <span className="mb-1 block text-[#a59fad]">YouTube Fallbacks</span>
                <strong className="font-mono text-base text-[#d59b52]">
                  {addonTelemetry.fallbackCount}
                </strong>
              </div>
            </div>

            {/* Installed Extensions List */}
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#a59fad]">
                  Configured Extensions ({addons.length})
                </h3>
                {addons.length > 0 && (
                  <button
                    type="button"
                    onClick={handleTestAllEndpoints}
                    disabled={pingingId !== null}
                    className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-[#cfc8d8] transition-colors hover:bg-white/10 disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={pingingId === 'all' ? 'animate-spin' : ''} />
                    Ping All
                  </button>
                )}
              </div>
              {addons.length === 0 ? (
                <p className="rounded-xl border border-white/5 bg-white/2 p-4 text-xs text-[#a59fad]">
                  No audio extensions configured. Add an extension URL above to enable upstream
                  high-res / lossless source resolution.
                </p>
              ) : (
                addons.map((addon) => (
                  <div
                    key={addon.id}
                    className="flex items-center justify-between rounded-xl border border-white/6 bg-white/3 p-3.5 text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-[#b09cff]">
                        <Puzzle size={16} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <strong className="text-white">{addon.name}</strong>
                          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-[#a59fad]">
                            Priority {addon.priority}
                          </span>
                          {addon.healthStatus === 'online' && (
                            <span className="inline-flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                              Online{addon.latencyMs !== undefined ? ` • ${addon.latencyMs}ms` : ''}
                            </span>
                          )}
                          {(addon.healthStatus === 'error' || addon.healthStatus === 'offline') && (
                            <span
                              className="inline-flex items-center gap-1 rounded border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-400"
                              title={addon.lastError}
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                              {addon.healthStatus === 'error' ? 'Error' : 'Offline'}
                            </span>
                          )}
                          {addon.healthStatus === 'unknown' && (
                            <span className="inline-flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-[#a59fad]">
                              Unchecked
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[#a59fad]">
                          <span>{addon.url}</span>
                          {addon.lastSuccessAt && (
                            <>
                              <span>•</span>
                              <span className="text-[10px]">
                                Active:{' '}
                                {new Date(addon.lastSuccessAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleTestEndpoint(addon.id)}
                        disabled={pingingId !== null}
                        className="rounded-lg p-2 text-[#a59fad] transition-colors hover:bg-white/5 hover:text-[#b09cff] disabled:opacity-50"
                        title="Test endpoint health"
                      >
                        <RefreshCw
                          size={15}
                          className={pingingId === addon.id || pingingId === 'all' ? 'animate-spin' : ''}
                        />
                      </button>
                      <label className="flex cursor-pointer items-center gap-2">
                        <span className="text-[11px] text-[#a59fad]">
                          {addon.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                        <input
                          type="checkbox"
                          checked={addon.enabled}
                          onChange={(e) => handleToggleAddon(addon.id, e.target.checked)}
                          className="switch"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => handleRemoveAddon(addon.id, addon.name)}
                        className="rounded-lg p-2 text-[#a59fad] transition-colors hover:bg-white/5 hover:text-red-400"
                        title="Remove extension"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {/* Section: Recommendation Exclusions */}
        {matchesFilter('taste', 'Recommendation Exclusions', 'exclude recommend restore taste') && (
          <section id="settings-taste" className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-section__icon">
                <Sparkles size={18} />
              </span>
              <div>
                <h2>Recommendation Exclusions</h2>
                <p>Tracks you have excluded from appearing in Local Taste recommendations.</p>
              </div>
            </div>

            {excludedTracks.length === 0 ? (
              <p className="rounded-xl border border-white/5 bg-white/2 p-4 text-xs text-[#a59fad]">
                No songs are currently excluded from your recommendations. Use track action menus to
                exclude tracks you never want to hear.
              </p>
            ) : (
              <div className="custom-scrollbar max-h-56 space-y-2 overflow-y-auto">
                {excludedTracks.map((item) => (
                  <div
                    key={item.trackId}
                    className="flex items-center justify-between rounded-xl border border-white/6 bg-white/3 p-3 text-xs"
                  >
                    <div>
                      <strong className="block text-white">{item.trackTitle}</strong>
                      <span className="text-[#a59fad]">{item.artistName}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRestoreExcluded(item.trackId, item.trackTitle)}
                      className="rounded-lg bg-[#7c5cff]/20 px-2.5 py-1 text-[11px] font-semibold text-[#b09cff] transition-colors hover:bg-[#7c5cff]/30"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Section: Storage & Backup */}
        {matchesFilter(
          'storage',
          'Storage & Database Backup',
          'backup export restore history clear diagnostics database reset',
        ) && (
          <section id="settings-storage" className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-section__icon">
                <HardDrive size={18} />
              </span>
              <div>
                <h2>Storage & Database Backup</h2>
                <p>
                  Inspect local database items, export portable library backups, and manage storage.
                </p>
              </div>
            </div>

            {storageStats && (
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-white/6 bg-white/3 p-3.5 text-xs">
                  <span className="mb-1 block text-[#a59fad]">Local Scanned Files</span>
                  <strong className="font-mono text-base text-white">
                    {storageStats.localFilesCount} files
                  </strong>
                </div>

                <div className="rounded-xl border border-white/6 bg-white/3 p-3.5 text-xs">
                  <span className="mb-1 block text-[#a59fad]">Listening Events</span>
                  <strong className="font-mono text-base text-white">
                    {storageStats.historyCount} plays
                  </strong>
                </div>
              </div>
            )}

            <div className="mb-4 flex flex-wrap gap-2.5">
              <input
                type="file"
                ref={restoreInputRef}
                onChange={handleRestoreBackup}
                accept=".json"
                className="hidden"
              />

              <button
                type="button"
                onClick={handleExportBackup}
                disabled={isExporting}
                aria-busy={isExporting}
                aria-label="Export backup JSON"
                className="flex items-center gap-1.5 rounded-xl bg-[#7c5cff] px-4 py-2 text-xs font-semibold text-black shadow-md transition-colors hover:bg-[#6c48ff] disabled:opacity-50"
              >
                <DownloadCloud size={15} />
                <span>{isExporting ? 'Exporting...' : 'Export Backup (JSON)'}</span>
              </button>

              <button
                type="button"
                onClick={() => restoreInputRef.current?.click()}
                disabled={isRestoring}
                aria-busy={isRestoring}
                aria-label="Restore backup JSON"
                className="flex items-center gap-1.5 rounded-xl bg-white/6 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                <FileUp size={15} />
                <span>{isRestoring ? 'Restoring...' : 'Restore Backup'}</span>
              </button>

              <button
                type="button"
                onClick={handleClearHistoryAction}
                className="flex items-center gap-1.5 rounded-xl bg-red-500/15 px-4 py-2 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/25"
              >
                <Trash2 size={15} />
                <span>Clear History</span>
              </button>
            </div>

            <button
              type="button"
              className="reset-preferences min-h-[44px]"
              onClick={() => {
                resetPreferences()
                notify('Preferences reset to default values')
              }}
            >
              <RotateCcw size={15} /> Reset preferences to defaults
            </button>
          </section>
        )}

        {/* Section: About */}
        {matchesFilter(
          'about',
          'About Echo Music',
          'version telemetry engine legal info license app android',
        ) && (
          <section id="settings-about" className="settings-section settings-about">
            <div className="settings-section__heading">
              <span className="settings-section__icon">
                <Info size={18} />
              </span>
              <div>
                <h2>About Echo Music</h2>
                <p>Architecture, audio telemetry, and policy compliance.</p>
              </div>
            </div>

            <div className="about-card">
              <div className="about-card__brand">
                <span className="brand__symbol">
                  <EchoMusicLogo size={20} />
                </span>
                <strong>
                  Echo <span>Music</span>
                </strong>
              </div>
              <p>
                Echo Music Web provides ad-free streaming, dual-deck crossfading, synchronized
                lyrics, on-device Local Taste recommendations, and zero-media-caching architecture
                compliant with open legal policies.
              </p>
              <div className="mt-3 flex flex-wrap gap-4 border-t border-white/6 pt-3 font-mono text-xs text-[#a59fad]">
                <span>Engine Codec: {telemetry.codec}</span>
                <span>Sample Rate: {telemetry.sampleRate}</span>
                <span>Bit Depth: {telemetry.bitDepth}</span>
              </div>

              {/* PWA / Service Worker Update Controls */}
              <div className="mt-3 flex flex-col gap-2 rounded-lg border border-white/6 bg-white/[0.02] p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 font-medium text-[#e6e1e5]">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        swStatus.isOnline ? 'bg-emerald-400' : 'bg-amber-400'
                      }`}
                      aria-hidden="true"
                    />
                    App Status: {swStatus.isOnline ? 'Online' : 'Offline'}
                    {swStatus.registered && ' · Service Worker Active'}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      setCheckingForUpdates(true)
                      const hasUpdate = await pwaManager.checkForUpdates()
                      setCheckingForUpdates(false)
                      if (!hasUpdate) {
                        notify('App is up to date')
                      }
                    }}
                    disabled={checkingForUpdates}
                    className="flex min-h-[44px] min-w-[44px] items-center gap-1.5 rounded-lg bg-white/6 px-3 py-1.5 text-[11px] font-semibold text-[#a59fad] transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                    aria-label="Check for web app updates"
                  >
                    <RotateCcw size={13} className={checkingForUpdates ? 'animate-spin' : ''} />
                    {checkingForUpdates ? 'Checking…' : 'Check for updates'}
                  </button>
                </div>
                {swStatus.waitingUpdate && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="flex items-center justify-between rounded-md bg-[#8b79e8]/15 px-3 py-2 text-xs text-[#8b79e8]"
                  >
                    <span>New version of Echo Music is available!</span>
                    <button
                      type="button"
                      onClick={() => pwaManager.applyUpdate()}
                      className="min-h-[44px] rounded bg-[#8b79e8] px-3 py-1 text-xs font-semibold text-black transition-colors hover:bg-[#8b79e8]/90"
                    >
                      Update now
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <a
                  href={release.apkUrl}
                  download
                  className="flex items-center gap-1.5 rounded-lg bg-[#ed5564]/15 px-3 py-1.5 text-[11px] font-semibold text-[#ed5564] transition-colors hover:bg-[#ed5564]/25"
                  title={`Download Echo Music ${release.version} APK`}
                >
                  <Smartphone size={13} /> Download Mobile App ({release.version})
                </a>
                <a
                  href={release.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg bg-white/6 px-3 py-1.5 text-[11px] font-semibold text-[#a59fad] transition-colors hover:bg-white/10 hover:text-white"
                >
                  <ExternalLink size={13} /> GitHub Repository
                </a>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(
                        JSON.stringify(
                          {
                            userAgent: navigator.userAgent,
                            online: navigator.onLine,
                            quality: preferences.audioQuality,
                            dataSaver: preferences.dataSaver ?? false,
                            telemetry,
                            storage: storageStats,
                          },
                          null,
                          2,
                        ),
                      )
                      .then(() => notify('Diagnostics copied to clipboard'))
                      .catch(() => notify('Could not access clipboard'))
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-white/6 px-3 py-1.5 text-[11px] font-semibold text-[#a59fad] transition-colors hover:bg-white/10"
                >
                  <Copy size={13} /> Copy diagnostics
                </button>
                <span className="about-card__version">Echo Music Web · v2.4.0</span>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
