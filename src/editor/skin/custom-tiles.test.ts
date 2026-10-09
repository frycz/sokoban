import { describe, expect, it } from 'vitest'
import { parseCustomTileMap } from '../../render/custom-tiles'
import type { CustomTiles } from '../document'
import { NO_TINT, type Tint } from '../tint'
import {
  countOverwrites,
  countTinted,
  formatCustomTilesFile,
  packCustomTiles,
} from './custom-tiles'
import { bindRole, createEmptySkinDraft, type SkinDraft } from './skin'

const GREEN: Tint = { color: '#55aa33', mode: 'flat' }
const RED: Tint = { color: '#cc3322', mode: 'flat' }

/** Six bound roles, so the custom columns start at 6. */
const DRAFT: SkinDraft = (
  ['floor', 'goal', 'wall', 'box', 'boxOnGoal', 'player'] as const
).reduce((draft, role, index) => bindRole(draft, role, index), {
  ...createEmptySkinDraft(),
  name: 'mossy stone',
})

const TILE_COUNT = 64

/** Positions to untinted on-top placements, which is the common case. */
function onTop(entries: readonly (readonly [number, number])[]): CustomTiles {
  return new Map(
    entries.map(([position, tileIndex]) => [
      position,
      { tileIndex, mode: 'onTop' as const, tint: NO_TINT },
    ]),
  )
}

describe('packCustomTiles', () => {
  it('gives one column per distinct tile, after the role columns', () => {
    const packing = packCustomTiles(
      DRAFT,
      onTop([
        [4, 20],
        [5, 11],
        [9, 20],
      ]),
      TILE_COUNT,
    )

    // Ascending sheet index, so the same level exports the same atlas however
    // the cells were drawn.
    expect(packing.columns).toEqual([
      { tileIndex: 11, tint: NO_TINT },
      { tileIndex: 20, tint: NO_TINT },
    ])
    expect([...packing.placementOfPosition]).toEqual([
      [4, { column: 7, mode: 'onTop' }],
      [5, { column: 6, mode: 'onTop' }],
      [9, { column: 7, mode: 'onTop' }],
    ])
  })

  /**
   * The mode is the cell's, not the tile's: two cells can share one column and
   * still do different things to the skin under them.
   */
  it('keeps each cell its own mode while sharing a column', () => {
    const packing = packCustomTiles(
      DRAFT,
      new Map([
        [4, { tileIndex: 20, mode: 'onTop', tint: NO_TINT }],
        [5, { tileIndex: 20, mode: 'overwrite', tint: NO_TINT }],
      ]),
      TILE_COUNT,
    )

    expect(packing.columns).toEqual([{ tileIndex: 20, tint: NO_TINT }])
    expect([...packing.placementOfPosition]).toEqual([
      [4, { column: 6, mode: 'onTop' }],
      [5, { column: 6, mode: 'overwrite' }],
    ])
  })

  /**
   * The ink *is* part of the column, unlike the mode, because the colour is
   * baked into the atlas rather than carried in `tiles.json`. So one sprite in
   * two inks costs two columns — and the file still says nothing about colour.
   */
  it('gives one tile in two inks a column each', () => {
    const packing = packCustomTiles(
      DRAFT,
      new Map([
        [4, { tileIndex: 20, mode: 'onTop', tint: RED }],
        [5, { tileIndex: 20, mode: 'onTop', tint: GREEN }],
        [6, { tileIndex: 20, mode: 'overwrite', tint: RED }],
      ]),
      TILE_COUNT,
    )

    // Ordered by ink within the index, so the atlas is stable whatever order
    // the cells were painted in.
    expect(packing.columns).toEqual([
      { tileIndex: 20, tint: GREEN },
      { tileIndex: 20, tint: RED },
    ])
    expect([...packing.placementOfPosition]).toEqual([
      [4, { column: 7, mode: 'onTop' }],
      [5, { column: 6, mode: 'onTop' }],
      [6, { column: 7, mode: 'overwrite' }],
    ])
  })

  it('shares one column between cells that agree on both tile and ink', () => {
    const packing = packCustomTiles(
      DRAFT,
      new Map([
        [4, { tileIndex: 20, mode: 'onTop', tint: GREEN }],
        [5, { tileIndex: 20, mode: 'onTop', tint: GREEN }],
      ]),
      TILE_COUNT,
    )

    expect(packing.columns).toEqual([{ tileIndex: 20, tint: GREEN }])
  })

  it('drops a placement whose tile is off the sheet', () => {
    const packing = packCustomTiles(
      DRAFT,
      onTop([
        [4, 3],
        [5, TILE_COUNT],
      ]),
      TILE_COUNT,
    )

    expect(packing.columns).toEqual([{ tileIndex: 3, tint: NO_TINT }])
    expect([...packing.placementOfPosition]).toEqual([
      [4, { column: 6, mode: 'onTop' }],
    ])
  })

  it('packs nothing when no cell has a tile', () => {
    const packing = packCustomTiles(DRAFT, new Map(), TILE_COUNT)

    expect(packing.columns).toEqual([])
    expect(packing.placementOfPosition.size).toBe(0)
  })
})

