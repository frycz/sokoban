import type { Level, LevelState, PlayerMoveDirection } from './types'

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

export function isPositionBox(levelState: LevelState, position: number): boolean {
  return levelState.boxPositions.has(position)
}

function isPositionValid(level: Level, position: number): boolean {
  return isPositionOnMap(level, position) && !isPositionWall(level, position)
}

function isPositionPlayer(levelState: LevelState, position: number): boolean {
  return levelState.playerCurrentPosition === position
}

export function isPositionFree(levelState: LevelState, position: number): boolean {
  return (
    isPositionValid(levelState.level, position) &&
    !isPositionBox(levelState, position) &&
    !isPositionPlayer(levelState, position)
  )
}

const DELTAS: Record<PlayerMoveDirection, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

export function getNextPosition(
  level: Level,
  position: number,
  playerMoveDirection: PlayerMoveDirection,
): number {
  const [deltaX, deltaY] = DELTAS[playerMoveDirection]
  const x = (position % level.width) + deltaX
  const y = Math.floor(position / level.width) + deltaY
  if (x < 0 || x >= level.width || y < 0 || y >= level.height) return -1
  return y * level.width + x
}

export function isSolved(levelState: LevelState): boolean {
  for (const box of levelState.boxPositions) {
    if (!levelState.level.goalPositions.has(box)) return false
  }
  return true
}
