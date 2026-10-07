import { neighbour } from './rules'
import type { Action, Dir, State } from './types'

/**
 * The whole game. Pure: same inputs, same output, no side effects.
 * An illegal move returns the *same* state object, so the host can detect
 * "nothing happened" with ===.
 */
export function step(state: State, action: Action): State {
  switch (action.type) {
    case 'move':
      return move(state, action.dir)
  }
}

function move(state: State, dir: Dir): State {
  const { level, player, boxes } = state

  const dest = neighbour(level, player, dir)
  if (dest < 0 || level.walls[dest]) return state

  if (!boxes.has(dest)) {
    return { level, player: dest, boxes }
  }

  // Pushing: the cell beyond the box has to be free of both walls and boxes.
  const beyond = neighbour(level, dest, dir)
  if (beyond < 0 || level.walls[beyond] || boxes.has(beyond)) return state

  const moved = new Set(boxes)
  moved.delete(dest)
  moved.add(beyond)
  return { level, player: dest, boxes: moved }
}
