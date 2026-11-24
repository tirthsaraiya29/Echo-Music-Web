import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateCrossfadeCurves } from '../src/engine/DeckController.ts'
import { crossfadeProfileSchema, userPreferencesSchema } from '../src/services/settings/settingsTypes.ts'

describe('Equal-Power Crossfade Profiles [FEATURE-013]', () => {
  it('userPreferencesSchema: defaults crossfadeProfile to equalPower and validates valid values', () => {
    const defaultParsed = userPreferencesSchema.parse({})
    assert.equal(defaultParsed.crossfadeProfile, 'equalPower')

    const linearParsed = userPreferencesSchema.parse({ crossfadeProfile: 'linear' })
    assert.equal(linearParsed.crossfadeProfile, 'linear')

    const logParsed = userPreferencesSchema.parse({ crossfadeProfile: 'logarithmic' })
    assert.equal(logParsed.crossfadeProfile, 'logarithmic')

    const scurveParsed = userPreferencesSchema.parse({ crossfadeProfile: 'scurve' })
    assert.equal(scurveParsed.crossfadeProfile, 'scurve')

    assert.throws(() => {
      crossfadeProfileSchema.parse('invalid_profile')
    })
  })

  it('generateCrossfadeCurves: equalPower satisfies constant acoustic power invariant (cos^2 + sin^2 = 1)', () => {
    const steps = 32
    const { fadeOutCurve, fadeInCurve } = generateCrossfadeCurves('equalPower', steps)

    assert.equal(fadeOutCurve.length, steps)
    assert.equal(fadeInCurve.length, steps)

    // Boundaries
    assert.equal(fadeOutCurve[0], 1.0)
    assert.equal(fadeOutCurve[steps - 1], 0.0)
    assert.equal(fadeInCurve[0], 0.0)
    assert.equal(fadeInCurve[steps - 1], 1.0)

    for (let i = 0; i < steps; i++) {
      const outVal = fadeOutCurve[i]!
      const inVal = fadeInCurve[i]!
      const powerSum = outVal * outVal + inVal * inVal
      assert.ok(
        Math.abs(powerSum - 1.0) < 1e-5,
        `Equal power invariant violated at step ${i}: powerSum = ${powerSum}`,
      )
    }
  })

  it('generateCrossfadeCurves: linear satisfies constant amplitude sum invariant (fadeOut + fadeIn = 1)', () => {
    const steps = 40
    const { fadeOutCurve, fadeInCurve } = generateCrossfadeCurves('linear', steps)

    assert.equal(fadeOutCurve.length, steps)
    assert.equal(fadeInCurve.length, steps)

    // Boundaries
    assert.equal(fadeOutCurve[0], 1.0)
    assert.equal(fadeOutCurve[steps - 1], 0.0)
    assert.equal(fadeInCurve[0], 0.0)
    assert.equal(fadeInCurve[steps - 1], 1.0)

    for (let i = 0; i < steps; i++) {
      const outVal = fadeOutCurve[i]!
      const inVal = fadeInCurve[i]!
      const linearSum = outVal + inVal
      assert.ok(
        Math.abs(linearSum - 1.0) < 1e-5,
        `Linear invariant violated at step ${i}: linearSum = ${linearSum}`,
      )
    }
  })

  it('generateCrossfadeCurves: scurve produces symmetric smoothstep transition with 0.5 midpoint', () => {
    const steps = 33 // odd steps guarantees exact center point at index 16
    const { fadeOutCurve, fadeInCurve } = generateCrossfadeCurves('scurve', steps)

    assert.equal(fadeOutCurve.length, steps)
    assert.equal(fadeInCurve.length, steps)

    const midIndex = Math.floor(steps / 2)
    assert.ok(Math.abs(fadeOutCurve[midIndex]! - 0.5) < 1e-5)
    assert.ok(Math.abs(fadeInCurve[midIndex]! - 0.5) < 1e-5)

    // Monotonicity check
    for (let i = 1; i < steps; i++) {
      assert.ok(fadeOutCurve[i]! <= fadeOutCurve[i - 1]!)
      assert.ok(fadeInCurve[i]! >= fadeInCurve[i - 1]!)
    }
  })

  it('generateCrossfadeCurves: logarithmic produces monotonic exponential transition', () => {
    const steps = 25
    const { fadeOutCurve, fadeInCurve } = generateCrossfadeCurves('logarithmic', steps)

    assert.equal(fadeOutCurve.length, steps)
    assert.equal(fadeInCurve.length, steps)

    assert.equal(fadeOutCurve[0], 1.0)
    assert.equal(fadeOutCurve[steps - 1], 0.0)
    assert.equal(fadeInCurve[0], 0.0)
    assert.equal(fadeInCurve[steps - 1], 1.0)

    for (let i = 1; i < steps; i++) {
      assert.ok(fadeOutCurve[i]! <= fadeOutCurve[i - 1]!)
      assert.ok(fadeInCurve[i]! >= fadeInCurve[i - 1]!)
    }
  })

  it('generateCrossfadeCurves: clamps steps safely to [2, 256]', () => {
    const tooSmall = generateCrossfadeCurves('equalPower', 1)
    assert.equal(tooSmall.fadeOutCurve.length, 2)

    const tooLarge = generateCrossfadeCurves('equalPower', 1000)
    assert.equal(tooLarge.fadeOutCurve.length, 256)
  })
})
