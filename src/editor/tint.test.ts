import { describe, expect, it } from 'vitest'
import {
  NO_TINT,
  getTintKey,
  isIdentityTint,
  isSameTint,
  readTint,
  type Tint,
} from './tint'

/**
 * Only the painting half of tinting needs a canvas, and that is `tinted-tiles`
 * — untestable here for the same reason `atlas.ts` is. This is the vocabulary,
 * which is where the decisions actually are.
 */
describe('isIdentityTint', () => {
  it('is only multiply by white, which is the no-op', () => {
    expect(isIdentityTint(NO_TINT)).toBe(true)
    expect(isIdentityTint({ color: '#ffffff', mode: 'multiply' })).toBe(true)
  })

  /**
   * The asymmetry the two modes exist for: a flat white keeps nothing but the
   * tile's shape, so on coloured art it is a repaint rather than nothing.
   */
  it('is not a flat white, which repaints coloured art', () => {
    expect(isIdentityTint({ color: '#ffffff', mode: 'flat' })).toBe(false)
  })

  it('is not any other colour', () => {
    expect(isIdentityTint({ color: '#fffffe', mode: 'multiply' })).toBe(false)
  })
})

describe('getTintKey', () => {
  it('separates two inks that differ only in mode', () => {
    const color = '#55aa33'

    expect(getTintKey({ color, mode: 'multiply' })).not.toBe(
      getTintKey({ color, mode: 'flat' }),
    )
  })

  it('is equal exactly when the tints are', () => {
    const one: Tint = { color: '#55aa33', mode: 'flat' }
    const other: Tint = { color: '#55aa33', mode: 'flat' }

    expect(getTintKey(one)).toBe(getTintKey(other))
    expect(isSameTint(one, other)).toBe(true)
  })
})

describe('readTint', () => {
  it('takes a six-digit hex, case-folded, so the key is one spelling', () => {
    expect(readTint({ color: '#ABC123', mode: 'flat' })).toEqual({
      color: '#abc123',
      mode: 'flat',
    })
  })

  it('falls back to no ink for a colour the canvas would not take', () => {
    // A named colour and a three-digit hex are both valid CSS and neither is
    // what the colour input writes, so neither is accepted: one spelling means
    // two cells cannot disagree about sharing an atlas column.
    expect(readTint({ color: 'rebeccapurple', mode: 'flat' }).color).toBe(
      NO_TINT.color,
    )
    expect(readTint({ color: '#abc', mode: 'flat' }).color).toBe(NO_TINT.color)
    expect(readTint({ color: 42, mode: 'flat' }).color).toBe(NO_TINT.color)
  })

  it('falls back field by field rather than wholesale', () => {
    expect(readTint({ color: '#abc123', mode: 'underneath' })).toEqual({
      color: '#abc123',
      mode: 'multiply',
    })
  })

  it('reads anything that is not a record as no ink', () => {
    expect(readTint(undefined)).toEqual(NO_TINT)
    expect(readTint(null)).toEqual(NO_TINT)
    expect(readTint('#abc123')).toEqual(NO_TINT)
  })
})
