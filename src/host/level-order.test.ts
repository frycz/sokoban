import { describe, expect, it } from 'vitest'
import { applyLevelOrder, parseLevelOrder } from './level-order'

const levels = ['alpha', 'bravo', 'charlie'].map((slug) => ({ slug }))
const slugsOf = (ordered: readonly { slug: string }[]) =>
  ordered.map((level) => level.slug)

describe('parseLevelOrder', () => {
  it('reads a list of slugs', () => {
    expect(parseLevelOrder(['bravo', 'alpha'])).toEqual(['bravo', 'alpha'])
  })

  it('refuses anything else', () => {
    expect(parseLevelOrder({ order: [] })).toBeNull()
    expect(parseLevelOrder(['alpha', 3])).toBeNull()
    expect(parseLevelOrder(undefined)).toBeNull()
  })
})

describe('applyLevelOrder', () => {
  it('puts the levels in the listed order', () => {
    const ordered = applyLevelOrder(levels, ['charlie', 'alpha', 'bravo'])

    expect(slugsOf(ordered.levels)).toEqual(['charlie', 'alpha', 'bravo'])
    expect(ordered.problems).toEqual([])
  })

  it('appends unlisted levels in the order they came in', () => {
    const ordered = applyLevelOrder(levels, ['charlie'])

    expect(slugsOf(ordered.levels)).toEqual(['charlie', 'alpha', 'bravo'])
  })

  it('skips and reports a slug with no level', () => {
    const ordered = applyLevelOrder(levels, ['delta', 'bravo'])

    expect(slugsOf(ordered.levels)).toEqual(['bravo', 'alpha', 'charlie'])
    expect(ordered.problems).toHaveLength(1)
    expect(ordered.problems[0]).toContain('delta')
  })

  it('counts a slug listed twice once, where it first appears', () => {
    const ordered = applyLevelOrder(levels, ['bravo', 'alpha', 'bravo'])

    expect(slugsOf(ordered.levels)).toEqual(['bravo', 'alpha', 'charlie'])
  })
})
