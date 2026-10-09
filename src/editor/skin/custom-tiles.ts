import type {
  CustomTileMap,
  CustomTilePlacement,
} from '../../render/custom-tiles'
import type { CustomTile, CustomTiles } from '../document'
import type { AtlasTile } from './atlas'
import { getBoundRoles, type SkinDraft } from './skin'
import { getTintKey, isIdentityTint } from '../tint'

/**
 * How the hand-placed tiles leave the editor: extra columns on the end of the
 * atlas, and a placement per cell pointing at one of them.
 *
 * A placement in the document names a tile in the loaded sheet, which the game
 * never sees — it only ever has the packed atlas. So the export turns sheet
 * indices into atlas columns, one column per distinct tile *in a distinct ink*
 * however many cells use it, appended after the role columns so `roles[n]`
 * still describes column `n` and the manifest does not have to grow a second
 * list.
 *
 * The mode is not translated, only carried: it means the same thing to the game
 * renderer as it does to the preview. The ink is not carried at all — it is
 * already in the column's pixels by the time the game sees it.
 */
export type CustomTilePacking = {
  /** The columns to append to the atlas, in column order. */
  readonly columns: readonly AtlasTile[]
  /** Level position → what the game will draw there. */
  readonly placementOfPosition: CustomTileMap
}

const NO_CUSTOM_TILE_PACKING: CustomTilePacking = {
  columns: [],
  placementOfPosition: new Map(),
}

/**
 * What two cells have to agree on to share a column. The ink is in it because
 * the colour is baked into the atlas: one sprite placed in green and in red is
 * two columns, which is the whole cost of not teaching the game about colour.
 */
function getColumnKey(tile: AtlasTile | CustomTile): string {
  return `${tile.tileIndex}|${getTintKey(tile.tint)}`
}

/**
 * `tileCount` is the loaded sheet's, and it is the filter: a placement whose
 * index is off the sheet — the sheet was swapped behind a hand-edited draft, or
 * the settings now cut fewer tiles — is dropped rather than packed as a hole in
 * the atlas with cells pointing at it.
 *
 * Ascending index order, then ink, so the atlas is stable: exporting the same
 * level twice gives byte-identical output whatever order the cells were drawn
 * in.
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

  const distinct = new Map<string, AtlasTile>()

  for (const [, customTile] of usable) {
    distinct.set(getColumnKey(customTile), {
      tileIndex: customTile.tileIndex,
      tint: customTile.tint,
    })
  }

  const columns = [...distinct.values()].sort(
    (one, other) =>
      one.tileIndex - other.tileIndex ||
      getTintKey(one.tint).localeCompare(getTintKey(other.tint)),
  )

  const firstColumn = getBoundRoles(draft).length
  const columnOfKey = new Map(
    columns.map((column, offset) => [
      getColumnKey(column),
      firstColumn + offset,
    ]),
  )

  return {
    columns,
    placementOfPosition: new Map(
      usable.map(([position, customTile]): [number, CustomTilePlacement] => [
        position,
        {
          column: columnOfKey.get(getColumnKey(customTile))!,
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

/**
 * How many placements carry an ink, which is also how many extra atlas columns
 * the colour is costing — said in the sidebar because the one thing a tint can
 * be is invisible, and an author who meant to paint a cell should be able to
 * see that one did or did not take.
 */
export function countTinted(customTiles: CustomTiles): number {
  let count = 0

  for (const customTile of customTiles.values()) {
    if (!isIdentityTint(customTile.tint)) {
      count++
    }
  }

  return count
}
