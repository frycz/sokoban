import { getPositionFromCoordinates } from './rules'
import { step } from './step'
import type { Level, LevelState, PlayerMoveDirection } from './types'

/**
 * Joins XSB lines into level text. Leading spaces are significant, so levels
 * are written as one string per row rather than an indented template literal.
 */
export function xsb(...lines: string[]): string {
  return lines.join('\n')
}

/** Renders a state back to XSB, so expectations are boards instead of sets. */
export function toXsb(levelState: LevelState): string {
  const { level } = levelState
  const lines: string[] = []

  for (let y = 0; y < level.height; y++) {
    let line = ''

    for (let x = 0; x < level.width; x++) {
      line += characterAt(
        levelState,
        getPositionFromCoordinates(x, y, level.width),
      )
    }

    lines.push(line)
  }

  return lines.join('\n')
}

function characterAt(levelState: LevelState, position: number): string {
  const { level, playerCurrentPosition, boxPositions } = levelState

  if (level.wallMap[position]) {
    return '#'
  }

  const isGoal = level.goalPositions.has(position)

  if (boxPositions.has(position)) {
    return isGoal ? '*' : '$'
  }

  if (playerCurrentPosition === position) {
    return isGoal ? '+' : '@'
  }

  return isGoal ? '.' : ' '
}

const DIRECTION_OF_LURD_CHARACTER: Record<
  string,
  PlayerMoveDirection | undefined
> = {
  u: 'up',
  d: 'down',
  l: 'left',
  r: 'right',
}

/**
 * Replays standard LURD notation. Case carries no information for the engine —
 * an uppercase letter marks a push, which `step` works out for itself.
 */
export function play(levelState: LevelState, lurdMoves: string): LevelState {
  let state = levelState

  for (const character of lurdMoves) {
    const playerMoveDirection =
      DIRECTION_OF_LURD_CHARACTER[character.toLowerCase()]

    if (!playerMoveDirection) {
      throw new Error(`Unexpected LURD character ${JSON.stringify(character)}`)
    }

    state = step(state, playerMoveDirection)
  }

  return state
}

/**
 * A wall-free grid, for the cases the parser cannot produce — it seals every
 * level with a wall ring, so a player on column 0 has to be built by hand.
 */
export function openLevelState(
  width: number,
  height: number,
  playerCurrentPosition: number,
  boxPositions: readonly number[] = [],
  goalPositions: readonly number[] = [],
): LevelState {
  const level: Level = {
    width,
    height,
    wallMap: new Array<boolean>(width * height).fill(false),
    goalPositions: new Set(goalPositions),
  }

  return { level, playerCurrentPosition, boxPositions: new Set(boxPositions) }
}
