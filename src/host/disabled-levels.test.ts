import { describe, expect, it } from 'vitest'
import { applyDisabledLevels, parseDisabledLevels } from './disabled-levels'

const levels = ['alpha', 'bravo', 'charlie'].map((slug) => ({ slug }))

describe('parseDisabledLevels', () => {
  it('reads a list of slugs', () => {
    expect(parseDisabledLevels(['bravo'])).toEqual(['bravo'])
    expect(parseDisabledLevels([])).toEqual([])
  })

  it('refuses anything else', () => {
    expect(parseDisabledLevels({ disabled: [] })).toBeNull()
    expect(parseDisabledLevels(['alpha', 3])).toBeNull()
    expect(parseDisabledLevels(undefined)).toBeNull()
  })
})

describe('applyDisabledLevels', () => {
  it('keeps the listed levels', () => {
    const applied = applyDisabledLevels(levels, ['charlie', 'alpha'])

    expect(applied.disabled).toEqual(['charlie', 'alpha'])
    expect(applied.problems).toEqual([])
  })

  it('drops and reports a slug with no level', () => {
    const applied = applyDisabledLevels(levels, ['delta', 'bravo'])

    expect(applied.disabled).toEqual(['bravo'])
    expect(applied.problems).toHaveLength(1)
    expect(applied.problems[0]).toContain('delta')
  })

  it('counts a slug listed twice once', () => {
    expect(applyDisabledLevels(levels, ['bravo', 'bravo']).disabled).toEqual([
      'bravo',
    ])
  })

  it('disables none rather than every level', () => {
    const applied = applyDisabledLevels(levels, ['alpha', 'bravo', 'charlie'])

    expect(applied.disabled).toEqual([])
    expect(applied.problems).toHaveLength(1)
  })
})
