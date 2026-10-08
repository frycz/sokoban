import { describe, expect, it } from 'vitest'
import {
  getNextPosition,
  getPositionFromCoordinates,
  getPositionX,
  getPositionY,
  isPositionBox,
  isPositionFree,
  isSolved,
  updateBoxPosition,
} from './rules'
import { openLevelState } from './test-helpers'

describe('position arithmetic', () => {
  const { level } = openLevelState(7, 5, 0)

  it('round-trips coordinates through a flat index', () => {
    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
        const position = getPositionFromCoordinates(x, y, level.width)

        expect(getPositionX(level, position)).toBe(x)
        expect(getPositionY(level, position)).toBe(y)
      }
    }
  })
})

describe('getNextPosition', () => {
  const { level } = openLevelState(3, 3, 0)

  it('steps within the grid', () => {
    expect(getNextPosition(level, 4, 'up')).toBe(1)
    expect(getNextPosition(level, 4, 'down')).toBe(7)
    expect(getNextPosition(level, 4, 'left')).toBe(3)
    expect(getNextPosition(level, 4, 'right')).toBe(5)
  })

  it('returns -1 off each edge', () => {
    expect(getNextPosition(level, 1, 'up')).toBe(-1)
    expect(getNextPosition(level, 7, 'down')).toBe(-1)
    expect(getNextPosition(level, 3, 'left')).toBe(-1)
    expect(getNextPosition(level, 5, 'right')).toBe(-1)
  })
})

describe('isPositionFree', () => {
  const levelState = openLevelState(3, 3, 0, [4])

  it('is false for the off-grid position getNextPosition returns', () => {
    expect(isPositionFree(levelState, -1)).toBe(false)
  })

  it('is false for a position past the end of the grid', () => {
    expect(isPositionFree(levelState, 9)).toBe(false)
  })

  it('is false for a box and for the player', () => {
    expect(isPositionFree(levelState, 4)).toBe(false)
    expect(isPositionFree(levelState, 0)).toBe(false)
  })

  it('is false for a wall', () => {
    const walled = openLevelState(3, 3, 0)
    walled.level.wallMap[5] = true

    expect(isPositionFree(walled, 5)).toBe(false)
  })

  it('is true for empty floor', () => {
    expect(isPositionFree(levelState, 8)).toBe(true)
  })
})

describe('isPositionBox', () => {
  it('reports only the occupied positions', () => {
    const levelState = openLevelState(3, 3, 0, [4, 5])

    expect(isPositionBox(levelState, 4)).toBe(true)
    expect(isPositionBox(levelState, 6)).toBe(false)
  })
})

describe('isSolved', () => {
  it('is true when every box sits on a goal', () => {
    expect(isSolved(openLevelState(3, 3, 0, [4, 5], [4, 5]))).toBe(true)
  })

  it('is false when a box is off its goal', () => {
    expect(isSolved(openLevelState(3, 3, 0, [4, 6], [4, 5]))).toBe(false)
  })

  it('is false when the boxes cover only some of the goals', () => {
    expect(isSolved(openLevelState(3, 3, 0, [4, 7], [4, 5]))).toBe(false)
  })
})

describe('updateBoxPosition', () => {
  it('returns a new set with the box moved', () => {
    const boxPositions = new Set([4, 5])
    const updated = updateBoxPosition(boxPositions, 4, 6)

    expect([...updated].sort((a, b) => a - b)).toEqual([5, 6])
  })

  it('leaves the original set untouched', () => {
    const boxPositions = new Set([4, 5])

    updateBoxPosition(boxPositions, 4, 6)

    expect([...boxPositions]).toEqual([4, 5])
  })

  it('throws when there is no box to move', () => {
    expect(() => updateBoxPosition(new Set([4]), 5, 6)).toThrow(
      'No box to move at position 5',
    )
  })

  it('throws when the destination already holds a box', () => {
    expect(() => updateBoxPosition(new Set([4, 5]), 4, 5)).toThrow(
      'Position 5 already holds a box',
    )
  })
})
