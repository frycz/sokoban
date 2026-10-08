import { getNextPosition, isPositionBox, isPositionFree, updateBoxPosition } from './rules'
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

  if (isPositionFree(levelState, playerNextPosition)) {
    return { level, playerCurrentPosition: playerNextPosition, boxPositions }
  }

  if (!isPositionBox(levelState, playerNextPosition)) {
    return levelState
  }

  const boxCurrentPosition = playerNextPosition
  const behindTheBoxPosition = getNextPosition(level, playerNextPosition, playerMoveDirection)
  if (!isPositionFree(levelState, behindTheBoxPosition)) return levelState

  return {
    level,
    playerCurrentPosition: playerNextPosition,
    boxPositions: updateBoxPosition(boxPositions, boxCurrentPosition, behindTheBoxPosition),
  }
}
