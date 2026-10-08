import type { Level, LevelState, PlayerMoveDirection } from './types'

const DELTAS: Record<PlayerMoveDirection, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

/** True if `position` is a real cell of the grid rather than the -1 sentinel. */
export function isPositionOnMap(level: Level, position: number): boolean {
  return position >= 0 && position < level.width * level.height
}

/**
 * True if `position` holds a wall. Only meaningful for a position that is on
 * the map, so callers check `isPositionOnMap` first.
 */
export function isPositionWall(level: Level, position: number): boolean {
  return level.wallMap[position]
}

/**
 * True if `position` is a cell a piece can occupy: on the map, and not a wall.
 * The order of the two checks matters, because `isPositionWall` does a raw
 * lookup that reads as falsy off the map.
 */
export function isPositionValid(level: Level, position: number): boolean {
  return isPositionOnMap(level, position) && !isPositionWall(level, position)
}

/**
 * Flat index of the cell one step in `playerMoveDirection`, or -1 if that
 * leaves the grid. Going through x/y rather than adding +/-1 is what stops a
 * `left` move at x === 0 from wrapping to the end of the previous row.
 */
export function getNextPosition(
  level: Level,
  position: number,
  playerMoveDirection: PlayerMoveDirection
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
