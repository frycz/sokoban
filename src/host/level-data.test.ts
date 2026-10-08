import { describe, expect, it } from 'vitest'
import { parseStringToLevelState } from '../core/level'
import { isSolved } from '../core/rules'
import { play } from '../core/test-helpers'
import { LEVEL } from './level-data'

/**
 * A 97-push solution to the shipped level, in standard LURD notation. Replaying
 * it exercises the parser, every direction and both move and push paths against
 * a real board, which no hand-written three-row fixture does.
 */
const SOLUTION =
  'ullluuuLUllDDulldddrRRRRuuulullddDuuurrdLulDDulldddrRlluuurruruulDrddl' +
  'lldddrrRllluuurrruuurDlddrrdddRluuulluurDldllldddrrddrrrruuluuuLrdddrd' +
  'dlllluurRllddrrrruuRRRRRRRlllllllddlllluurrRRlllllluuurrdDuulldddrRRRl' +
  'lddrrrruuRRRRRRllllllddlllluurrRRluuuluullDDDDuuurrdLulDDulldddrRllull' +
  'dRRuuurrrrrdddrddlllluuRRllddrrrruuRRRRRdrUluRdllllllddlllluurrRuuulll' +
  'lldddRRRllluuurrrrrdddRddlllluurRllddrrrruuRRRRRurDldRullllllddlllluur' +
  'rRuuullldDuulldddrRRluuurrrdddRddlllluurRllddrrrruuRRRRRurRllddrUluRdl' +
  'lllllddlllluurrRRRRRRRdrRlluurDldR'

describe('the shipped level', () => {
  const initial = parseStringToLevelState(LEVEL)

  it('parses', () => {
    expect(initial.level.width).toBe(19)
    expect(initial.level.height).toBe(11)
    expect(initial.boxPositions.size).toBe(6)
    expect(initial.level.goalPositions.size).toBe(6)
  })

  it('does not start solved', () => {
    expect(isSolved(initial)).toBe(false)
  })

  it('is solved by replaying the solution', () => {
    expect(isSolved(play(initial, SOLUTION))).toBe(true)
  })

  it('is not solved one move short of the end', () => {
    expect(isSolved(play(initial, SOLUTION.slice(0, -1)))).toBe(false)
  })

  it('never makes an illegal move along the way', () => {
    let state = initial

    for (const character of SOLUTION) {
      const next = play(state, character)

      expect(next).not.toBe(state)
      state = next
    }
  })
})
