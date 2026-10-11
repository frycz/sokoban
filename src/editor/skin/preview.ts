import { getSheetGrid, getSourceTileRect } from '../../render/sheet'
import { getRoleColor } from '../../render/skin'
import { getBaseRole, type TileRole } from '../../render/tile-roles'
import { prepareBackingStore } from '../backing-store'
import type { BuiltInLayer } from '../../render/layers'
import {
  getCellX,
  getCellY,
  type EditorDocument,
  type EditorLayer,
} from '../document'
import { computeGridLayout } from '../layout'
import type { Tint } from '../tint'
import { getWallRoleAt } from './roles'
import { getRoleTint, isRoleBound, type SkinDraft } from './skin'
import { createTintedTileCache } from './tinted-tiles'

const PREVIEW_COLORS = {
  hover: '#ffffff',
}

/**
 * What the preview is showing rather than what it is drawing. Hiding the skin's
 * tiles leaves the hand-placed ones over a flat-colour level. The layer
 * switches are the editor's own, never the level's: a hidden layer is still
 * exported and still drawn by the game.
 */
export type SkinPreviewView = {
  readonly showSkinTiles: boolean
  /** Layer ids the author has switched off. */
  readonly hiddenLayerIds: ReadonlySet<string>
  /** When set, the one layer drawn, whatever is hidden. */
  readonly soloLayerId: string | null
  /** -1 when the pointer is off the board. */
  readonly hoverPosition: number
  /** A multiple of the fit-to-view tile size; see `computeGridLayout`. */
  readonly zoom: number
}

/**
 * The level from level mode, drawn under the skin, layer by layer in the
 * document's own order — the order the game will draw it in.
 *
 * Like the game, a wall with no floor anywhere around it is not drawn at all,
 * so a skin never has to supply art for "outside the level".
 *
 * `view` is the scroll container; the canvas is sized to the zoomed content so
 * that panning is the browser's job rather than a second transform to invert —
 * the sheet palette works the same way.
 */
export function createSkinPreviewPainter(
  view: HTMLElement,
  canvas: HTMLCanvasElement,
): (
  editorDocument: EditorDocument,
  draft: SkinDraft,
  image: ImageBitmap | null,
  options: SkinPreviewView,
) => void {
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas 2D context is unavailable')
  }

  // Every tile goes through the tint cache, the identity tint included, so the
  // preview and the exported atlas are the same pixels by construction rather
  // than by two code paths agreeing. The cache is what makes that affordable:
  // this repaints the whole board on every pointer move.
  const getTintedTile = createTintedTileCache()

  return function paint(editorDocument, draft, image, options): void {
    const layout = computeGridLayout(
      editorDocument,
      view.clientWidth,
      view.clientHeight,
      options.zoom,
    )
    prepareBackingStore(
      canvas,
      context,
      layout.contentWidth,
      layout.contentHeight,
    )
    context.imageSmoothingEnabled = !draft.isPixelated

    const { tileSize } = layout

    // The ground, under everything including the cells the silhouette culls, so
    // the preview shows what the game will: the colour through every transparent
    // pixel the skin has, and the colour alone where nothing is drawn at all.
    // The board's own rectangle rather than the canvas, as in the game.
    if (editorDocument.groundColor !== null) {
      context.fillStyle = editorDocument.groundColor
      context.fillRect(
        layout.originX,
        layout.originY,
        editorDocument.width * tileSize,
        editorDocument.height * tileSize,
      )
    }

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
      tint: Tint,
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
        getTintedTile(image, rect, tint),
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
        options.showSkinTiles &&
        isRoleBound(draft, role) &&
        drawSheetTile(draft.bindings[role], getRoleTint(draft, role), x, y)
      ) {
        return
      }

      context.fillStyle = getRoleColor(role)
      context.fillRect(x, y, tileSize, tileSize)
    }

    const isOnBoard = (position: number): boolean =>
      !editorDocument.cells[position].isWall ||
      touchesFloor(editorDocument, position)

    const drawBuiltIn = (id: BuiltInLayer): void => {
      for (
        let position = 0;
        position < editorDocument.cells.length;
        position++
      ) {
        const cell = editorDocument.cells[position]
        const { x, y } = topLeftOf(position)

        // Outside the level nothing is drawn at all, not even floor, so a skin
        // never has to supply art for it.
        if (!isOnBoard(position)) {
          continue
        }

        if (id === 'floor') {
          drawRole('floor', x, y)
        } else if (id === 'walls' && cell.isWall) {
          drawRole(getWallRoleAt(editorDocument, position), x, y)
        } else if (id === 'goals' && cell.isGoal) {
          drawRole('goal', x, y)
        } else if (id === 'boxes' && cell.content === 'box') {
          drawRole(cell.isGoal ? 'boxOnGoal' : 'box', x, y)
        } else if (id === 'player' && cell.content === 'player') {
          drawRole('player', x, y)
        }
      }
    }

    const isVisible = (layer: EditorLayer): boolean =>
      options.soloLayerId === null
        ? !options.hiddenLayerIds.has(layer.id)
        : layer.id === options.soloLayerId

    for (const layer of editorDocument.layers) {
      if (!isVisible(layer)) {
        continue
      }

      if (layer.kind === 'builtIn') {
        drawBuiltIn(layer.id)
        continue
      }

      // Over the culled cells too: a tile placed by hand is the author saying
      // what that cell looks like, which outranks the board's own silhouette.
      for (const [position, customTile] of layer.tiles) {
        const { x, y } = topLeftOf(position)

        if (!drawSheetTile(customTile.tileIndex, customTile.tint, x, y)) {
          // The sheet is gone or the index is off it — a placement with no art
          // yet. An outline rather than nothing, so it can still be erased.
          context.strokeStyle = getRoleColor('goal')
          context.lineWidth = 1
          context.strokeRect(x + 0.5, y + 0.5, tileSize - 1, tileSize - 1)
        }
      }
    }

    if (
      options.hoverPosition >= 0 &&
      options.hoverPosition < editorDocument.cells.length
    ) {
      const { x, y } = topLeftOf(options.hoverPosition)
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
