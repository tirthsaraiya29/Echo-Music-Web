import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  networkTypeSchema,
  networkInfoSchema,
  networkQualityMetricsSchema,
  getNetworkConnectionInfo,
  isMeteredConnection,
  getEffectiveAudioQuality,
  shouldAllowLossless,
  shouldAllowHighBitrate,
  getNetworkQualityMetrics,
  resetNetworkQualityMetrics,
  recordNetworkQualityMetric,
} from '../src/services/networkQuality.ts'
import type { UserPreferences } from '../src/types/domain.ts'

describe('Network-Aware Quality Tiers [FEATURE-009]', () => {
  beforeEach(() => {
    resetNetworkQualityMetrics()
  })

  it('validates networkTypeSchema and networkInfoSchema', () => {
    assert.equal(networkTypeSchema.parse('wifi'), 'wifi')
    assert.equal(networkTypeSchema.parse('cellular'), 'cellular')
    assert.equal(networkTypeSchema.parse('ethernet'), 'ethernet')
    assert.equal(networkTypeSchema.parse('unknown'), 'unknown')

    const info = networkInfoSchema.parse({
      type: 'wifi',
      effectiveType: '4g',
      saveData: false,
      isMetered: false,
    })
    assert.equal(info.isMetered, false)
    assert.equal(info.type, 'wifi')
  })

  it('validates networkQualityMetricsSchema and tracks operations', () => {
    recordNetworkQualityMetric('wifiResolutions')
    recordNetworkQualityMetric('cellularResolutions')
    recordNetworkQualityMetric('dataSaverDowngrades')
    recordNetworkQualityMetric('evaluations')

    const metrics = getNetworkQualityMetrics()
    assert.equal(metrics.wifiResolutions, 1)
    assert.equal(metrics.cellularResolutions, 1)
    assert.equal(metrics.dataSaverDowngrades, 1)
    assert.equal(metrics.evaluations, 1)

    const validated = networkQualityMetricsSchema.parse(metrics)
    assert.equal(validated.evaluations, 1)

    resetNetworkQualityMetrics()
    assert.equal(getNetworkQualityMetrics().evaluations, 0)
  })

  it('resolves Wi-Fi quality tier on unmetered connections', () => {
    const prefs: Partial<UserPreferences> = {
      audioQualityWifi: 'lossless',
      audioQualityCellular: 'low',
      dataSaver: false,
    }

    const effective = getEffectiveAudioQuality(prefs)
    assert.equal(effective, 'lossless')
    assert.equal(shouldAllowLossless(prefs), true)
    assert.equal(shouldAllowHighBitrate(prefs), true)
  })

  it('forces low tier when dataSaver preference is enabled', () => {
    const prefs: Partial<UserPreferences> = {
      audioQualityWifi: 'lossless',
      audioQualityCellular: 'high',
      dataSaver: true,
    }

    const effective = getEffectiveAudioQuality(prefs)
    assert.equal(effective, 'low')
    assert.equal(shouldAllowLossless(prefs), false)
    assert.equal(shouldAllowHighBitrate(prefs), false)

    const metrics = getNetworkQualityMetrics()
    assert.equal(metrics.dataSaverDowngrades, 3)
  })

  it('detects cellular and metered conditions correctly with mock connection', () => {
    const originalNavigator = globalThis.navigator

    try {
      // Mock cellular connection
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          connection: {
            type: 'cellular',
            effectiveType: '3g',
            saveData: false,
          },
        },
        configurable: true,
      })

      assert.equal(isMeteredConnection(), true)
      const info = getNetworkConnectionInfo()
      assert.equal(info.type, 'cellular')
      assert.equal(info.isMetered, true)

      const prefs: Partial<UserPreferences> = {
        audioQualityWifi: 'lossless',
        audioQualityCellular: 'medium',
        dataSaver: false,
      }

      assert.equal(getEffectiveAudioQuality(prefs), 'medium')
      assert.equal(shouldAllowLossless(prefs), false)
      assert.equal(shouldAllowHighBitrate(prefs), false)

      const metrics = getNetworkQualityMetrics()
      assert.equal(metrics.cellularResolutions, 3)
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      })
    }
  })

  it('falls back to safe defaults when navigator is absent', () => {
    const prefs: Partial<UserPreferences> = {}
    const effective = getEffectiveAudioQuality(prefs)
    // On unmetered / unknown connection without preferences, defaults to lossless
    assert.equal(effective, 'lossless')
  })
})
