import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYER_STACK, parseLayerStack } from '../../render/layers'
import { DEFAULT_LAYERS, type CustomTile, type EditorLayer } from '../document'
import { NO_TINT, type Tint } from '../tint'
import {
  countPlacedTiles,
  countTinted,
  formatLayersFile,
  hasLayersFile,
  packLayers,
} from './layers'
import { bindRole, createEmptySkinDraft, type SkinDraft } from './skin'

const GREEN: Tint = { color: '#55aa33', mode: 'flat', background: null }
const RED: Tint = { color: '#cc3322', mode: 'flat', background: null }

/** Six bound roles, so the custom columns start at 6. */
const DRAFT: SkinDraft = (
  ['floor', 'goal', 'wall', 'box', 'boxOnGoal', 'player'] as const
).reduce((draft, role, index) => bindRole(draft, role, index), {
  ...createEmptySkinDraft(),
  name: 'mossy stone',
})

const TILE_COUNT = 64

function art(
  id: string,
  entries: readonly (readonly [number, number, Tint?])[],
): EditorLayer {
  return {
    kind: 'art',
    id,
    name: `name of ${id}`,
    tiles: new Map(
      entries.map(([position, tileIndex, tint]): [number, CustomTile] => [
        position,
        { tileIndex, tint: tint ?? NO_TINT },
      ]),
    ),
  }
}

/** The default built-ins with the given art layers on top. */
function withArt(...layers: EditorLayer[]): readonly EditorLayer[] {
  return [
    ...DEFAULT_LAYERS.filter((layer) => layer.kind === 'builtIn'),
    ...layers,
  ]
}

/** Position → column of the packed art layer at `index` in the stack. */
function columnsOf(
  packing: ReturnType<typeof packLayers>,
  index: number,
): [number, number][] {
  const layer = packing.layers[index]

  return layer.kind === 'art' ? [...layer.tiles] : []
}

describe('packLayers', () => {
  it('gives one column per distinct tile, after the role columns', () => {
    const packing = packLayers(
      DRAFT,
      withArt(
        art('art-1', [
          [4, 20],
          [5, 11],
          [9, 20],
        ]),
      ),
      TILE_COUNT,
    )

    // Ascending sheet index, so the same level exports the same atlas however
    // the cells were drawn.
    expect(packing.columns).toEqual([
      { tileIndex: 11, tint: NO_TINT },
      { tileIndex: 20, tint: NO_TINT },
    ])
    expect(columnsOf(packing, 5)).toEqual([
      [4, 7],
      [5, 6],
      [9, 7],
    ])
  })

  it('shares a column across layers, and keeps the layer order', () => {
    const packing = packLayers(
      DRAFT,
      [
        DEFAULT_LAYERS[0],
        art('art-2', [[4, 20]]),
        ...DEFAULT_LAYERS.slice(1, 5),
        art('art-1', [[4, 20]]),
      ],
      TILE_COUNT,
    )

    expect(packing.columns).toEqual([{ tileIndex: 20, tint: NO_TINT }])
    expect(packing.layers.map((layer) => layer.kind)).toEqual([
      'builtIn',
      'art',
      'builtIn',
      'builtIn',
      'builtIn',
      'builtIn',
      'art',
    ])
    expect(columnsOf(packing, 1)).toEqual([[4, 6]])
    expect(columnsOf(packing, 6)).toEqual([[4, 6]])
  })

  /**
   * The ink *is* part of the column, because the colour is baked into the
   * atlas rather than carried in `tiles.json`. So one sprite in two inks costs
   * two columns — and the file still says nothing about colour.
   */
  it('gives one tile in two inks a column each', () => {
    const packing = packLayers(
      DRAFT,
      withArt(
        art('art-1', [
          [4, 20, RED],
          [5, 20, GREEN],
          [6, 20, RED],
        ]),
      ),
      TILE_COUNT,
    )

    // Ordered by ink within the index, so the atlas is stable whatever order
    // the cells were painted in.
    expect(packing.columns).toEqual([
      { tileIndex: 20, tint: GREEN },
      { tileIndex: 20, tint: RED },
    ])
    expect(columnsOf(packing, 5)).toEqual([
      [4, 7],
      [5, 6],
      [6, 7],
    ])
  })

  it('drops a placement whose tile is off the sheet', () => {
    const packing = packLayers(
      DRAFT,
      withArt(
        art('art-1', [
          [4, 3],
          [5, TILE_COUNT],
        ]),
      ),
      TILE_COUNT,
    )

    expect(packing.columns).toEqual([{ tileIndex: 3, tint: NO_TINT }])
    expect(columnsOf(packing, 5)).toEqual([[4, 6]])
  })

  it('drops an art layer with nothing on it', () => {
    const packing = packLayers(DRAFT, DEFAULT_LAYERS, TILE_COUNT)

    expect(packing.columns).toEqual([])
    expect(packing.layers).toEqual(DEFAULT_LAYER_STACK)
  })
})

