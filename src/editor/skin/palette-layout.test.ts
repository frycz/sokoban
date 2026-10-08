import { describe, expect, it } from 'vitest'
import { getSheetGrid, type SheetSettings } from '../../render/sheet'
import { computeSheetLayout, getTileIndexAtPixel } from './palette-layout'

const bordered: SheetSettings = {
  tileWidth: 32,
  tileHeight: 32,
  margin: 1,
  spacing: 1,
}

describe('getTileIndexAtPixel', () => {
  const grid = getSheetGrid(bordered, 99, 66)
  const layout = {
    scale: 1,
    originX: 0,
    originY: 0,
    contentWidth: 99,
    contentHeight: 66,
  }
  const at = (x: number, y: number) =>
    getTileIndexAtPixel(bordered, grid, layout, x, y)

  it('inverts the tile rect it was given', () => {
    expect(at(1, 1)).toBe(0)
    expect(at(34, 1)).toBe(1)
    expect(at(34, 34)).toBe(4)
  })

  it('selects nothing in a gutter', () => {
    // x = 33 is the one-pixel gap between the first and second columns.
    expect(at(33, 10)).toBe(-1)
  })

  it('selects nothing outside the sheet', () => {
    expect(at(-5, 10)).toBe(-1)
    expect(at(500, 10)).toBe(-1)
  })

  it('accounts for the display scale and origin', () => {
    expect(
      getTileIndexAtPixel(
        bordered,
        grid,
        {
          scale: 2,
          originX: 10,
          originY: 10,
          contentWidth: 218,
          contentHeight: 152,
        },
        10 + 34 * 2,
        10 + 1 * 2,
      ),
    ).toBe(1)
  })
})

describe('computeSheetLayout', () => {
  it('snaps an upscale to a whole number so pixel art stays crisp', () => {
    expect(computeSheetLayout(64, 64, 200, 200).scale).toBe(3)
  })

  it('shrinks by a fraction when the sheet is too big', () => {
    expect(computeSheetLayout(200, 200, 100, 100).scale).toBe(0.5)
  })

  it('centres the sheet in a canvas the size of the view', () => {
    expect(computeSheetLayout(64, 64, 200, 100)).toEqual({
      scale: 1,
      originX: 68,
      originY: 18,
      contentWidth: 200,
      contentHeight: 100,
    })
  })

  it('multiplies the fitted scale by the zoom', () => {
    // Fits at 3.125, so two steps in is 6.25 — snapped down to 6.
    expect(computeSheetLayout(64, 64, 200, 200, 2).scale).toBe(6)
  })

  it('grows the canvas past the view once zoomed in, so the view can pan', () => {
    expect(computeSheetLayout(64, 64, 200, 200, 2)).toEqual({
      scale: 6,
      originX: 0,
      originY: 0,
      contentWidth: 384,
      contentHeight: 384,
    })
  })

  it('still fills the view when zooming a sheet that is wider than it is tall', () => {
    const layout = computeSheetLayout(64, 32, 200, 200, 2)

    // 6× of 64×32 is 384×192, which is shorter than the 200px view.
    expect(layout.contentWidth).toBe(384)
    expect(layout.contentHeight).toBe(200)
    expect(layout.originY).toBe(4)
  })

  it('leaves the canvas at the view size with no sheet', () => {
    expect(computeSheetLayout(0, 0, 200, 100, 4)).toEqual({
      scale: 1,
      originX: 0,
      originY: 0,
      contentWidth: 200,
      contentHeight: 100,
    })
  })
})
