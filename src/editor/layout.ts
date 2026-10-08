import { getPositionFromCoordinates } from '../core/rules'
import type { EditorDocument } from './document'

export type GridLayout = {
  readonly tileSize: number
  readonly originX: number
  readonly originY: number
}

/**
 * Pure, so the renderer and the pointer handler can each work it out from the
 * same inputs and agree without one having to ask the other.
 */
export function computeGridLayout(
  editorDocument: EditorDocument,
  cssWidth: number,
  cssHeight: number,
): GridLayout {
  const tileSize = Math.max(
    1,
    Math.floor(
      Math.min(
        cssWidth / editorDocument.width,
        cssHeight / editorDocument.height,
      ),
    ),
  )

  return {
    tileSize,
    originX: Math.floor((cssWidth - tileSize * editorDocument.width) / 2),
    originY: Math.floor((cssHeight - tileSize * editorDocument.height) / 2),
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
