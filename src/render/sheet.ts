/**
 * How to read a grid of tiles out of an image. These four numbers handle
 * essentially any tileset in the wild, and an exported atlas is described with
 * the same vocabulary — so the game's loader slices our own output with the
 * identical arithmetic rather than a second, special-cased code path.
 *
 * It lives in `render/` rather than the editor because both sides need it: the
 * editor cuts a picked sheet, the game cuts the atlas that came out of it.
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
