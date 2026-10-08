import { getWallRole, type TileRole } from '../../render/tile-roles'
import { getCellX, getCellY, type EditorDocument } from '../document'

export const ROLE_LABELS: Record<TileRole, string> = {
  floor: 'floor',
  goal: 'goal',
  wall: 'wall fill',
  wallTop: 'edge top',
  wallRight: 'edge right',
  wallBottom: 'edge bottom',
  wallLeft: 'edge left',
  wallTopLeft: 'corner top-left',
  wallTopRight: 'corner top-right',
  wallBottomRight: 'corner bottom-right',
  wallBottomLeft: 'corner bottom-left',
  box: 'box',
  boxOnGoal: 'box placed',
  player: 'player',
}

function isOpenAt(
  editorDocument: EditorDocument,
  x: number,
  y: number,
): boolean {
  // Off the grid counts as wall, so a level's outer edge does not read as an
  // exposed face. Parsed levels are sealed anyway, but hand-built ones are not.
  if (x < 0 || x >= editorDocument.width) {
    return false
  }

  if (y < 0 || y >= editorDocument.height) {
    return false
  }

  return !editorDocument.cells[y * editorDocument.width + x].isWall
}

/** Which of the nine wall pieces this cell takes, from its neighbourhood. */
export function getWallRoleAt(
  editorDocument: EditorDocument,
  position: number,
): TileRole {
  const x = getCellX(editorDocument, position)
  const y = getCellY(editorDocument, position)

  return getWallRole({
    north: isOpenAt(editorDocument, x, y - 1),
    east: isOpenAt(editorDocument, x + 1, y),
    south: isOpenAt(editorDocument, x, y + 1),
    west: isOpenAt(editorDocument, x - 1, y),
    northEast: isOpenAt(editorDocument, x + 1, y - 1),
    southEast: isOpenAt(editorDocument, x + 1, y + 1),
    southWest: isOpenAt(editorDocument, x - 1, y + 1),
    northWest: isOpenAt(editorDocument, x - 1, y - 1),
  })
}

/**
 * The role a click at this position means. Clicking the preview binds a role,
 * never a cell — a skin has to work on levels its author never saw — so this is
 * the topmost thing drawn there rather than every layer under the cursor.
 *
 * A wall resolves to its specific piece, so clicking a corner binds the corner
 * rather than the fill. The role list in the sidebar reaches any role directly,
 * including the ones a given level has no cell of.
 */
export function getTopRoleAtPosition(
  editorDocument: EditorDocument,
  position: number,
): TileRole {
  const cell = editorDocument.cells[position]

  if (cell.isWall) {
    return getWallRoleAt(editorDocument, position)
  }

  if (cell.content === 'box') {
    return cell.isGoal ? 'boxOnGoal' : 'box'
  }

  if (cell.content === 'player') {
    return 'player'
  }

  return cell.isGoal ? 'goal' : 'floor'
}

export { type TileRole }
