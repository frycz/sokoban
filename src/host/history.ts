import { step } from '../core/step'
import type { LevelState, PlayerMoveDirection } from '../core/types'

export type Command =
  | { type: 'move'; playerMoveDirection: PlayerMoveDirection }
  | { type: 'undo' }
  | { type: 'reset' }

export type History = {
  current: () => LevelState
  moveCount: () => number
  pushCount: () => number
  /**
   * The moves that lead from the initial state to the current one, in standard
   * LURD notation — uppercase for a push. What a save stores, and what
   * `restoreHistory` reads back.
   */
  lurd: () => string
  /** Runs the command, returning whether it changed anything. */
  run: (command: Command) => boolean
}

const LURD_CHARACTER_OF_DIRECTION: Record<PlayerMoveDirection, string> = {
  up: 'u',
  down: 'd',
  left: 'l',
  right: 'r',
}

const DIRECTION_OF_LURD_CHARACTER: Record<
  string,
  PlayerMoveDirection | undefined
> = {
  u: 'up',
  d: 'down',
  l: 'left',
  r: 'right',
}

export function createHistory(initial: LevelState): History {
  const states: LevelState[] = [initial]
  // One character per entry after the first, so `moves[i]` is how
  // `states[i + 1]` was reached and the two stacks always pop together.
  const moves: string[] = []
  const current = () => states[states.length - 1]

  function run(command: Command): boolean {
    switch (command.type) {
      case 'move': {
        const previous = current()
        const next = step(previous, command.playerMoveDirection)

        // `step` returns the same object for an illegal move, so identity is
        // the test for "nothing happened" and nothing is recorded.
        if (next === previous) {
          return false
        }

        const character =
          LURD_CHARACTER_OF_DIRECTION[command.playerMoveDirection]

        states.push(next)
        // `step` hands the box set through untouched unless a box moved, so
        // identity is the push test too.
        moves.push(
          next.boxPositions === previous.boxPositions
            ? character
            : character.toUpperCase(),
        )

        return true
      }
      case 'undo': {
        if (states.length === 1) {
          return false
        }

        states.pop()
        moves.pop()

        return true
      }
      case 'reset': {
        if (states.length === 1) {
          return false
        }

        states.length = 1
        moves.length = 0

        return true
      }
    }
  }

  return {
    current,
    moveCount: () => moves.length,
    pushCount: () => moves.filter((move) => move !== move.toLowerCase()).length,
    lurd: () => moves.join(''),
    run,
  }
}

/**
 * A history replayed from a saved LURD string, or null when the string does
 * not replay — a character that is not a move, or a move the level refuses.
 * Either means the level changed under the save, and a half-applied path would
 * be a position the player never reached.
 */
export function restoreHistory(
  initial: LevelState,
  lurd: string,
): History | null {
  const history = createHistory(initial)

  for (const character of lurd) {
    const playerMoveDirection =
      DIRECTION_OF_LURD_CHARACTER[character.toLowerCase()]

    if (
      !playerMoveDirection ||
      !history.run({ type: 'move', playerMoveDirection })
    ) {
      return null
    }
  }

  return history
}
