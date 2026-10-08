import type { CustomTiles } from '../document'
import { getBoundRoles, type SkinDraft } from './skin'

/**
 * How the hand-placed tiles leave the editor: extra columns on the end of the
 * atlas, and a map from cell to column.
 *
 * A placement in the draft names a tile in the loaded sheet, which the game
 * never sees — it only ever has the packed atlas. So the export turns sheet
 * indices into atlas columns, one column per distinct tile however many cells
 * use it, appended after the role columns so `roles[n]` still describes column
 * `n` and the manifest does not have to grow a second list.
 */
export type CustomTilePacking = {
  /** Sheet tile indices to append to the atlas, in column order. */
  readonly sheetTileIndices: readonly number[]
  /** Level position → atlas column. */
  readonly columnOfPosition: ReadonlyMap<number, number>
}

const NO_CUSTOM_TILE_PACKING: CustomTilePacking = {
  sheetTileIndices: [],
  columnOfPosition: new Map(),
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
    ([, tileIndex]) => tileIndex >= 0 && tileIndex < tileCount,
  )

  if (usable.length === 0) {
    return NO_CUSTOM_TILE_PACKING
  }

  const sheetTileIndices = [
    ...new Set(usable.map(([, tileIndex]) => tileIndex)),
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
    columnOfPosition: new Map(
      usable.map(([position, tileIndex]) => [
        position,
        columnOfSheetTileIndex.get(tileIndex)!,
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
        [...packing.columnOfPosition].sort(([one], [other]) => one - other),
      ),
    },
    null,
    2,
  )}\n`
}
