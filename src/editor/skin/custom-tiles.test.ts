import { describe, expect, it } from 'vitest'
import { parseCustomTileMap } from '../../render/skin'
import { formatCustomTilesFile, packCustomTiles } from './custom-tiles'
import { bindRole, createEmptySkinDraft, type SkinDraft } from './skin'

/** Six bound roles, so the custom columns start at 6. */
const DRAFT: SkinDraft = (
  ['floor', 'goal', 'wall', 'box', 'boxOnGoal', 'player'] as const
).reduce((draft, role, index) => bindRole(draft, role, index), {
  ...createEmptySkinDraft(),
  name: 'mossy stone',
})

const TILE_COUNT = 64

describe('packCustomTiles', () => {
  it('gives one column per distinct tile, after the role columns', () => {
    const packing = packCustomTiles(
      DRAFT,
      new Map([
        [4, 20],
        [5, 11],
        [9, 20],
      ]),
      TILE_COUNT,
    )

    // Ascending sheet index, so the same level exports the same atlas however
    // the cells were drawn.
    expect(packing.sheetTileIndices).toEqual([11, 20])
    expect([...packing.columnOfPosition]).toEqual([
      [4, 7],
      [5, 6],
      [9, 7],
    ])
  })

  it('drops a placement whose tile is off the sheet', () => {
    const packing = packCustomTiles(
      DRAFT,
      new Map([
        [4, 3],
        [5, TILE_COUNT],
      ]),
      TILE_COUNT,
    )

    expect(packing.sheetTileIndices).toEqual([3])
    expect([...packing.columnOfPosition]).toEqual([[4, 6]])
  })

  it('packs nothing when no cell has a tile', () => {
    const packing = packCustomTiles(DRAFT, new Map(), TILE_COUNT)

    expect(packing.sheetTileIndices).toEqual([])
    expect(packing.columnOfPosition.size).toBe(0)
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
      [4, 20],
      [5, 11],
    ]),
    TILE_COUNT,
  )

  /** As the game gets it: the file read back off disk, not the packing. */
  const file: unknown = JSON.parse(formatCustomTilesFile(5, 3, packing))

  it('round-trips through the parser the game reads it with', () => {
    const parsed = parseCustomTileMap(file, 5, 3)

    expect(parsed && [...parsed]).toEqual([...packing.columnOfPosition])
  })

  it('is refused when its grid is not the one the level parsed to', () => {
    expect(parseCustomTileMap(file, 6, 3)).toBeNull()
    expect(parseCustomTileMap(file, 5, 4)).toBeNull()
  })

  it('is refused when a cell is outside the grid it claims', () => {
    expect(
      parseCustomTileMap({ width: 3, height: 3, tiles: { 9: 6 } }, 3, 3),
    ).toBeNull()
  })
})
