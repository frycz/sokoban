/**
 * The engine's entire input vocabulary. Deliberately not keycodes: input
 * mapping belongs to the host. Undo and reset are history operations, so
 * they live in the host too.
 */
export type PlayerMoveDirection = 'up' | 'down' | 'left' | 'right'

/** Static level data. Never changes once parsed. */
export type Level = {
  width: number
  height: number
  /** Indexed by flat position. Non-interior cells count as walls. */
  wallMap: boolean[]
  goalPositions: ReadonlySet<number>
}

/** Everything that changes while playing. Positions are flat indices. */
export type LevelState = {
  level: Level
  playerCurrentPosition: number
  boxPositions: ReadonlySet<number>
}
