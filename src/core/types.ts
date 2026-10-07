export type Dir = 'up' | 'down' | 'left' | 'right'

/**
 * Domain-level actions the engine understands. Deliberately not keycodes:
 * input mapping belongs to the host.
 */
export type Action = { type: 'move'; dir: Dir }

/** Static level data. Never changes once parsed. */
export type Level = {
  width: number
  height: number
  /** Indexed by flat position. Non-interior cells count as walls. */
  walls: boolean[]
  goals: ReadonlySet<number>
}

/** Everything that changes while playing. Positions are flat indices. */
export type State = {
  level: Level
  player: number
  boxes: ReadonlySet<number>
}
