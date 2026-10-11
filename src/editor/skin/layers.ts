import {
  DEFAULT_LAYER_STACK,
  type Layer,
  type LayerStack,
} from '../../render/layers'
import type { CustomTile, EditorLayer } from '../document'
import type { AtlasTile } from './atlas'
import { getBoundRoles, type SkinDraft } from './skin'
import { getTintKey, isIdentityTint } from '../tint'

/**
 * How the layer stack leaves the editor: extra columns on the end of the atlas,
 * and the stack with every art tile pointing at one of them.
 *
 * A placement in the document names a tile in the loaded sheet, which the game
 * never sees — it only ever has the packed atlas. So the export turns sheet
 * indices into atlas columns, one column per distinct tile *in a distinct ink*
 * however many cells and layers use it, appended after the role columns so
 * `roles[n]` still describes column `n` and the manifest does not have to grow
 * a second list.
 *
 * The ink is not carried at all — it is already in the column's pixels by the
 * time the game sees it.
 */
export type LayerPacking = {
  /** The columns to append to the atlas, in column order. */
  readonly columns: readonly AtlasTile[]
  /** The stack as the game will draw it, bottom first. */
  readonly layers: LayerStack
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
 * in. An art layer left with nothing on it is not exported — it draws nothing,
 * and the game has no use for a name.
 */
export function packLayers(
  draft: SkinDraft,
  layers: readonly EditorLayer[],
  tileCount: number,
): LayerPacking {
  const isUsable = (customTile: CustomTile): boolean =>
    customTile.tileIndex >= 0 && customTile.tileIndex < tileCount

  const distinct = new Map<string, AtlasTile>()

  for (const layer of layers) {
    if (layer.kind !== 'art') {
      continue
    }

    for (const customTile of layer.tiles.values()) {
      if (isUsable(customTile)) {
        distinct.set(getColumnKey(customTile), {
          tileIndex: customTile.tileIndex,
          tint: customTile.tint,
        })
      }
    }
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

  const packed: Layer[] = []

  for (const layer of layers) {
    if (layer.kind === 'builtIn') {
      packed.push(layer)
      continue
    }

    const tiles = new Map<number, number>()

    for (const [position, customTile] of [...layer.tiles].sort(
      ([one], [other]) => one - other,
    )) {
      if (isUsable(customTile)) {
        tiles.set(position, columnOfKey.get(getColumnKey(customTile))!)
      }
    }

    if (tiles.size > 0) {
      packed.push({ kind: 'art', name: layer.name, tiles })
    }
  }

  return { columns, layers: packed }
}

/**
 * Whether the bundle needs a `tiles.json` at all. A level with no art and the
 * built-ins in their usual order draws exactly as one without the file, so it
 * ships without one rather than with a file that says nothing.
 */
export function hasLayersFile(packing: LayerPacking): boolean {
  return (
    packing.layers.length !== DEFAULT_LAYER_STACK.length ||
    packing.layers.some((layer, index) => {
      const usual = DEFAULT_LAYER_STACK[index]

      return (
        layer.kind !== 'builtIn' ||
        usual.kind !== 'builtIn' ||
        layer.id !== usual.id
      )
    })
  )
}

/**
 * `tiles.json`: the stack, and the grid its positions are indices into. The
 * game checks those two numbers against the level it parsed rather than trusting
 * them, because a position means nothing without the width it was counted with.
 */
export function formatLayersFile(
  width: number,
  height: number,
  packing: LayerPacking,
): string {
  return `${JSON.stringify(
    {
      width,
      height,
      layers: packing.layers.map((layer) =>
        layer.kind === 'builtIn'
          ? { builtIn: layer.id }
          : { name: layer.name, tiles: Object.fromEntries(layer.tiles) },
      ),
    },
    null,
    2,
  )}\n`
}

/** How many tiles are placed across every art layer. */
export function countPlacedTiles(layers: readonly EditorLayer[]): number {
  let count = 0

  for (const layer of layers) {
    if (layer.kind === 'art') {
      count += layer.tiles.size
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
export function countTinted(layers: readonly EditorLayer[]): number {
  let count = 0

  for (const layer of layers) {
    if (layer.kind !== 'art') {
      continue
    }

    for (const customTile of layer.tiles.values()) {
      if (!isIdentityTint(customTile.tint)) {
        count++
      }
    }
  }

  return count
}
