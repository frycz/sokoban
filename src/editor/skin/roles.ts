import { ROLE_ORDER, type TileRole } from '../../render/tile-roles'
import type { Cell } from '../document'

export const ROLE_LABELS: Record<TileRole, string> = {
  floor: 'floor',
  goal: 'goal',
  wall: 'wall',
  box: 'box',
  boxOnGoal: 'box placed',
  player: 'player',
}

/**
 * The role a click on this cell means. Clicking the preview binds a role, never
 * a cell — a skin has to work on levels its author never saw — so this is the
 * topmost thing drawn there rather than every layer under the cursor.
 */
export function getTopRoleAtCell(cell: Cell): TileRole {
  if (cell.isWall) {
    return 'wall'
  }

  if (cell.content === 'box') {
    return cell.isGoal ? 'boxOnGoal' : 'box'
  }

  if (cell.content === 'player') {
    return 'player'
  }

  return cell.isGoal ? 'goal' : 'floor'
}

export { ROLE_ORDER, type TileRole }
