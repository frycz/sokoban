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
  const { level, playerPosition, boxPositions } = state

  const destination = neighbour(level, playerPosition, playerMoveDirection)
  if (destination < 0 || level.wallMap[destination]) return state

  if (!boxPositions.has(destination)) {
    return { level, playerPosition: destination, boxPositions }
  }

  // Pushing: the cell beyond the box has to be free of both walls and boxes.
  const beyond = neighbour(level, destination, playerMoveDirection)
  if (beyond < 0 || level.wallMap[beyond] || boxPositions.has(beyond)) return state

  const movedBoxPositions = new Set(boxPositions)
  movedBoxPositions.delete(destination)
  movedBoxPositions.add(beyond)
  return { level, playerPosition: destination, boxPositions: movedBoxPositions }
}
