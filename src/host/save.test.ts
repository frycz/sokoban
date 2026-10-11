import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  parseSave,
  resolveResume,
  serializeSave,
  type Save,
} from './save'

const SAVE: Save = {
  current: { slug: 'bravo', lurd: 'rRu', timeMs: 4200 },
  completed: [
    { slug: 'alpha', name: 'Alpha', moves: 12, pushes: 3, timeMs: 30000 },
  ],
}

describe('parseSave', () => {
  it('reads back what it wrote', () => {
    expect(parseSave(JSON.parse(serializeSave(SAVE)))).toEqual(SAVE)
  })

  it('reads a finished campaign', () => {
    const finished: Save = { current: null, completed: SAVE.completed }

    expect(parseSave(JSON.parse(serializeSave(finished)))).toEqual(finished)
  })

  it('refuses another version', () => {
    expect(parseSave({ ...SAVE, version: 2 })).toBeNull()
  })

  it('refuses a malformed save', () => {
    expect(parseSave(null)).toBeNull()
    expect(parseSave({ version: 1, current: null })).toBeNull()
    expect(
      parseSave({ version: 1, current: { slug: 'a' }, completed: [] }),
    ).toBeNull()
    expect(
      parseSave({
        version: 1,
        current: null,
        completed: [{ slug: 'a', name: 'A', moves: -1, pushes: 0, timeMs: 0 }],
      }),
    ).toBeNull()
  })
})

describe('resolveResume', () => {
  it('resumes the saved level where it was left', () => {
    expect(resolveResume(SAVE, ['alpha', 'bravo', 'charlie'])).toEqual({
      index: 1,
      lurd: 'rRu',
      timeMs: 4200,
    })
  })

  it('follows the level when the order changed', () => {
    expect(resolveResume(SAVE, ['bravo', 'charlie', 'alpha'])?.index).toBe(0)
  })

  it('falls back to the first unsolved level, from the start', () => {
    expect(resolveResume(SAVE, ['alpha', 'charlie'])).toEqual({
      index: 1,
      lurd: '',
      timeMs: 0,
    })
  })

  it('has nothing to continue once the campaign is over', () => {
    expect(
      resolveResume({ current: null, completed: SAVE.completed }, ['alpha']),
    ).toBeNull()
  })

  it('has nothing to continue when every level is solved', () => {
    expect(resolveResume(SAVE, ['alpha'])).toBeNull()
  })
})

describe('formatDuration', () => {
  it('shows minutes and seconds', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65_900)).toBe('1:05')
  })

  it('shows hours past the hour', () => {
    expect(formatDuration(3_725_000)).toBe('1:02:05')
  })
})
