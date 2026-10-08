import { neighbour } from './rules'
import type { Direction, State } from './types'

/**
 * The whole game. Pure: same inputs, same output, no side effects.
 * An illegal move returns the *same* state object, so the host can detect
 * "nothing happened" with ===.
 *
 * Because the signature is (State, Direction) => State, replaying a solution
 * is just directions.reduce(step, initial).
 */
export function step(state: State, direction: Direction): State {
  const { level, player, boxes } = state

  const destination = neighbour(level, player, direction)
  if (destination < 0 || level.walls[destination]) return state

  if (!boxes.has(destination)) {
    return { level, player: destination, boxes }
  }

  // Pushing: the cell beyond the box has to be free of both walls and boxes.
  const beyond = neighbour(level, destination, direction)
  if (beyond < 0 || level.walls[beyond] || boxes.has(beyond)) return state

  const moved = new Set(boxes)
  moved.delete(destination)
  moved.add(beyond)
  return { level, player: destination, boxes: moved }
}
