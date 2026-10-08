import { neighbour } from './rules'
import type { PlayerMoveDirection, State } from './types'

/**
 * The whole game. Pure: same inputs, same output, no side effects.
 * An illegal move returns the *same* state object, so the host can detect
 * "nothing happened" with ===.
 *
 * Because the signature is (State, PlayerMoveDirection) => State, replaying
 * a solution is just playerMoveDirections.reduce(step, initial).
 */
export function step(state: State, playerMoveDirection: PlayerMoveDirection): State {
  const { level, player, boxes } = state

  const destination = neighbour(level, player, playerMoveDirection)
  if (destination < 0 || level.walls[destination]) return state

  if (!boxes.has(destination)) {
    return { level, player: destination, boxes }
  }

  // Pushing: the cell beyond the box has to be free of both walls and boxes.
  const beyond = neighbour(level, destination, playerMoveDirection)
  if (beyond < 0 || level.walls[beyond] || boxes.has(beyond)) return state

  const moved = new Set(boxes)
  moved.delete(destination)
  moved.add(beyond)
  return { level, player: destination, boxes: moved }
}
