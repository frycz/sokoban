import type { Level, LevelState, PlayerMoveDirection } from './types'

export function getPositionX(level: Level, position: number): number {
  return position % level.width
}

export function getPositionY(level: Level, position: number): number {
  return Math.floor(position / level.width)
}

export function getPositionFromCoordinates(
  positionX: number,
  positionY: number,
  levelWidth: number,
): number {
  return positionY * levelWidth + positionX
}

function areCoordinatesOnLevel(
  level: Level,
  positionX: number,
  positionY: number,
): boolean {
  return (
    positionX >= 0 &&
    positionX < level.width &&
    positionY >= 0 &&
    positionY < level.height
  )
}

function isPositionOnLevel(level: Level, position: number): boolean {
  return position >= 0 && position < level.width * level.height
}

function isPositionWall(level: Level, position: number): boolean {
  return level.wallMap[position]
}

export function updateBoxPosition(
  boxPositions: ReadonlySet<number>,
  currentBoxPosition: number,
  nextBoxPosition: number,
): Set<number> {
  const updatedBoxPositions = new Set(boxPositions)
  updatedBoxPositions.delete(currentBoxPosition)
  updatedBoxPositions.add(nextBoxPosition)

  return updatedBoxPositions
}

export function isPositionBox(
  levelState: LevelState,
  position: number,
): boolean {
  return levelState.boxPositions.has(position)
}

function isPositionValid(level: Level, position: number): boolean {
  return isPositionOnLevel(level, position) && !isPositionWall(level, position)
}

function isPositionPlayer(levelState: LevelState, position: number): boolean {
  return levelState.playerCurrentPosition === position
}

export function isPositionFree(
  levelState: LevelState,
  position: number,
): boolean {
  return (
    isPositionValid(levelState.level, position) &&
    !isPositionBox(levelState, position) &&
    !isPositionPlayer(levelState, position)
  )
}

export function getNextPosition(
  level: Level,
  currentPosition: number,
  playerMoveDirection: PlayerMoveDirection,
): number {
  const POSITION_STEPS: Record<PlayerMoveDirection, readonly [number, number]> =
    {
      up: [0, -1],
      down: [0, 1],
      left: [-1, 0],
      right: [1, 0],
    }

  const [positionStepX, positionStepY] = POSITION_STEPS[playerMoveDirection]
  const nextPositionX = getPositionX(level, currentPosition) + positionStepX
  const nextPositionY = getPositionY(level, currentPosition) + positionStepY

  if (!areCoordinatesOnLevel(level, nextPositionX, nextPositionY)) {
    return -1
  }

  return getPositionFromCoordinates(nextPositionX, nextPositionY, level.width)
}

export function isSolved(levelState: LevelState): boolean {
  for (const box of levelState.boxPositions) {
    if (!levelState.level.goalPositions.has(box)) {
      return false
    }
  }

  return true
}
