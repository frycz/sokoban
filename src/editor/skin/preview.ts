import { COLORS } from '../../render/colors'
import { getBaseRole, type TileRole } from '../../render/tile-roles'
import { getCellX, getCellY, type EditorDocument } from '../document'
import { computeGridLayout } from '../layout'
import { getWallRoleAt } from './roles'
import { getSheetGrid, getSourceTileRect } from './sheet'
import { isRoleBound, type SkinDraft } from './skin'

/**
 * What an unbound role falls back to, so the preview is always readable and
 * what is still missing shows as a flat block rather than a hole. Every wall
 * piece shares the wall colour, since by then the sprite fallback has already
 * sent it to the base `wall` role.
 */
const FALLBACK_COLORS: Record<TileRole, string> = {
  floor: COLORS.floor,
  goal: COLORS.goal,
  wall: COLORS.wall,
  wallTop: COLORS.wall,
  wallRight: COLORS.wall,
  wallBottom: COLORS.wall,
  wallLeft: COLORS.wall,
  wallTopLeft: COLORS.wall,
  wallTopRight: COLORS.wall,
  wallBottomRight: COLORS.wall,
  wallBottomLeft: COLORS.wall,
  box: COLORS.box,
  boxOnGoal: COLORS.boxDone,
  player: COLORS.player,
}

/**
 * The level from level mode, drawn under the skin. Layer order matches what the
 * game renderer will do: floor under every non-wall cell, goal over it, the
 * object over both.
 *
 * Like the game, a wall with no floor anywhere around it is not drawn at all,
 * so a skin never has to supply art for "outside the level".
 */
export function createSkinPreviewPainter(
  canvas: HTMLCanvasElement,
): (
  editorDocument: EditorDocument,
  draft: SkinDraft,
  image: ImageBitmap | null,
) => void {
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas 2D context is unavailable')
  }

  return function paint(editorDocument, draft, image): void {
    const pixelRatio = window.devicePixelRatio || 1
    const cssWidth = canvas.clientWidth
    const cssHeight = canvas.clientHeight
    canvas.width = Math.round(cssWidth * pixelRatio)
    canvas.height = Math.round(cssHeight * pixelRatio)

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.clearRect(0, 0, cssWidth, cssHeight)
    context.imageSmoothingEnabled = !draft.isPixelated

    const layout = computeGridLayout(editorDocument, cssWidth, cssHeight)
    const { tileSize } = layout
    const grid = image
      ? getSheetGrid(draft.sheet, image.width, image.height)
      : null

    const drawRole = (requested: TileRole, x: number, y: number): void => {
      // An unbound wall piece falls back to the base wall tile, so a six-tile
      // skin still draws every wall. `getBaseRole` is shared with the game so
      // the two cannot disagree about an incomplete skin.
      const role = isRoleBound(draft, requested)
        ? requested
        : getBaseRole(requested)
      const tileIndex = draft.bindings[role]

      if (image && grid && isRoleBound(draft, role)) {
        const rect = getSourceTileRect(draft.sheet, grid, tileIndex)

        if (rect.width > 0) {
          context.drawImage(
            image,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            x,
            y,
            tileSize,
            tileSize,
          )

          return
        }
      }

      context.fillStyle = FALLBACK_COLORS[role]
      context.fillRect(x, y, tileSize, tileSize)
    }

    for (let position = 0; position < editorDocument.cells.length; position++) {
      const cell = editorDocument.cells[position]
      const x = layout.originX + getCellX(editorDocument, position) * tileSize
      const y = layout.originY + getCellY(editorDocument, position) * tileSize

      if (cell.isWall) {
        if (touchesFloor(editorDocument, position)) {
          drawRole(getWallRoleAt(editorDocument, position), x, y)
        }

        continue
      }

      drawRole('floor', x, y)

      if (cell.isGoal) {
        drawRole('goal', x, y)
      }

      if (cell.content === 'box') {
        drawRole(cell.isGoal ? 'boxOnGoal' : 'box', x, y)
      }

      if (cell.content === 'player') {
        drawRole('player', x, y)
      }
    }
  }
}

function touchesFloor(
  editorDocument: EditorDocument,
  position: number,
): boolean {
  const x = getCellX(editorDocument, position)
  const y = getCellY(editorDocument, position)

  for (let offsetY = -1; offsetY <= 1; offsetY++) {
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      const neighbourX = x + offsetX
      const neighbourY = y + offsetY

      if (neighbourX < 0 || neighbourX >= editorDocument.width) {
        continue
      }

      if (neighbourY < 0 || neighbourY >= editorDocument.height) {
        continue
      }

      if (
        !editorDocument.cells[neighbourY * editorDocument.width + neighbourX]
          .isWall
      ) {
        return true
      }
    }
  }

  return false
}
