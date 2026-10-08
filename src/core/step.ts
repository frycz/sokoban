import { getNextPosition, isPositionBox, isPositionFree, updateBoxPosition } from './rules'
import type { LevelState, PlayerMoveDirection } from './types'

export function step(levelState: LevelState, playerMoveDirection: PlayerMoveDirection): LevelState {
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
