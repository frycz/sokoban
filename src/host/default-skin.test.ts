import { describe, expect, it } from 'vitest'
import type { Skin } from '../render/skin'
import { applyDefaultSkin, parseDefaultSkin } from './default-skin'

const quarrySkin = { isPixelated: true } as Skin
const moonSkin = { isPixelated: false } as Skin

const levels = [
  { slug: 'quarry', ownSkin: quarrySkin, ownGroundColor: '#1a2b3c' },
  { slug: 'moon', ownSkin: moonSkin, ownGroundColor: null },
  { slug: 'plain', ownSkin: null, ownGroundColor: null },
  { slug: 'grounded', ownSkin: null, ownGroundColor: '#ffffff' },
].map((level) => ({
  ...level,
  skin: level.ownSkin,
  groundColor: level.ownGroundColor,
}))

const drawnWith = (skinned: readonly (typeof levels)[number][]) =>
  skinned.map(({ slug, skin, groundColor }) => ({ slug, skin, groundColor }))

describe('parseDefaultSkin', () => {
  it('reads a slug or null', () => {
    expect(parseDefaultSkin({ from: 'quarry' })).toBe('quarry')
    expect(parseDefaultSkin({ from: null })).toBeNull()
  })

  it('refuses anything else', () => {
    expect(parseDefaultSkin('quarry')).toBeUndefined()
    expect(parseDefaultSkin({})).toBeUndefined()
    expect(parseDefaultSkin({ from: 3 })).toBeUndefined()
    expect(parseDefaultSkin(undefined)).toBeUndefined()
  })
})

describe('applyDefaultSkin', () => {
  it('lends the skin and its ground to levels that have neither', () => {
    const skinned = applyDefaultSkin(levels, 'quarry')

    expect(drawnWith(skinned.levels)).toEqual([
      { slug: 'quarry', skin: quarrySkin, groundColor: '#1a2b3c' },
      { slug: 'moon', skin: moonSkin, groundColor: null },
      { slug: 'plain', skin: quarrySkin, groundColor: '#1a2b3c' },
      { slug: 'grounded', skin: quarrySkin, groundColor: '#ffffff' },
    ])
    expect(skinned.problems).toEqual([])
  })

  it('lends no ground when the lender names none', () => {
    const skinned = applyDefaultSkin(levels, 'moon')

    expect(drawnWith(skinned.levels).slice(2)).toEqual([
      { slug: 'plain', skin: moonSkin, groundColor: null },
      { slug: 'grounded', skin: moonSkin, groundColor: '#ffffff' },
    ])
  })

  it('choosing again replaces the last choice rather than stacking on it', () => {
    const once = applyDefaultSkin(levels, 'quarry').levels
    const twice = applyDefaultSkin(once, 'moon').levels

    expect(drawnWith(twice)).toEqual(
      drawnWith(applyDefaultSkin(levels, 'moon').levels),
    )
    expect(drawnWith(applyDefaultSkin(once, null).levels)).toEqual(
      drawnWith(levels),
    )
  })

  it('reports a slug with no skin to lend and lends nothing', () => {
    for (const from of ['plain', 'gone']) {
      const skinned = applyDefaultSkin(levels, from)

      expect(drawnWith(skinned.levels)).toEqual(drawnWith(levels))
      expect(skinned.problems).toHaveLength(1)
    }
  })
})
