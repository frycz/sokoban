import { getNextPosition } from './rules'
import type { LevelState, PlayerMoveDirection } from './types'

/**
 * The whole game. Pure: same inputs, same output, no side effects.
 * An illegal move returns the *same* state object, so the host can detect
 * "nothing happened" with ===.
 *
 * Because the signature is (LevelState, PlayerMoveDirection) => LevelState,
 * replaying a solution is just playerMoveDirections.reduce(step, initial).
 */
export function step(
  levelState: LevelState,
  playerMoveDirection: PlayerMoveDirection
): LevelState {
  const { level, playerCurrentPosition, boxPositions } = levelState

  const playerNextPosition = getNextPosition(level, playerCurrentPosition, playerMoveDirection)
  if (playerNextPosition < 0 || level.wallMap[playerNextPosition]) return levelState

  if (!boxPositions.has(playerNextPosition)) {
    return { level, playerCurrentPosition: playerNextPosition, boxPositions }
  }

  // Pushing: the cell beyond the box has to be free of both walls and boxes.
  const beyond = getNextPosition(level, playerNextPosition, playerMoveDirection)
  if (beyond < 0 || level.wallMap[beyond] || boxPositions.has(beyond)) return levelState

  const movedBoxPositions = new Set(boxPositions)
  movedBoxPositions.delete(playerNextPosition)
  movedBoxPositions.add(beyond)
  return { level, playerCurrentPosition: playerNextPosition, boxPositions: movedBoxPositions }
}
