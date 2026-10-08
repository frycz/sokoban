import { describe, expect, it } from 'vitest'
import { parseStringToLevelState } from './level'
import { isSolved } from './rules'
import { step } from './step'
import { openLevelState, toXsb, xsb } from './test-helpers'

describe('step', () => {
  it('walks into free floor', () => {
    const levelState = parseStringToLevelState(
      xsb('######', '#@ $.#', '######'),
    )

    expect(toXsb(step(levelState, 'right'))).toBe(
      xsb('######', '# @$.#', '######'),
    )
  })

  it('pushes a box onto a goal', () => {
    const levelState = parseStringToLevelState(
      xsb('######', '# @$.#', '######'),
    )

    expect(toXsb(step(levelState, 'right'))).toBe(
      xsb('######', '#  @*#', '######'),
    )
  })

  it('pushes a box off a goal', () => {
    const levelState = parseStringToLevelState(
      xsb('######', '#@* ##', '######'),
    )

    expect(isSolved(levelState)).toBe(true)

    const moved = step(levelState, 'right')

    // The player ends up standing on the goal the box just left, hence `+`.
    expect(toXsb(moved)).toBe(xsb('######', '# +$##', '######'))
    expect(isSolved(moved)).toBe(false)
  })

  it.each([
    { playerMoveDirection: 'up', expected: 8 },
    { playerMoveDirection: 'down', expected: 20 },
    { playerMoveDirection: 'left', expected: 13 },
    { playerMoveDirection: 'right', expected: 15 },
  ] as const)(
    'moves the player $playerMoveDirection',
    ({ playerMoveDirection, expected }) => {
      // Player at (2, 2) of a 6-wide grid, with open floor on every side.
      const levelState = parseStringToLevelState(
        xsb('######', '#    #', '# @  #', '#    #', '#$  .#', '######'),
      )

      expect(levelState.playerCurrentPosition).toBe(14)
      expect(step(levelState, playerMoveDirection).playerCurrentPosition).toBe(
        expected,
      )
    },
  )

  describe('rejects the move and returns the same state', () => {
    const unchanged = (text: string, direction: 'up' | 'left' | 'right') => {
      const levelState = parseStringToLevelState(text)

      expect(step(levelState, direction)).toBe(levelState)
    }

    it('walking into a wall', () => {
      unchanged(xsb('######', '#@ $.#', '######'), 'left')
      unchanged(xsb('######', '#@ $.#', '######'), 'up')
    })

    it('pushing a box against a wall', () => {
      unchanged(xsb('######', '#.@$##', '######'), 'right')
    })

    it('pushing a box against another box', () => {
      unchanged(xsb('########', '#.@$$ .#', '########'), 'right')
    })
  })

  it('does not mutate the state it is given', () => {
    const levelState = parseStringToLevelState(
      xsb('######', '# @$.#', '######'),
    )
    const boxPositionsBefore = levelState.boxPositions
    const snapshot = [...boxPositionsBefore]

    step(levelState, 'right')

    expect(levelState.boxPositions).toBe(boxPositionsBefore)
    expect([...levelState.boxPositions]).toEqual(snapshot)
    expect(toXsb(levelState)).toBe(xsb('######', '# @$.#', '######'))
  })

  it('shares the level between states instead of copying it', () => {
    const levelState = parseStringToLevelState(
      xsb('######', '#@ $.#', '######'),
    )

    expect(step(levelState, 'right').level).toBe(levelState.level)
  })

  it('does not wrap around a row edge', () => {
    // Position 3 is (0, 1); naive index arithmetic would put `left` at
    // position 2, which is (2, 0) — the far end of the row above.
    const levelState = openLevelState(3, 2, 3)

    expect(step(levelState, 'left')).toBe(levelState)
    expect(step(levelState, 'right').playerCurrentPosition).toBe(4)
  })

  it('does not push a box through a row edge', () => {
    // Player (1, 1) pushing left moves the box to (0, 1); pushing again must
    // be rejected rather than teleporting it to (2, 0).
    const levelState = openLevelState(3, 2, 4, [3])

    expect(step(levelState, 'left')).toBe(levelState)
  })
})