describe('hasLayersFile', () => {
  it('is false for the default order with no art', () => {
    expect(hasLayersFile(packLayers(DRAFT, DEFAULT_LAYERS, TILE_COUNT))).toBe(
      false,
    )
  })

  it('is true once a built-in moves, even with no art', () => {
    const [floor, walls, goals, boxes, player] = DEFAULT_LAYERS

    expect(
      hasLayersFile(
        packLayers(DRAFT, [floor, walls, goals, player, boxes], TILE_COUNT),
      ),
    ).toBe(true)
  })

  it('is true once any art is placed', () => {
    expect(
      hasLayersFile(
        packLayers(DRAFT, withArt(art('art-1', [[0, 1]])), TILE_COUNT),
      ),
    ).toBe(true)
  })
})

describe('countPlacedTiles and countTinted', () => {
  const layers = withArt(
    art('art-1', [
      [4, 1],
      [5, 2, GREEN],
    ]),
    art('art-2', [[4, 3, RED]]),
  )

  it('counts across every art layer', () => {
    expect(countPlacedTiles(layers)).toBe(3)
    expect(countTinted(layers)).toBe(2)
  })

  /** Multiplying by white is what "no ink" is, not a colour anyone picked. */
  it('does not count a multiply back to white as inked', () => {
    expect(
      countTinted(
        withArt(
          art('art-1', [
            [4, 1, { color: '#ffffff', mode: 'multiply', background: null }],
          ]),
        ),
      ),
    ).toBe(0)
  })

  /** A flat white is a real repaint: it turns coloured art into a silhouette. */
  it('counts a flat white, which is not a no-op', () => {
    expect(
      countTinted(
        withArt(
          art('art-1', [
            [4, 1, { color: '#ffffff', mode: 'flat', background: null }],
          ]),
        ),
      ),
    ).toBe(1)
  })
})

/**
 * The seam: what the editor writes is what the game reads. A bundle is only
 * correct if the stack survives the file, so this asserts both halves against
 * each other rather than either against a literal.
 */
describe('tiles.json', () => {
  const packing = packLayers(
    DRAFT,
    [
      DEFAULT_LAYERS[0],
      art('art-2', [[5, 11]]),
      ...DEFAULT_LAYERS.slice(1, 5),
      art('art-1', [[4, 20, GREEN]]),
    ],
    TILE_COUNT,
  )

  /** As the game gets it: the file read back off disk, not the packing. */
  const file: unknown = JSON.parse(formatLayersFile(5, 3, packing))

  it('round-trips through the parser the game reads it with', () => {
    expect(parseLayerStack(file, 5, 3)).toEqual(packing.layers)
  })

  it('is refused when its grid is not the one the level parsed to', () => {
    expect(parseLayerStack(file, 6, 3)).toBeNull()
    expect(parseLayerStack(file, 5, 4)).toBeNull()
  })

  const stack = (...layers: unknown[]) => ({ width: 3, height: 3, layers })
  const builtIns = DEFAULT_LAYER_STACK.map((layer) =>
    layer.kind === 'builtIn' ? { builtIn: layer.id } : null,
  )

  it('is refused when a cell is outside the grid it claims', () => {
    expect(
      parseLayerStack(stack(...builtIns, { name: 'a', tiles: { 9: 6 } }), 3, 3),
    ).toBeNull()
  })

  /**
   * Unlike the editor's own storage, the bundle has no older shape to be kind
   * to: a stack missing a built-in, doubling one, or naming one this build does
   * not know is a broken bundle, and the level plays in the default order.
   */
  it('is refused unless every built-in is there exactly once', () => {
    expect(parseLayerStack(stack(...builtIns.slice(1)), 3, 3)).toBeNull()
    expect(
      parseLayerStack(stack(...builtIns, { builtIn: 'floor' }), 3, 3),
    ).toBeNull()
    expect(
      parseLayerStack(stack(...builtIns, { builtIn: 'lava' }), 3, 3),
    ).toBeNull()
    expect(parseLayerStack(stack(...builtIns), 3, 3)).toEqual(
      DEFAULT_LAYER_STACK,
    )
  })

  it('is refused when an art tile is not a column', () => {
    expect(
      parseLayerStack(
        stack(...builtIns, { name: 'a', tiles: { 4: { column: 6 } } }),
        3,
        3,
      ),
    ).toBeNull()
    expect(
      parseLayerStack(stack(...builtIns, { tiles: { 4: 6 } }), 3, 3),
    ).toBeNull()
  })
})
