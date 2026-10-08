/**
 * How to read a grid of tiles out of an image. These four numbers handle
 * essentially any tileset in the wild, and an exported atlas is described with
 * the same vocabulary — so the game's loader slices our own output with the
 * identical arithmetic rather than a second, special-cased code path.
 */
export type SheetSettings = {
  readonly tileWidth: number
  readonly tileHeight: number
  readonly margin: number
  readonly spacing: number
}

export const DEFAULT_SHEET_SETTINGS: SheetSettings = {
  tileWidth: 32,
  tileHeight: 32,
  margin: 0,
  spacing: 0,
}

/**
 * An exported atlas extrudes every tile by one pixel — the edge row and column
 * duplicated outward — because the game scales tiles to fit the canvas and is
 * almost never drawing at native size. Without it, neighbouring tiles bleed in
 * along the seams at some window sizes.
 *
 * Expressed as margin and spacing so the export is just another sheet: one
 * pixel before the first tile, two between each pair (one from each side).
 */
export const EXPORT_MARGIN = 1
export const EXPORT_SPACING = 2

export type SheetGrid = {
  readonly columns: number
  readonly rows: number
  readonly tileCount: number
}

export type SheetRect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type SheetLayout = {
  readonly scale: number
  readonly originX: number
  readonly originY: number
}

const EMPTY_RECT: SheetRect = { x: 0, y: 0, width: 0, height: 0 }

function toInteger(value: number, minimum: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.max(minimum, Math.floor(value))
}

export function clampSheetSettings(settings: SheetSettings): SheetSettings {
  return {
    tileWidth: toInteger(
      settings.tileWidth,
      1,
      DEFAULT_SHEET_SETTINGS.tileWidth,
    ),
    tileHeight: toInteger(
      settings.tileHeight,
      1,
      DEFAULT_SHEET_SETTINGS.tileHeight,
    ),
    margin: toInteger(settings.margin, 0, 0),
    spacing: toInteger(settings.spacing, 0, 0),
  }
}

function countAlong(
  extent: number,
  margin: number,
  tile: number,
  spacing: number,
): number {
  if (extent < margin + tile) {
    return 0
  }

  return Math.floor((extent - margin + spacing) / (tile + spacing))
}

export function getSheetGrid(
  settings: SheetSettings,
  imageWidth: number,
  imageHeight: number,
): SheetGrid {
  const { tileWidth, tileHeight, margin, spacing } =
    clampSheetSettings(settings)
  const columns = countAlong(imageWidth, margin, tileWidth, spacing)
  const rows = countAlong(imageHeight, margin, tileHeight, spacing)

  return { columns, rows, tileCount: columns * rows }
}

export function getSourceTileRect(
  settings: SheetSettings,
  grid: SheetGrid,
  tileIndex: number,
): SheetRect {
  if (grid.columns <= 0 || tileIndex < 0 || tileIndex >= grid.tileCount) {
    return EMPTY_RECT
  }

  const { tileWidth, tileHeight, margin, spacing } =
    clampSheetSettings(settings)
  const column = tileIndex % grid.columns
  const row = Math.floor(tileIndex / grid.columns)

  return {
    x: margin + column * (tileWidth + spacing),
    y: margin + row * (tileHeight + spacing),
    width: tileWidth,
    height: tileHeight,
  }
}

/**
 * Fits the whole sheet into the palette canvas. Scaling up snaps to a whole
 * number so a 16px tileset stays on pixel boundaries instead of shimmering.
 */
export function computeSheetLayout(
  imageWidth: number,
  imageHeight: number,
  cssWidth: number,
  cssHeight: number,
): SheetLayout {
  if (imageWidth <= 0 || imageHeight <= 0) {
    return { scale: 1, originX: 0, originY: 0 }
  }

  const fitted = Math.min(cssWidth / imageWidth, cssHeight / imageHeight)
  const scale = fitted > 1 ? Math.floor(fitted) : fitted

  return {
    scale,
    originX: Math.floor((cssWidth - imageWidth * scale) / 2),
    originY: Math.floor((cssHeight - imageHeight * scale) / 2),
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
