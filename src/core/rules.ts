import type { Dir, Level, State } from './types'

const DELTAS: Record<Dir, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

export function toXY(level: Level, i: number): { x: number; y: number } {
  return { x: i % level.width, y: Math.floor(i / level.width) }
}

export function toIdx(level: Level, x: number, y: number): number {
  return y * level.width + x
}

/**
 * Flat index of the cell one step in `dir`, or -1 if that leaves the grid.
 * Going through x/y rather than adding +/-1 is what stops a `left` move at
 * x === 0 from wrapping to the end of the previous row.
 */
export function neighbour(level: Level, i: number, dir: Dir): number {
  const [dx, dy] = DELTAS[dir]
  const x = (i % level.width) + dx
  const y = Math.floor(i / level.width) + dy
  if (x < 0 || x >= level.width || y < 0 || y >= level.height) return -1
  return y * level.width + x
}

export function isSolved(state: State): boolean {
  for (const box of state.boxes) {
    if (!state.level.goals.has(box)) return false
  }
  return true
}
