/**
 * The cells whose art the level's author placed by hand, as the game reads them
 * out of a bundle's `tiles.json`.
 *
 * A leaf that imports nothing, like `colors.ts` and `tile-roles.ts`, because
 * both sides need the vocabulary: the editor authors a placement and writes the
 * file, the game reads it and draws it, and neither may depend on the other.
 */

/**
 * Whether the skin still draws under the placed tile.
 *
 * `onTop` composites it over the cell's usual stack, so a tile with
 * transparency shows the floor — or the box standing there — through it.
 * `overwrite` draws the cell from nothing but the placed tile, so transparency
 * is a hole in the board rather than a window onto the skin.
 *
 * For an opaque tile the two are indistinguishable, which is why the choice is
 * the author's and not something the format can infer.
 */
export type CustomTileMode = 'onTop' | 'overwrite'

/** A cell's placed tile: which atlas column, and what it does to the skin. */
export type CustomTilePlacement = {
  readonly column: number
  readonly mode: CustomTileMode
}

/** Level position → placement. */
export type CustomTileMap = ReadonlyMap<number, CustomTilePlacement>

/**
 * ```json
 * {
 *   "width": 16,
 *   "height": 12,
 *   "tiles": {
 *     "34": { "column": 6, "mode": "onTop" },
 *     "35": { "column": 7, "mode": "overwrite" }
 *   }
 * }
 * ```
 *
 * Field by field like the manifest, and checked against the level rather than
 * trusted: a position is an index into one grid, so a file counted against a
 * different width would draw every tile on the wrong cell. Mismatched
 * dimensions are a broken bundle, not a file to guess at, so this returns null
 * and the caller says so out loud.
 *
 * Every entry spells its own mode. There is no default to remember on either
 * side of the seam, and a mode added later is a new string rather than a new
 * field.
 */
export function parseCustomTileMap(
  value: unknown,
  width: number,
  height: number,
): CustomTileMap | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const record = value as Record<string, unknown>

  if (record.width !== width || record.height !== height) {
    return null
  }

  if (typeof record.tiles !== 'object' || record.tiles === null) {
    return null
  }

  const cellCount = width * height
  const customTiles = new Map<number, CustomTilePlacement>()

  for (const [key, entry] of Object.entries(
    record.tiles as Record<string, unknown>,
  )) {
    const position = Number(key)

    if (!Number.isInteger(position) || position < 0 || position >= cellCount) {
      return null
    }

    const placement = readPlacement(entry)

    if (!placement) {
      return null
    }

    customTiles.set(position, placement)
  }

  return customTiles
}

function readPlacement(value: unknown): CustomTilePlacement | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const record = value as Record<string, unknown>
  const { column, mode } = record

  if (typeof column !== 'number' || !Number.isInteger(column) || column < 0) {
    return null
  }

  if (mode !== 'onTop' && mode !== 'overwrite') {
    return null
  }

  return { column, mode }
}
