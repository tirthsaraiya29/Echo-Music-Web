import test from 'node:test'
import assert from 'node:assert/strict'

import {
  lyricsSyncProfileService,
  lyricsSyncProfileSchema,
  syncCalibrationSummarySchema,
  BUILTIN_SYNC_PROFILES,
} from '../src/services/lyrics/LyricsSyncProfileService.ts'
import { clampSyncOffset } from '../src/services/lyrics/lyricsUtils.ts'

test('Lyrics Sync Profiles: Built-in profiles conform to schema and contain standard latency presets [FEATURE-060]', () => {
  assert.ok(BUILTIN_SYNC_PROFILES.length >= 4)

  const defaultProfile = BUILTIN_SYNC_PROFILES.find((p) => p.id === 'default')
  assert.ok(defaultProfile)
  assert.strictEqual(defaultProfile.globalOffsetMs, 0)
  assert.strictEqual(defaultProfile.isDefault, true)
  assert.strictEqual(defaultProfile.providerOffsets.YOUTUBE, -200)

  const bluetoothProfile = BUILTIN_SYNC_PROFILES.find((p) => p.id === 'bluetooth')
  assert.ok(bluetoothProfile)
  assert.strictEqual(bluetoothProfile.globalOffsetMs, 180)

  for (const p of BUILTIN_SYNC_PROFILES) {
    const res = lyricsSyncProfileSchema.safeParse(p)
    assert.strictEqual(res.success, true)
  }
})

test('Lyrics Sync Profiles: clampSyncOffset restricts offsets within -60000ms to +60000ms [FEATURE-060]', () => {
  assert.strictEqual(clampSyncOffset(0), 0)
  assert.strictEqual(clampSyncOffset(500), 500)
  assert.strictEqual(clampSyncOffset(-350), -350)
  assert.strictEqual(clampSyncOffset(999999), 60000)
  assert.strictEqual(clampSyncOffset(-999999), -60000)
})

test('Lyrics Sync Profiles: profile lifecycle, switching, and custom creation [FEATURE-060]', async () => {
  lyricsSyncProfileService.resetMetrics()
  await lyricsSyncProfileService.resetAll()

  // Initial active profile is default
  const activeInitial = await lyricsSyncProfileService.getActiveProfile()
  assert.strictEqual(activeInitial.id, 'default')

  // Switch to bluetooth
  await lyricsSyncProfileService.setActiveProfile('bluetooth')
  const activeBt = await lyricsSyncProfileService.getActiveProfile()
  assert.strictEqual(activeBt.id, 'bluetooth')
  assert.strictEqual(activeBt.globalOffsetMs, 180)

  // Create custom profile
  const custom = await lyricsSyncProfileService.createProfile({
    name: 'Custom Studio Rig',
    description: 'Custom setup for USB Audio Interface',
    globalOffsetMs: -50,
    providerOffsets: { LRCLIB: 25 },
    isDefault: false,
  })
  assert.ok(custom.id.startsWith('profile-'))
  assert.strictEqual(custom.globalOffsetMs, -50)
  assert.strictEqual(custom.providerOffsets.LRCLIB, 25)

  // Switch to custom profile
  await lyricsSyncProfileService.setActiveProfile(custom.id)
  const activeCustom = await lyricsSyncProfileService.getActiveProfile()
  assert.strictEqual(activeCustom.id, custom.id)

  // Update profile
  const updated = await lyricsSyncProfileService.updateProfile(custom.id, {
    globalOffsetMs: -75,
  })
  assert.strictEqual(updated.globalOffsetMs, -75)

  // Delete custom profile reverts active to default
  const deleted = await lyricsSyncProfileService.deleteProfile(custom.id)
  assert.strictEqual(deleted, true)

  const activeAfterDelete = await lyricsSyncProfileService.getActiveProfile()
  assert.strictEqual(activeAfterDelete.id, 'default')

  // Cannot delete default profile
  const deleteDefault = await lyricsSyncProfileService.deleteProfile('default')
  assert.strictEqual(deleteDefault, false)
})

