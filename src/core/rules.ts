import type { Level, PlayerMoveDirection, State } from './types'

const DELTAS: Record<PlayerMoveDirection, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

/**
 * Flat index of the cell one step in `playerMoveDirection`, or -1 if that
 * leaves the grid. Going through x/y rather than adding +/-1 is what stops a
 * `left` move at x === 0 from wrapping to the end of the previous row.
 */
export function neighbour(
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

export function isSolved(state: State): boolean {
  for (const box of state.boxes) {
    if (!state.level.goals.has(box)) return false
  }
  return true
}
