import {
  EXPORT_MARGIN,
  EXPORT_SPACING,
  clampSheetSettings,
  getSheetGrid,
  getSourceTileRect,
} from '../../render/sheet'
import { getBoundRoles, getMissingRequiredRoles, type SkinDraft } from './skin'
import type { Tint } from '../tint'
import { tintSheetTile } from './tinted-tiles'

export type AtlasSize = {
  readonly width: number
  readonly height: number
}

/**
 * One column of the exported atlas: a tile of the sheet, and the ink it is
 * drawn with. The ink is part of what a column *is* rather than something the
 * bundle carries, because the colour is baked here — so the same sprite in two
 * inks is two columns, and `tiles.json` stays a column number and a mode.
 */
export type AtlasTile = {
  readonly tileIndex: number
  readonly tint: Tint
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
 * `customColumns` are the hand-placed tiles, already deduplicated and
 * bounds-checked by `packCustomTiles` — the one place that decides which column
 * each of them lands in, so the atlas and `tiles.json` cannot disagree.
 */
export function packSkinAtlas(
  draft: SkinDraft,
  image: ImageBitmap,
  customColumns: readonly AtlasTile[] = [],
): HTMLCanvasElement {
  const missing = getMissingRequiredRoles(draft)

  if (missing.length > 0) {
    throw new Error(`Cannot export: no tile for ${missing.join(', ')}`)
  }

  const { tileWidth, tileHeight } = clampSheetSettings(draft.sheet)
  const size = getAtlasSize(draft, customColumns.length)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas 2D context is unavailable')
  }

  context.imageSmoothingEnabled = false

  const grid = getSheetGrid(draft.sheet, image.width, image.height)

  const columns: (AtlasTile & { readonly describe: () => string })[] = [
    ...getBoundRoles(draft).map((role) => ({
      tileIndex: draft.bindings[role],
      tint: draft.tints[role],
      describe: () => `the tile bound to ${role}`,
    })),
    ...customColumns.map((column) => ({
      ...column,
      describe: () => `the hand-placed tile #${column.tileIndex}`,
    })),
  ]

  for (const [columnIndex, column] of columns.entries()) {
    const source = getSourceTileRect(draft.sheet, grid, column.tileIndex)

    if (source.width === 0) {
      throw new Error(
        `Cannot export: ${column.describe()} is outside the sheet`,
      )
    }

    // Tinted into a tile of its own before anything is copied, so the extrusion
    // duplicates the colour that actually ships rather than the sheet's
    // original pixels — and so every copy below reads from (0, 0).
    const tile = tintSheetTile(image, source, column.tint)
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
        tile,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        destinationX,
        destinationY,
        sourceWidth,
        sourceHeight,
      )

    copy(0, 0, tileWidth, tileHeight, x, y)

    // The extrusion: edge rows and columns duplicated outward, then the four
    // corner pixels, so bilinear sampling at a seam reads this tile's own
    // colour instead of its neighbour's.
    copy(0, 0, 1, tileHeight, x - 1, y)
    copy(tileWidth - 1, 0, 1, tileHeight, x + tileWidth, y)
    copy(0, 0, tileWidth, 1, x, y - 1)
    copy(0, tileHeight - 1, tileWidth, 1, x, y + tileHeight)
    copy(0, 0, 1, 1, x - 1, y - 1)
    copy(tileWidth - 1, 0, 1, 1, x + tileWidth, y - 1)
    copy(0, tileHeight - 1, 1, 1, x - 1, y + tileHeight)
    copy(tileWidth - 1, tileHeight - 1, 1, 1, x + tileWidth, y + tileHeight)
  }

  return canvas
}
