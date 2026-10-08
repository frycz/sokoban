import {
  clampSheetSettings,
  type SheetGrid,
  type SheetSettings,
} from '../../render/sheet'

/**
 * Where the palette draws the sheet, and the inverse of that for the pointer.
 * The slicing arithmetic itself is `render/sheet.ts`, shared with the game; this
 * is only the view on top of it, so it stays in the editor.
 */
export type SheetLayout = {
  readonly scale: number
  readonly originX: number
  readonly originY: number
  /**
   * The size the canvas has to be to hold the sheet at this zoom — the view's
   * own size at `fit`, larger once zoomed past it, which is what makes the
   * palette's scroll container pan rather than crop.
   */
  readonly contentWidth: number
  readonly contentHeight: number
}

/**
 * Fits the whole sheet into the palette view, times `zoom`. Scaling up snaps to
 * a whole number so a 16px tileset stays on pixel boundaries instead of
 * shimmering.
 *
 * Zoom multiplies the fitted scale rather than naming an absolute one, so the
 * content is at most the view's size times the zoom whatever the sheet's
 * dimensions — a huge tileset cannot zoom its way into a canvas the browser
 * refuses to allocate.
 */
export function computeSheetLayout(
  imageWidth: number,
  imageHeight: number,
  viewWidth: number,
  viewHeight: number,
  zoom = 1,
): SheetLayout {
  if (imageWidth <= 0 || imageHeight <= 0) {
    return {
      scale: 1,
      originX: 0,
      originY: 0,
      contentWidth: viewWidth,
      contentHeight: viewHeight,
    }
  }

  const fitted =
    Math.min(viewWidth / imageWidth, viewHeight / imageHeight) * zoom
  const scale = fitted > 1 ? Math.floor(fitted) : fitted
  const contentWidth = Math.max(viewWidth, Math.round(imageWidth * scale))
  const contentHeight = Math.max(viewHeight, Math.round(imageHeight * scale))

  return {
    scale,
    originX: Math.floor((contentWidth - imageWidth * scale) / 2),
    originY: Math.floor((contentHeight - imageHeight * scale) / 2),
    contentWidth,
    contentHeight,
  }
}

/** Returns -1 for a pixel outside the sheet, or in a margin or gutter. */
export function getTileIndexAtPixel(
  settings: SheetSettings,
  grid: SheetGrid,
  layout: SheetLayout,
  pixelX: number,
  pixelY: number,
): number {
  if (grid.tileCount === 0 || layout.scale <= 0) {
    return -1
  }

  const { tileWidth, tileHeight, margin, spacing } =
    clampSheetSettings(settings)
  const imageX = (pixelX - layout.originX) / layout.scale - margin
  const imageY = (pixelY - layout.originY) / layout.scale - margin

  const column = Math.floor(imageX / (tileWidth + spacing))
  const row = Math.floor(imageY / (tileHeight + spacing))

  if (column < 0 || column >= grid.columns || row < 0 || row >= grid.rows) {
    return -1
  }

  // Reject the gutters, so a click between tiles selects nothing rather than
  // snapping to whichever neighbour happens to round closer.
  if (imageX - column * (tileWidth + spacing) >= tileWidth) {
    return -1
  }

  if (imageY - row * (tileHeight + spacing) >= tileHeight) {
    return -1
  }

  return row * grid.columns + column
}
