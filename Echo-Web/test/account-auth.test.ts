import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import {
  youTubeAccountInfoSchema,
  youTubeAccountSessionSchema,
  getStoredYouTubeSession,
  setStoredYouTubeSession,
  clearStoredYouTubeSession,
  getSavedYouTubeAccounts,
  saveYouTubeAccount,
  removeSavedYouTubeAccount,
  switchActiveYouTubeAccount,
  recordYouTubeAccountMetric,
  getYouTubeAccountMetrics,
  resetYouTubeAccountMetrics,
  type YouTubeAccountSession,
} from '../src/services/innertube/accountAuthService.ts'

describe('accountAuthService', () => {
  beforeEach(() => {
    resetYouTubeAccountMetrics()
    clearStoredYouTubeSession()
  })

  describe('Schemas', () => {
    it('validates a YouTube account info payload', () => {
      const raw = {
        name: 'Echo Tester',
        email: 'echotester@gmail.com',
        channelHandle: '@echotester',
        avatarUrl: 'https://example.com/ytm_avatar.jpg',
        dataSyncId: 'ds_123',
        visitorData: 'vd_456',
      }
      const parsed = youTubeAccountInfoSchema.parse(raw)
      assert.strictEqual(parsed.name, 'Echo Tester')
      assert.strictEqual(parsed.email, 'echotester@gmail.com')
      assert.strictEqual(parsed.channelHandle, '@echotester')
    })

    it('validates a YouTube account session payload', () => {
      const rawSession = {
        cookie: 'SAPISID=abc123xyz; __Secure-3PSID=def456uvw',
        accountInfo: {
          name: 'Echo User',
        },
        savedAt: Date.now(),
      }
      const parsed = youTubeAccountSessionSchema.parse(rawSession)
      assert.strictEqual(parsed.cookie, 'SAPISID=abc123xyz; __Secure-3PSID=def456uvw')
      assert.strictEqual(parsed.accountInfo.name, 'Echo User')
      assert.ok(parsed.savedAt > 0)
    })
  })

  describe('Session Storage & Multi-Account Management', () => {
    it('manages active session and saved accounts when localStorage is available', () => {
      if (typeof localStorage !== 'undefined') {
        const session1: YouTubeAccountSession = {
          cookie: 'cookie_account_1',
          accountInfo: {
            name: 'Primary Account',
            email: 'primary@gmail.com',
          },
          savedAt: Date.now(),
        }

        const session2: YouTubeAccountSession = {
          cookie: 'cookie_account_2',
          accountInfo: {
            name: 'Secondary Account',
            email: 'secondary@gmail.com',
          },
          savedAt: Date.now(),
        }

        saveYouTubeAccount(session1)
        saveYouTubeAccount(session2)

        const saved = getSavedYouTubeAccounts()
        assert.ok(saved.length >= 2)

        setStoredYouTubeSession(session1.cookie, session1.accountInfo)
        assert.strictEqual(getStoredYouTubeSession()?.accountInfo.name, 'Primary Account')

        // Switch account
        const switched = switchActiveYouTubeAccount('secondary@gmail.com')
        assert.strictEqual(switched, true)
        assert.strictEqual(getStoredYouTubeSession()?.accountInfo.email, 'secondary@gmail.com')

        // Remove account
        removeSavedYouTubeAccount('secondary@gmail.com')
        assert.strictEqual(getStoredYouTubeSession(), null)
      }
    })
  })

  describe('Telemetry Metrics', () => {
    it('records and resets telemetry metrics', () => {
      recordYouTubeAccountMetric('authSuccessCount', 2)
      recordYouTubeAccountMetric('accountInfoLoadsCount', 5)
      recordYouTubeAccountMetric('accountSwitchesCount', 1)

      const metrics = getYouTubeAccountMetrics()
      assert.strictEqual(metrics.authSuccessCount, 2)
      assert.strictEqual(metrics.accountInfoLoadsCount, 5)
      assert.strictEqual(metrics.accountSwitchesCount, 1)

      resetYouTubeAccountMetrics()
      const reset = getYouTubeAccountMetrics()
      assert.strictEqual(reset.authSuccessCount, 0)
      assert.strictEqual(reset.accountInfoLoadsCount, 0)
      assert.strictEqual(reset.accountSwitchesCount, 0)
    })
  })
})
