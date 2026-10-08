import { beforeEach, describe, expect, it } from 'vitest'
import { parseStringToLevelState } from '../core/level'
import { toXsb, xsb } from '../core/test-helpers'
import type { LevelState } from '../core/types'
import { createHistory } from './history'

const LEVEL = xsb('#######', '#@ $ .#', '#######')

const move = (playerMoveDirection: 'left' | 'right') =>
  ({ type: 'move', playerMoveDirection }) as const

describe('createHistory', () => {
  let initial: LevelState

  beforeEach(() => {
    initial = parseStringToLevelState(LEVEL)
  })

  it('starts on the initial state with no moves', () => {
    const history = createHistory(initial)

    expect(history.current()).toBe(initial)
    expect(history.moveCount()).toBe(0)
  })

  it('records a legal move', () => {
    const history = createHistory(initial)

    expect(history.run(move('right'))).toBe(true)
    expect(history.moveCount()).toBe(1)
    expect(toXsb(history.current())).toBe(xsb('#######', '# @$ .#', '#######'))
  })

  it('does not record a rejected move', () => {
    const history = createHistory(initial)

    expect(history.run(move('left'))).toBe(false)
    expect(history.moveCount()).toBe(0)
    expect(history.current()).toBe(initial)
  })

  it('undoes the last move', () => {
    const history = createHistory(initial)
    history.run(move('right'))
    history.run(move('right'))

    expect(history.run({ type: 'undo' })).toBe(true)
    expect(history.moveCount()).toBe(1)
    expect(toXsb(history.current())).toBe(xsb('#######', '# @$ .#', '#######'))
  })

  it('undoes a push, putting the box back', () => {
    const history = createHistory(initial)
    history.run(move('right'))
    history.run(move('right'))
    history.run(move('right'))

    expect(toXsb(history.current())).toBe(xsb('#######', '#   @*#', '#######'))

    history.run({ type: 'undo' })

    expect(toXsb(history.current())).toBe(xsb('#######', '#  @$.#', '#######'))
  })

  it('refuses to undo past the start', () => {
    const history = createHistory(initial)

    expect(history.run({ type: 'undo' })).toBe(false)
    expect(history.current()).toBe(initial)
    expect(history.moveCount()).toBe(0)
  })

  it('resets to the initial state', () => {
    const history = createHistory(initial)
    history.run(move('right'))
    history.run(move('right'))

    expect(history.run({ type: 'reset' })).toBe(true)
    expect(history.current()).toBe(initial)
    expect(history.moveCount()).toBe(0)
  })

  it('reports nothing to reset at the start', () => {
    const history = createHistory(initial)

    expect(history.run({ type: 'reset' })).toBe(false)
  })

  it('replays forward again after a reset', () => {
    const history = createHistory(initial)
    history.run(move('right'))
    history.run({ type: 'reset' })

    expect(history.run(move('right'))).toBe(true)
    expect(history.moveCount()).toBe(1)
    expect(toXsb(history.current())).toBe(xsb('#######', '# @$ .#', '#######'))
  })

  it('leaves the initial state untouched throughout', () => {
    const history = createHistory(initial)
    history.run(move('right'))
    history.run(move('right'))
    history.run(move('right'))
    history.run({ type: 'reset' })

    expect(toXsb(initial)).toBe(LEVEL)
  })
})
