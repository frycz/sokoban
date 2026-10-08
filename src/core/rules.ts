import type { Level, LevelState, PlayerMoveDirection } from './types'

export function getPositionX(level: Level, position: number): number {
  return position % level.width
}

export function getPositionY(level: Level, position: number): number {
  return Math.floor(position / level.width)
}

function isPositionOnMap(level: Level, position: number): boolean {
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
  return isPositionOnMap(level, position) && !isPositionWall(level, position)
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

const POSITION_STEPS: Record<PlayerMoveDirection, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

export function getNextPosition(
  level: Level,
  currentPosition: number,
  playerMoveDirection: PlayerMoveDirection,
): number {
  const [positionStepX, positionStepY] = POSITION_STEPS[playerMoveDirection]
  const nextPositionX = getPositionX(level, currentPosition) + positionStepX
  const nextPositionY = getPositionY(level, currentPosition) + positionStepY
  if (
    nextPositionX < 0 ||
    nextPositionX >= level.width ||
    nextPositionY < 0 ||
    nextPositionY >= level.height
  ) {
    return -1
  }
  return nextPositionY * level.width + nextPositionX
}

export function isSolved(levelState: LevelState): boolean {
  for (const box of levelState.boxPositions) {
    if (!levelState.level.goalPositions.has(box)) return false
  }
  return true
}
