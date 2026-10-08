import { step } from '../core/step'
import type { LevelState, PlayerMoveDirection } from '../core/types'

export type Command =
  | { type: 'move'; playerMoveDirection: PlayerMoveDirection }
  | { type: 'undo' }
  | { type: 'reset' }

export type History = {
  current: () => LevelState
  moveCount: () => number
  /** Runs the command, returning whether it changed anything. */
  run: (command: Command) => boolean
}

export function createHistory(initial: LevelState): History {
  const states: LevelState[] = [initial]
  const current = () => states[states.length - 1]

  function run(command: Command): boolean {
    switch (command.type) {
      case 'move': {
        const next = step(current(), command.playerMoveDirection)

        // `step` returns the same object for an illegal move, so identity is
        // the test for "nothing happened" and nothing is recorded.
        if (next === current()) {
          return false
        }

        states.push(next)

        return true
      }
      case 'undo': {
        if (states.length === 1) {
          return false
        }

        states.pop()

        return true
      }
      case 'reset': {
        if (states.length === 1) {
          return false
        }

        states.length = 1

        return true
      }
    }
  }

  return { current, moveCount: () => states.length - 1, run }
}
