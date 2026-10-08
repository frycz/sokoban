import { getSheetGrid, getSourceTileRect } from '../../render/sheet'
import { getRoleColor } from '../../render/skin'
import { getBaseRole, type TileRole } from '../../render/tile-roles'
import {
  getCellX,
  getCellY,
  isCellOverwritten,
  type EditorDocument,
} from '../document'
import { computeGridLayout } from '../layout'
import { getWallRoleAt } from './roles'
import { isRoleBound, type SkinDraft } from './skin'

const PREVIEW_COLORS = {
  hover: '#ffffff',
}

/**
 * What the preview is showing rather than what it is drawing. The two switches
 * are how the author tells custom from skin: hiding the skin's tiles leaves the
 * hand-placed ones over a flat-colour level, and hiding the custom ones is the
 * skin as the game would draw it if nothing had been placed.
 */
export type SkinPreviewView = {
  readonly showSkinTiles: boolean
  readonly showCustomTiles: boolean
  /** -1 when the pointer is off the board. */
  readonly hoverPosition: number
}

/**
 * The level from level mode, drawn under the skin. Layer order matches what the
 * game renderer does: floor under every cell of the board, wall or goal over it,
 * the object over both, and a hand-placed tile over all of them.
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
  view: SkinPreviewView,
) => void {
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas 2D context is unavailable')
  }

  return function paint(editorDocument, draft, image, view): void {
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

    const topLeftOf = (position: number) => ({
      x: layout.originX + getCellX(editorDocument, position) * tileSize,
      y: layout.originY + getCellY(editorDocument, position) * tileSize,
    })

    /** Returns whether the tile was there to draw. */
    const drawSheetTile = (
      tileIndex: number,
      x: number,
      y: number,
    ): boolean => {
      if (!image || !grid) {
        return false
      }

      const rect = getSourceTileRect(draft.sheet, grid, tileIndex)

      if (rect.width === 0) {
        return false
      }

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

      return true
    }

    const drawRole = (requested: TileRole, x: number, y: number): void => {
      // An unbound wall piece falls back to the base wall tile, so a six-tile
      // skin still draws every wall. `getBaseRole` is shared with the game so
      // the two cannot disagree about an incomplete skin.
      const role = isRoleBound(draft, requested)
        ? requested
        : getBaseRole(requested)

      // With the skin's tiles hidden this is the only path, which is why hiding
      // them shows the procedural palette rather than an empty board: it is the
      // fallback a half-bound skin already draws, so the level's shape is still
      // readable under whatever has been placed by hand.
      if (
        view.showSkinTiles &&
        isRoleBound(draft, role) &&
        drawSheetTile(draft.bindings[role], x, y)
      ) {
        return
      }

      context.fillStyle = getRoleColor(role)
      context.fillRect(x, y, tileSize, tileSize)
    }

    for (let position = 0; position < editorDocument.cells.length; position++) {
      const cell = editorDocument.cells[position]
      const { x, y } = topLeftOf(position)

      // Outside the level nothing is drawn at all, not even floor, so a skin
      // never has to supply art for it.
      if (cell.isWall && !touchesFloor(editorDocument, position)) {
        continue
      }

      // An overwriting placement means this cell is the placed tile and nothing
      // else, so none of the skin's layers go down first — which is what makes
      // a transparent tile a hole rather than a window onto the floor. Only
      // while the placements are being shown: hiding them has to give the skin
      // back, not leave gaps.
      if (view.showCustomTiles && isCellOverwritten(editorDocument, position)) {
        continue
      }

      // Floor first on every cell the board occupies, walls included: it is one
      // layer under the level and every other tile composites over it.
      drawRole('floor', x, y)

      if (cell.isWall) {
        drawRole(getWallRoleAt(editorDocument, position), x, y)

        continue
      }

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

    // Last, over everything, and over the culled cells too: a tile placed by
    // hand is the author saying what that cell looks like, which outranks both
    // the skin's answer and the board's own silhouette.
    if (view.showCustomTiles) {
      for (const [position, customTile] of editorDocument.customTiles) {
        const { x, y } = topLeftOf(position)

        if (!drawSheetTile(customTile.tileIndex, x, y)) {
          // The sheet is gone or the index is off it — a placement with no art
          // yet. An outline rather than nothing, so it can still be erased.
          context.strokeStyle = getRoleColor('goal')
          context.lineWidth = 1
          context.strokeRect(x + 0.5, y + 0.5, tileSize - 1, tileSize - 1)
        }
      }
    }

    if (
      view.hoverPosition >= 0 &&
      view.hoverPosition < editorDocument.cells.length
    ) {
      const { x, y } = topLeftOf(view.hoverPosition)
      context.strokeStyle = PREVIEW_COLORS.hover
      context.lineWidth = 2
      context.strokeRect(x + 1, y + 1, tileSize - 2, tileSize - 2)
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
