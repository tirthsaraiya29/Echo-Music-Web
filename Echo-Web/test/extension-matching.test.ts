import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { selectBestMatch } from '../server/routes/extensions.ts'
import type { AddonTrack } from '../src/types/extension.ts'

describe('Extension Matching Confidence [FEATURE-006]', () => {
  const candidates: AddonTrack[] = [
    {
      id: 'track-studio',
      title: 'Hotel California',
      artist: 'Eagles',
      duration: 390,
      isrc: 'USPR37604111',
    },
    {
      id: 'track-live',
      title: 'Hotel California (Live on MTV 1994)',
      artist: 'Eagles',
      duration: 432,
      isrc: 'USPR39401234',
    },
    {
      id: 'track-remix',
      title: 'Hotel California (Dance Remix)',
      artist: 'DJ Eagle',
      duration: 210,
    },
    {
      id: 'track-cover',
      title: 'Hotel California',
      artist: 'Acoustic Tribute Band',
      duration: 388,
    },
  ]

  it('matches instantly with 1.0 confidence on exact ISRC match', () => {
    const match = selectBestMatch(
      candidates,
      'Hotel California',
      'Eagles',
      390000,
      'USPR37604111',
    )
    assert.ok(match !== null)
    assert.equal(match.track.id, 'track-studio')
    assert.equal(match.confidence, 1.0)
    assert.equal(match.score, 250)
    assert.equal(match.matchReason, 'ISRC exact match')
  })

  it('selects studio version over live version when studio is requested', () => {
    const match = selectBestMatch(
      candidates,
      'Hotel California',
      'Eagles',
      390000,
    )
    assert.ok(match !== null)
    assert.equal(match.track.id, 'track-studio')
    assert.ok(match.confidence >= 0.8)
  })

  it('matches live version when requested specifically with live qualifier', () => {
    const match = selectBestMatch(
      candidates,
      'Hotel California (Live)',
      'Eagles',
      432000,
    )
    assert.ok(match !== null)
    assert.equal(match.track.id, 'track-live')
  })

  it('rejects candidate with mismatched artist to prevent false positives', () => {
    const match = selectBestMatch(
      [candidates[3]], // Cover band
      'Hotel California',
      'Eagles',
      390000,
    )
    assert.equal(match, null)
  })

  it('returns null when no candidate satisfies confidence threshold', () => {
    const match = selectBestMatch(
      candidates,
      'Completely Different Song',
      'Different Artist',
      180000,
    )
    assert.equal(match, null)
  })
})