test('Lyrics Sync Profiles: per-track offset persistence and provider calibration [FEATURE-060]', async () => {
  await lyricsSyncProfileService.resetAll()

  const testTrackId = 'track-sync-test-42'

  // Initially 0 offset
  const initialOffset = await lyricsSyncProfileService.getTrackOffset(testTrackId)
  assert.strictEqual(initialOffset, 0)

  // Save general track offset
  await lyricsSyncProfileService.saveTrackOffset(testTrackId, 300)
  const savedOffset = await lyricsSyncProfileService.getTrackOffset(testTrackId)
  assert.strictEqual(savedOffset, 300)

  // Save provider-specific track offset
  await lyricsSyncProfileService.saveTrackOffset(testTrackId, 450, 'LRCLIB')
  const providerTrackOffset = await lyricsSyncProfileService.getTrackOffset(testTrackId, 'LRCLIB')
  assert.strictEqual(providerTrackOffset, 450)

  // Fallback to general track offset when asking for another provider with no specific override
  const otherProviderTrackOffset = await lyricsSyncProfileService.getTrackOffset(testTrackId, 'KUGOU')
  assert.strictEqual(otherProviderTrackOffset, 300)

  // Reset track offset
  await lyricsSyncProfileService.resetTrackOffset(testTrackId, 'LRCLIB')
  const resetOffset = await lyricsSyncProfileService.getTrackOffset(testTrackId, 'LRCLIB')
  assert.strictEqual(resetOffset, 0)
})

test('Lyrics Sync Profiles: resolveEffectiveOffset correctly combines track, profile, and provider calibration [FEATURE-060]', async () => {
  await lyricsSyncProfileService.resetAll()
  lyricsSyncProfileService.resetMetrics()

  const trackId = 'song-composite-99'

  // Case 1: Default profile (0ms), no track offset, standard LRCLIB (0ms calibration)
  const res1 = await lyricsSyncProfileService.resolveEffectiveOffset(trackId, 'LRCLIB')
  assert.strictEqual(res1.trackOffsetMs, 0)
  assert.strictEqual(res1.globalOffsetMs, 0)
  assert.strictEqual(res1.providerCalibrationMs, 0)
  assert.strictEqual(res1.effectiveOffsetMs, 0)
  assert.strictEqual(syncCalibrationSummarySchema.safeParse(res1).success, true)

  // Case 2: Default profile (0ms), YouTube Subtitles (-200ms calibration)
  const res2 = await lyricsSyncProfileService.resolveEffectiveOffset(trackId, 'YOUTUBE')
  assert.strictEqual(res2.trackOffsetMs, 0)
  assert.strictEqual(res2.globalOffsetMs, 0)
  assert.strictEqual(res2.providerCalibrationMs, -200)
  assert.strictEqual(res2.effectiveOffsetMs, -200)

  // Case 3: Switch to Bluetooth (+180ms), YouTube Subtitles (-200ms calibration)
  await lyricsSyncProfileService.setActiveProfile('bluetooth')
  const res3 = await lyricsSyncProfileService.resolveEffectiveOffset(trackId, 'YOUTUBE')
  assert.strictEqual(res3.globalOffsetMs, 180)
  assert.strictEqual(res3.providerCalibrationMs, -200)
  assert.strictEqual(res3.effectiveOffsetMs, -20) // 180 - 200 = -20

  // Case 4: Add track offset (+150ms) to Case 3
  await lyricsSyncProfileService.saveTrackOffset(trackId, 150)
  const res4 = await lyricsSyncProfileService.resolveEffectiveOffset(trackId, 'YOUTUBE')
  assert.strictEqual(res4.trackOffsetMs, 150)
  assert.strictEqual(res4.globalOffsetMs, 180)
  assert.strictEqual(res4.providerCalibrationMs, -200)
  assert.strictEqual(res4.effectiveOffsetMs, 130) // 150 + 180 - 200 = 130

  // Check metrics
  const metrics = lyricsSyncProfileService.getMetrics()
  assert.ok(metrics.effectiveOffsetLookups >= 4)
  assert.ok(metrics.profileSwitches >= 1)
  assert.ok(metrics.trackOffsetsSaved >= 1)
})
