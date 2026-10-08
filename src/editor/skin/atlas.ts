import { ROLE_ORDER } from '../../render/tile-roles'
import {
  EXPORT_MARGIN,
  EXPORT_SPACING,
  clampSheetSettings,
  getSheetGrid,
  getSourceTileRect,
} from './sheet'
import { UNBOUND, type SkinDraft } from './skin'

export type AtlasSize = {
  readonly width: number
  readonly height: number
}

/**
 * One row, one tile per role, in `ROLE_ORDER`. Every tile is extruded by a
 * pixel, which the margin and spacing in the manifest describe.
 */
export function getAtlasSize(draft: SkinDraft): AtlasSize {
  const { tileWidth, tileHeight } = clampSheetSettings(draft.sheet)

  return {
    width: ROLE_ORDER.length * (tileWidth + EXPORT_SPACING),
    height: tileHeight + EXPORT_SPACING,
  }
}

export function getAtlasSlotX(draft: SkinDraft, roleIndex: number): number {
  const { tileWidth } = clampSheetSettings(draft.sheet)

  return EXPORT_MARGIN + roleIndex * (tileWidth + EXPORT_SPACING)
}

/**
 * Repacks only the tiles the skin actually uses, so a skin cut from a 500-tile
 * sheet ships as six tiles. Throws on an incomplete draft rather than emitting
 * an atlas with holes in it.
 */
export function packSkinAtlas(
  draft: SkinDraft,
  image: ImageBitmap,
): HTMLCanvasElement {
  const { tileWidth, tileHeight } = clampSheetSettings(draft.sheet)
  const size = getAtlasSize(draft)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas 2D context is unavailable')
  }

  context.imageSmoothingEnabled = false

  const grid = getSheetGrid(draft.sheet, image.width, image.height)

  for (const [roleIndex, role] of ROLE_ORDER.entries()) {
    const tileIndex = draft.bindings[role]

    if (tileIndex === UNBOUND) {
      throw new Error(`Cannot export: ${role} has no tile`)
    }

    const source = getSourceTileRect(draft.sheet, grid, tileIndex)

    if (source.width === 0) {
      throw new Error(
        `Cannot export: the tile bound to ${role} is outside the sheet`,
      )
    }

    const x = getAtlasSlotX(draft, roleIndex)
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
