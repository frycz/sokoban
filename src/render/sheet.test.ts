import { describe, expect, it } from 'vitest'
import {
  clampSheetSettings,
  getSheetGrid,
  getSourceTileRect,
  type SheetSettings,
} from './sheet'

const plain: SheetSettings = {
  tileWidth: 32,
  tileHeight: 32,
  margin: 0,
  spacing: 0,
}

const bordered: SheetSettings = {
  tileWidth: 32,
  tileHeight: 32,
  margin: 1,
  spacing: 1,
}

describe('getSheetGrid', () => {
  it('slices an edge-to-edge sheet', () => {
    expect(getSheetGrid(plain, 128, 64)).toEqual({
      columns: 4,
      rows: 2,
      tileCount: 8,
    })
  })

  it('accounts for a margin and gutters', () => {
    // 1 + 32 + 1 + 32 + 1 + 32 = 99 across, two rows the same way.
    expect(getSheetGrid(bordered, 99, 66)).toEqual({
      columns: 3,
      rows: 2,
      tileCount: 6,
    })
  })

  it('ignores a trailing partial tile', () => {
    expect(getSheetGrid(plain, 80, 32).columns).toBe(2)
  })

  it('finds nothing in a sheet smaller than one tile', () => {
    expect(getSheetGrid(plain, 31, 31)).toEqual({
      columns: 0,
      rows: 0,
      tileCount: 0,
    })
  })
})

describe('getSourceTileRect', () => {
  it('walks across then down', () => {
    const grid = getSheetGrid(plain, 128, 64)

    expect(getSourceTileRect(plain, grid, 0)).toEqual({
      x: 0,
      y: 0,
      width: 32,
      height: 32,
    })
    expect(getSourceTileRect(plain, grid, 5)).toEqual({
      x: 32,
      y: 32,
      width: 32,
      height: 32,
    })
  })

  it('offsets by the margin and gutters', () => {
    const grid = getSheetGrid(bordered, 99, 66)

    expect(getSourceTileRect(bordered, grid, 4)).toEqual({
      x: 34,
      y: 34,
      width: 32,
      height: 32,
    })
  })

  it('returns an empty rect for an index off the sheet', () => {
    const grid = getSheetGrid(plain, 128, 64)

    expect(getSourceTileRect(plain, grid, 8).width).toBe(0)
    expect(getSourceTileRect(plain, grid, -1).width).toBe(0)
  })
})

describe('clampSheetSettings', () => {
  it('keeps a tile at least one pixel and a margin at least zero', () => {
    expect(
      clampSheetSettings({
        tileWidth: 0,
        tileHeight: -4,
        margin: -1,
        spacing: -2,
      }),
    ).toEqual({ tileWidth: 1, tileHeight: 1, margin: 0, spacing: 0 })
  })

  it('falls back to the default for a blank input', () => {
    expect(
      clampSheetSettings({
        tileWidth: Number.NaN,
        tileHeight: Number.NaN,
        margin: Number.NaN,
        spacing: Number.NaN,
      }),
    ).toEqual({ tileWidth: 32, tileHeight: 32, margin: 0, spacing: 0 })
  })
})