describe('countOverwrites', () => {
  it('counts only the placements that replace the skin', () => {
    expect(
      countOverwrites(
        new Map([
          [4, { tileIndex: 1, mode: 'onTop', tint: NO_TINT }],
          [5, { tileIndex: 2, mode: 'overwrite', tint: NO_TINT }],
          [6, { tileIndex: 3, mode: 'overwrite', tint: NO_TINT }],
        ]),
      ),
    ).toBe(2)
  })
})

describe('countTinted', () => {
  it('counts only the placements carrying an ink', () => {
    expect(
      countTinted(
        new Map([
          [4, { tileIndex: 1, mode: 'onTop', tint: NO_TINT }],
          [5, { tileIndex: 2, mode: 'onTop', tint: GREEN }],
          [6, { tileIndex: 3, mode: 'overwrite', tint: RED }],
        ]),
      ),
    ).toBe(2)
  })

  /** Multiplying by white is what "no ink" is, not a colour anyone picked. */
  it('does not count a multiply back to white', () => {
    expect(
      countTinted(
        new Map([
          [
            4,
            {
              tileIndex: 1,
              mode: 'onTop',
              tint: { color: '#ffffff', mode: 'multiply' },
            },
          ],
        ]),
      ),
    ).toBe(0)
  })

  /** A flat white is a real repaint: it turns coloured art into a silhouette. */
  it('counts a flat white, which is not a no-op', () => {
    expect(
      countTinted(
        new Map([
          [
            4,
            {
              tileIndex: 1,
              mode: 'onTop',
              tint: { color: '#ffffff', mode: 'flat' },
            },
          ],
        ]),
      ),
    ).toBe(1)
  })
})

/**
 * The seam: what the editor writes is what the game reads. A bundle is only
 * correct if the columns survive the file, so this asserts both halves against
 * each other rather than either against a literal.
 */
describe('tiles.json', () => {
  const packing = packCustomTiles(
    DRAFT,
    new Map([
      [4, { tileIndex: 20, mode: 'onTop', tint: GREEN }],
      [5, { tileIndex: 11, mode: 'overwrite', tint: NO_TINT }],
    ]),
    TILE_COUNT,
  )

  /** As the game gets it: the file read back off disk, not the packing. */
  const file: unknown = JSON.parse(formatCustomTilesFile(5, 3, packing))

  it('round-trips through the parser the game reads it with', () => {
    const parsed = parseCustomTileMap(file, 5, 3)

    expect(parsed && [...parsed]).toEqual([...packing.placementOfPosition])
  })

  it('is refused when its grid is not the one the level parsed to', () => {
    expect(parseCustomTileMap(file, 6, 3)).toBeNull()
    expect(parseCustomTileMap(file, 5, 4)).toBeNull()
  })

  it('is refused when a cell is outside the grid it claims', () => {
    expect(
      parseCustomTileMap(
        { width: 3, height: 3, tiles: { 9: { column: 6, mode: 'onTop' } } },
        3,
        3,
      ),
    ).toBeNull()
  })

  /**
   * Unlike the editor's own storage, the bundle has no older shape to be kind
   * to: a file without a mode, or with one this build does not know, is a
   * broken bundle and the level plays without its custom tiles.
   */
  it('is refused when a placement does not spell a mode it knows', () => {
    const tiles = (entry: unknown) => ({
      width: 3,
      height: 3,
      tiles: { 4: entry },
    })

    expect(parseCustomTileMap(tiles({ column: 6 }), 3, 3)).toBeNull()
    expect(
      parseCustomTileMap(tiles({ column: 6, mode: 'under' }), 3, 3),
    ).toBeNull()
    expect(parseCustomTileMap(tiles(6), 3, 3)).toBeNull()
  })
})
