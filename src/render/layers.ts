/**
 * The level's draw order, as the game reads it out of a bundle's `tiles.json`:
 * an explicit stack of layers, bottom first, rather than an order baked into the
 * renderer.
 *
 * A leaf that imports nothing, like `colors.ts` and `tile-roles.ts`, because
 * both sides need the vocabulary: the editor authors a stack and writes the
 * file, the game reads it and draws it, and neither may depend on the other.
 */

/**
 * The layers the level itself generates. They are drawn from the game state —
 * walls and goals from the level, boxes and the player from wherever they are
 * now — so nobody paints into them, but they sit in the stack like any other
 * layer and can go anywhere in it.
 *
 * Every stack holds each of them exactly once: a missing one would be a level
 * with no player on screen, which is never what an author meant.
 */
export const BUILT_IN_LAYERS = [
  'floor',
  'walls',
  'goals',
  'boxes',
  'player',
] as const

export type BuiltInLayer = (typeof BUILT_IN_LAYERS)[number]

/**
 * One layer in the stack. An art layer is the author's: position → atlas column,
 * sparse, as many of them as the level wants. Its name is only for whoever
 * opens the file — the game draws by order, never by name.
 */
export type Layer =
  | { readonly kind: 'builtIn'; readonly id: BuiltInLayer }
  | {
      readonly kind: 'art'
      readonly name: string
      readonly tiles: ReadonlyMap<number, number>
    }

/** Bottom first. */
export type LayerStack = readonly Layer[]

/**
 * What a level with no `tiles.json` draws: floor under every cell of the board,
 * walls included, then walls and goals, then the boxes, then the player.
 */
export const DEFAULT_LAYER_STACK: LayerStack = BUILT_IN_LAYERS.map((id) => ({
  kind: 'builtIn',
  id,
}))

export function isBuiltInLayer(value: unknown): value is BuiltInLayer {
  return (BUILT_IN_LAYERS as readonly unknown[]).includes(value)
}

/**
 * ```json
 * {
 *   "width": 16,
 *   "height": 12,
 *   "layers": [
 *     { "builtIn": "floor" },
 *     { "name": "rugs", "tiles": { "34": 6 } },
 *     { "builtIn": "walls" },
 *     { "builtIn": "goals" },
 *     { "builtIn": "boxes" },
 *     { "builtIn": "player" },
 *     { "name": "canopy", "tiles": { "35": 7 } }
 *   ]
 * }
 * ```
 *
 * Field by field like the manifest, and checked against the level rather than
 * trusted: a position is an index into one grid, so a file counted against a
 * different width would draw every tile on the wrong cell. Mismatched
 * dimensions, an unknown built-in, or a built-in missing or doubled are a broken
 * bundle rather than a file to guess at, so this returns null and the caller
 * says so out loud.
 */
export function parseLayerStack(
  value: unknown,
  width: number,
  height: number,
): LayerStack | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const record = value as Record<string, unknown>

  if (record.width !== width || record.height !== height) {
    return null
  }

  if (!Array.isArray(record.layers)) {
    return null
  }

  const cellCount = width * height
  const layers: Layer[] = []
  const seen = new Set<BuiltInLayer>()

  for (const entry of record.layers) {
    const layer = readLayer(entry, cellCount)

    if (!layer) {
      return null
    }

    if (layer.kind === 'builtIn') {
      if (seen.has(layer.id)) {
        return null
      }

      seen.add(layer.id)
    }

    layers.push(layer)
  }

  if (seen.size !== BUILT_IN_LAYERS.length) {
    return null
  }

  return layers
}

function readLayer(value: unknown, cellCount: number): Layer | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const record = value as Record<string, unknown>

  if ('builtIn' in record) {
    return isBuiltInLayer(record.builtIn)
      ? { kind: 'builtIn', id: record.builtIn }
      : null
  }

  if (typeof record.name !== 'string') {
    return null
  }

  if (typeof record.tiles !== 'object' || record.tiles === null) {
    return null
  }

  const tiles = new Map<number, number>()

  for (const [key, column] of Object.entries(
    record.tiles as Record<string, unknown>,
  )) {
    const position = Number(key)

    if (!Number.isInteger(position) || position < 0 || position >= cellCount) {
      return null
    }

    if (typeof column !== 'number' || !Number.isInteger(column) || column < 0) {
      return null
    }

    tiles.set(position, column)
  }

  return { kind: 'art', name: record.name, tiles }
}
