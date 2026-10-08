import { describe, expect, it } from 'vitest'
import { parseStringToLevelState } from './level'
import { toXsb, xsb } from './test-helpers'

describe('parseStringToLevelState', () => {
  it('reads every XSB character', () => {
    const text = xsb('#######', '#@$ . #', '#  *  #', '#######')

    expect(toXsb(parseStringToLevelState(text))).toBe(text)
  })

  it('places the fields directly, not only via the round trip', () => {
    const levelState = parseStringToLevelState(xsb('#####', '#@$.#', '#####'))

    expect(levelState.level.width).toBe(5)
    expect(levelState.level.height).toBe(3)
    expect(levelState.playerCurrentPosition).toBe(6)
    expect([...levelState.boxPositions]).toEqual([7])
    expect([...levelState.level.goalPositions]).toEqual([8])
  })

  it('treats * as both a box and a goal', () => {
    const levelState = parseStringToLevelState(xsb('#####', '#@* #', '#####'))

    expect([...levelState.boxPositions]).toEqual([7])
    expect([...levelState.level.goalPositions]).toEqual([7])
  })

  it('treats + as both the player and a goal', () => {
    const text = xsb('######', '#+$$.#', '######')
    const levelState = parseStringToLevelState(text)

    expect(levelState.playerCurrentPosition).toBe(7)
    expect(levelState.level.goalPositions.has(7)).toBe(true)
    expect(toXsb(levelState)).toBe(text)
  })

  it('accepts - and _ as floor', () => {
    const levelState = parseStringToLevelState(
      xsb('######', '#@-$.#', '######'),
    )

    expect(toXsb(levelState)).toBe(xsb('######', '#@ $.#', '######'))
  })

  it('pads short lines to the width of the longest one', () => {
    const levelState = parseStringToLevelState(
      xsb('###', '# #####', '#@$  .#', '#######'),
    )

    expect(levelState.level.width).toBe(7)
    expect(levelState.level.height).toBe(4)
    expect(toXsb(levelState)).toBe(
      xsb('#######', '# #####', '#@$  .#', '#######'),
    )
  })

  it('walls off space the player cannot reach', () => {
    const levelState = parseStringToLevelState(
      xsb('  ####', '  #@.#', '###$ #', '#    #', '######'),
    )

    expect(toXsb(levelState)).toBe(
      xsb('######', '###@.#', '###$ #', '#    #', '######'),
    )
  })

  it('normalises CRLF and CR line endings', () => {
    const expected = parseStringToLevelState(xsb('#####', '#@$.#', '#####'))

    for (const lineEnding of ['\r\n', '\r']) {
      const levelState = parseStringToLevelState(
        ['#####', '#@$.#', '#####'].join(lineEnding),
      )

      expect(toXsb(levelState)).toBe(toXsb(expected))
      expect(levelState.level.height).toBe(3)
    }
  })

  it('trims blank and whitespace-only edge lines', () => {
    const levelState = parseStringToLevelState(
      xsb('', '   ', '#####', '#@$.#', '#####', '  ', ''),
    )

    expect(levelState.level.height).toBe(3)
    expect(toXsb(levelState)).toBe(xsb('#####', '#@$.#', '#####'))
  })

  it('keeps blank lines inside the level as rows', () => {
    const levelState = parseStringToLevelState(
      xsb('#####', '#@$.#', '#####', '', '#####'),
    )

    expect(levelState.level.height).toBe(5)
    expect(toXsb(levelState)).toBe(
      xsb('#####', '#@$.#', '#####', '#####', '#####'),
    )
  })

  describe('rejects', () => {
    it('empty text', () => {
      expect(() => parseStringToLevelState('')).toThrow('Level is empty')
      expect(() => parseStringToLevelState('\n  \n')).toThrow('Level is empty')
    })

    it('a level with no player', () => {
      expect(() =>
        parseStringToLevelState(xsb('#####', '#$ .#', '#####')),
      ).toThrow('Level has no player (@ or +)')
    })

    it('a level with no boxes', () => {
      expect(() =>
        parseStringToLevelState(xsb('#####', '#@ .#', '#####')),
      ).toThrow('Level has no boxes')
    })

    it('a mismatched box and goal count', () => {
      expect(() =>
        parseStringToLevelState(xsb('######', '#@$..#', '######')),
      ).toThrow('Level has 1 boxes but 2 goals')
    })

    it('a box sealed off from the player', () => {
      expect(() =>
        parseStringToLevelState(xsb('#########', '#@ .# $ #', '#########')),
      ).toThrow('Box at (6, 1) is outside the walls')
    })

    it('a goal sealed off from the player', () => {
      expect(() =>
        parseStringToLevelState(xsb('#########', '#@$ # . #', '#########')),
      ).toThrow('Goal at (6, 1) is outside the walls')
    })

    it('an unknown character, reported 1-based', () => {
      expect(() =>
        parseStringToLevelState(xsb('#####', '#@$x#', '#####')),
      ).toThrow('Unexpected character "x" at line 2, column 4')
    })
  })
})
