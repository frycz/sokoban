import { getPositionFromCoordinates } from '../core/rules'
import type { EditorDocument } from './document'

export type GridLayout = {
  readonly tileSize: number
  readonly originX: number
  readonly originY: number
  /**
   * The size the canvas has to be to hold the board at this zoom — the view's
   * own size at `fit`, larger once zoomed past it, which is what makes the
   * board's scroll container pan rather than crop. Same deal as the sheet
   * palette's `SheetLayout`.
   */
  readonly contentWidth: number
  readonly contentHeight: number
}

/**
 * Pure, so the renderer and the pointer handler can each work it out from the
 * same inputs and agree without one having to ask the other.
 *
 * Zoom multiplies the fitted tile size rather than naming an absolute one, so
 * the content is at most the view's size times the zoom whatever the level's
 * dimensions — a 100×100 level cannot zoom its way into a canvas the browser
 * refuses to allocate.
 */
export function computeGridLayout(
  editorDocument: EditorDocument,
  viewWidth: number,
  viewHeight: number,
  zoom = 1,
): GridLayout {
  const tileSize = Math.max(
    1,
    Math.floor(
      Math.min(
        viewWidth / editorDocument.width,
        viewHeight / editorDocument.height,
      ) * zoom,
    ),
  )
  const contentWidth = Math.max(viewWidth, tileSize * editorDocument.width)
  const contentHeight = Math.max(viewHeight, tileSize * editorDocument.height)

  return {
    tileSize,
    originX: Math.floor((contentWidth - tileSize * editorDocument.width) / 2),
    originY: Math.floor((contentHeight - tileSize * editorDocument.height) / 2),
    contentWidth,
    contentHeight,
  }
}

/** Returns -1 for a pixel outside the grid. */
export function getPositionAtPixel(
  editorDocument: EditorDocument,
  layout: GridLayout,
  pixelX: number,
  pixelY: number,
): number {
  const x = Math.floor((pixelX - layout.originX) / layout.tileSize)
  const y = Math.floor((pixelY - layout.originY) / layout.tileSize)

  if (x < 0 || x >= editorDocument.width) {
    return -1
  }

  if (y < 0 || y >= editorDocument.height) {
    return -1
  }

  return getPositionFromCoordinates(x, y, editorDocument.width)
}
