import type {
  CustomTileMap,
  CustomTilePlacement,
} from '../../render/custom-tiles'
import type { CustomTiles } from '../document'
import { getBoundRoles, type SkinDraft } from './skin'

/**
 * How the hand-placed tiles leave the editor: extra columns on the end of the
 * atlas, and a placement per cell pointing at one of them.
 *
 * A placement in the document names a tile in the loaded sheet, which the game
 * never sees — it only ever has the packed atlas. So the export turns sheet
 * indices into atlas columns, one column per distinct tile however many cells
 * use it, appended after the role columns so `roles[n]` still describes column
 * `n` and the manifest does not have to grow a second list.
 *
 * The mode is not translated, only carried: it means the same thing to the game
 * renderer as it does to the preview.
 */
export type CustomTilePacking = {
  /** Sheet tile indices to append to the atlas, in column order. */
  readonly sheetTileIndices: readonly number[]
  /** Level position → what the game will draw there. */
  readonly placementOfPosition: CustomTileMap
}

const NO_CUSTOM_TILE_PACKING: CustomTilePacking = {
  sheetTileIndices: [],
  placementOfPosition: new Map(),
}

/**
 * `tileCount` is the loaded sheet's, and it is the filter: a placement whose
 * index is off the sheet — the sheet was swapped behind a hand-edited draft, or
 * the settings now cut fewer tiles — is dropped rather than packed as a hole in
 * the atlas with cells pointing at it.
 *
 * Ascending index order so the atlas is stable: exporting the same level twice
 * gives byte-identical output whatever order the cells were drawn in.
 */
export function packCustomTiles(
  draft: SkinDraft,
  customTiles: CustomTiles,
  tileCount: number,
): CustomTilePacking {
  const usable = [...customTiles].filter(
    ([, customTile]) =>
      customTile.tileIndex >= 0 && customTile.tileIndex < tileCount,
  )

  if (usable.length === 0) {
    return NO_CUSTOM_TILE_PACKING
  }

  const sheetTileIndices = [
    ...new Set(usable.map(([, customTile]) => customTile.tileIndex)),
  ].sort((one, other) => one - other)

  const firstColumn = getBoundRoles(draft).length
  const columnOfSheetTileIndex = new Map(
    sheetTileIndices.map((tileIndex, offset) => [
      tileIndex,
      firstColumn + offset,
    ]),
  )

  return {
    sheetTileIndices,
    placementOfPosition: new Map(
      usable.map(([position, customTile]): [number, CustomTilePlacement] => [
        position,
        {
          column: columnOfSheetTileIndex.get(customTile.tileIndex)!,
          mode: customTile.mode,
        },
      ]),
    ),
  }
}

/**
 * `tiles.json`: the cells, and the grid the positions are indices into. The
 * game checks those two numbers against the level it parsed rather than trusting
 * them, because a position means nothing without the width it was counted with.
 */
export function formatCustomTilesFile(
  width: number,
  height: number,
  packing: CustomTilePacking,
): string {
  return `${JSON.stringify(
    {
      width,
      height,
      tiles: Object.fromEntries(
        [...packing.placementOfPosition].sort(([one], [other]) => one - other),
      ),
    },
    null,
    2,
  )}\n`
}

/** How many of the placements replace the skin rather than sit over it. */
export function countOverwrites(customTiles: CustomTiles): number {
  let count = 0

  for (const customTile of customTiles.values()) {
    if (customTile.mode === 'overwrite') {
      count++
    }
  }

  return count
}
