import {
  EXPORT_MARGIN,
  EXPORT_SPACING,
  clampSheetSettings,
  getSheetGrid,
  getSourceTileRect,
} from '../../render/sheet'
import { getBoundRoles, getMissingRequiredRoles, type SkinDraft } from './skin'

export type AtlasSize = {
  readonly width: number
  readonly height: number
}

/**
 * One row, one tile per bound role, in `ROLE_ORDER`, then one per distinct
 * hand-placed tile. Unbound roles take no column — the manifest's role list says
 * what is actually there — so a six-tile skin exports six tiles and a fully
 * pieced one exports fourteen. The custom columns sit after the roles and have
 * no name in the manifest; `tiles.json` is what points at them.
 */
export function getAtlasSize(
  draft: SkinDraft,
  customColumnCount = 0,
): AtlasSize {
  const { tileWidth, tileHeight } = clampSheetSettings(draft.sheet)

  return {
    width:
      (getBoundRoles(draft).length + customColumnCount) *
      (tileWidth + EXPORT_SPACING),
    height: tileHeight + EXPORT_SPACING,
  }
}

export function getAtlasSlotX(draft: SkinDraft, columnIndex: number): number {
  const { tileWidth } = clampSheetSettings(draft.sheet)

  return EXPORT_MARGIN + columnIndex * (tileWidth + EXPORT_SPACING)
}

/**
 * Repacks only the tiles the skin actually uses, so a skin cut from a 500-tile
 * sheet ships as a handful. Refuses a draft missing a required role rather than
 * emitting an atlas with holes in it.
 *
 * `customSheetTileIndices` are the hand-placed tiles, already deduplicated and
 * bounds-checked by `packCustomTiles` — the one place that decides which column
 * each of them lands in, so the atlas and `tiles.json` cannot disagree.
 */
export function packSkinAtlas(
  draft: SkinDraft,
  image: ImageBitmap,
  customSheetTileIndices: readonly number[] = [],
): HTMLCanvasElement {
  const missing = getMissingRequiredRoles(draft)

  if (missing.length > 0) {
    throw new Error(`Cannot export: no tile for ${missing.join(', ')}`)
  }

  const { tileWidth, tileHeight } = clampSheetSettings(draft.sheet)
  const size = getAtlasSize(draft, customSheetTileIndices.length)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas 2D context is unavailable')
  }

  context.imageSmoothingEnabled = false

  const grid = getSheetGrid(draft.sheet, image.width, image.height)

  const columns = [
    ...getBoundRoles(draft).map((role) => ({
      sheetTileIndex: draft.bindings[role],
      describe: () => `the tile bound to ${role}`,
    })),
    ...customSheetTileIndices.map((sheetTileIndex) => ({
      sheetTileIndex,
      describe: () => `the hand-placed tile #${sheetTileIndex}`,
    })),
  ]

  for (const [columnIndex, column] of columns.entries()) {
    const source = getSourceTileRect(draft.sheet, grid, column.sheetTileIndex)

    if (source.width === 0) {
      throw new Error(
        `Cannot export: ${column.describe()} is outside the sheet`,
      )
    }

    const x = getAtlasSlotX(draft, columnIndex)
    const y = EXPORT_MARGIN

    const copy = (
      sourceX: number,
      sourceY: number,
      sourceWidth: number,
      sourceHeight: number,
      destinationX: number,
      destinationY: number,
    ) =>
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        destinationX,
        destinationY,
        sourceWidth,
        sourceHeight,
      )

    copy(source.x, source.y, tileWidth, tileHeight, x, y)

    // The extrusion: edge rows and columns duplicated outward, then the four
    // corner pixels, so bilinear sampling at a seam reads this tile's own
    // colour instead of its neighbour's.
    copy(source.x, source.y, 1, tileHeight, x - 1, y)
    copy(source.x + tileWidth - 1, source.y, 1, tileHeight, x + tileWidth, y)
    copy(source.x, source.y, tileWidth, 1, x, y - 1)
    copy(source.x, source.y + tileHeight - 1, tileWidth, 1, x, y + tileHeight)
    copy(source.x, source.y, 1, 1, x - 1, y - 1)
    copy(source.x + tileWidth - 1, source.y, 1, 1, x + tileWidth, y - 1)
    copy(source.x, source.y + tileHeight - 1, 1, 1, x - 1, y + tileHeight)
    copy(
      source.x + tileWidth - 1,
      source.y + tileHeight - 1,
      1,
      1,
      x + tileWidth,
      y + tileHeight,
    )
  }

  return canvas
}
