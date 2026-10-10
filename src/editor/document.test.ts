import { describe, expect, it } from 'vitest'
import { xsb } from '../core/test-helpers'
import {
  clearCustomTile,
  clearCustomTiles,
  createEmptyDocument,
  isCellOverwritten,
  MAX_DOCUMENT_SIZE,
  MIN_DOCUMENT_SIZE,
  NO_GROUND_COLOR,
  paintDocument,
  recolorCustomTile,
  resizeDocument,
  setCustomTile,
  setGroundColor,
  swapCustomTileMode,
} from './document'
import { NO_TINT, type Tint } from './tint'
import { formatDocumentAsXsb, parseXsbToDocument } from './xsb'

const positionOf = (width: number, x: number, y: number) => y * width + x

const GREEN: Tint = { color: '#55aa33', mode: 'flat', background: null }

describe('createEmptyDocument', () => {
  it('starts as solid wall, so drawing carves a room out', () => {
    expect(formatDocumentAsXsb(createEmptyDocument(3, 3))).toBe(
      xsb('###', '###', '###'),
    )
  })

  it('clamps the size to the editor limits', () => {
    expect(createEmptyDocument(1, 1).width).toBe(MIN_DOCUMENT_SIZE)
    expect(createEmptyDocument(9999, 9999).height).toBe(MAX_DOCUMENT_SIZE)
  })
})

describe('paintDocument', () => {
  it('layers a goal under an existing box', () => {
    const start = parseXsbToDocument(xsb('###', '#$#', '###'))
    const painted = paintDocument(start, positionOf(3, 1, 1), 'goal')

    expect(formatDocumentAsXsb(painted)).toBe(xsb('###', '#*#', '###'))
  })

  it('keeps the goal when a box is painted onto it', () => {
    const start = parseXsbToDocument(xsb('###', '#.#', '###'))
    const painted = paintDocument(start, positionOf(3, 1, 1), 'box')

    expect(formatDocumentAsXsb(painted)).toBe(xsb('###', '#*#', '###'))
  })

  it('moves the player rather than adding a second one', () => {
    const start = parseXsbToDocument(xsb('####', '#@ #', '####'))
    const painted = paintDocument(start, positionOf(4, 2, 1), 'player')

    expect(formatDocumentAsXsb(painted)).toBe(xsb('####', '# @#', '####'))
  })

  it('clears everything when wall is painted over a box on a goal', () => {
    const start = parseXsbToDocument(xsb('###', '#*#', '###'))
    const painted = paintDocument(start, positionOf(3, 1, 1), 'wall')

    expect(formatDocumentAsXsb(painted)).toBe(xsb('###', '###', '###'))
  })

  it('treats floor as the eraser', () => {
    const start = parseXsbToDocument(xsb('###', '#*#', '###'))
    const painted = paintDocument(start, positionOf(3, 1, 1), 'floor')

    expect(formatDocumentAsXsb(painted)).toBe(xsb('###', '# #', '###'))
  })

  it('returns the same document when the cell already looks like that', () => {
    const start = parseXsbToDocument(xsb('###', '#$#', '###'))

    expect(paintDocument(start, positionOf(3, 1, 1), 'box')).toBe(start)
  })

  it('returns the same document for a position off the grid', () => {
    const start = createEmptyDocument(3, 3)

    expect(paintDocument(start, -1, 'floor')).toBe(start)
    expect(paintDocument(start, 9, 'floor')).toBe(start)
  })
})

describe('resizeDocument', () => {
  it('keeps the top-left corner and pads with wall', () => {
    const start = parseXsbToDocument(xsb('####', '#@ #', '####'))

    expect(formatDocumentAsXsb(resizeDocument(start, 5, 4))).toBe(
      xsb('#####', '#@ ##', '#####', '#####'),
    )
  })

  it('crops the far edge when it shrinks', () => {
    const start = parseXsbToDocument(xsb('#####', '#@$.#', '#####'))

    expect(formatDocumentAsXsb(resizeDocument(start, 3, 3))).toBe(
      xsb('###', '#@$', '###'),
    )
  })

  it('returns the same document when the size is unchanged', () => {
    const start = createEmptyDocument(4, 4)

    expect(resizeDocument(start, 4, 4)).toBe(start)
  })

  it('keeps every custom tile on its own cell when the width changes', () => {
    const start = setCustomTile(
      setCustomTile(
        createEmptyDocument(4, 4),
        positionOf(4, 3, 0),
        7,
        'onTop',
        NO_TINT,
      ),
      positionOf(4, 1, 2),
      9,
      'overwrite',
      GREEN,
    )

    const widened = resizeDocument(start, 6, 4)

    expect(widened.customTiles.get(positionOf(6, 3, 0))).toEqual({
      tileIndex: 7,
      mode: 'onTop',
      tint: NO_TINT,
    })
    // The ink rides along with the rest of the placement: it is part of what
    // that cell looks like, not something keyed by position.
    expect(widened.customTiles.get(positionOf(6, 1, 2))).toEqual({
      tileIndex: 9,
      mode: 'overwrite',
      tint: GREEN,
    })
    expect(widened.customTiles.size).toBe(2)
  })

  it('drops a custom tile the resize cropped away', () => {
    const start = setCustomTile(
      createEmptyDocument(6, 6),
      positionOf(6, 5, 5),
      7,
      'onTop',
      NO_TINT,
    )

    expect(resizeDocument(start, 4, 4).customTiles.size).toBe(0)
  })
})

describe('custom tiles', () => {
  const start = createEmptyDocument(3, 3)
  const middle = positionOf(3, 1, 1)

  it('places a tile on one cell and takes it off again', () => {
    const placed = setCustomTile(start, middle, 7, 'onTop', NO_TINT)

    expect(placed.customTiles.get(middle)).toEqual({
      tileIndex: 7,
      mode: 'onTop',
      tint: NO_TINT,
    })
    expect(clearCustomTile(placed, middle).customTiles.size).toBe(0)
  })

  it('leaves the cells alone, so a placement is art and not level structure', () => {
    expect(setCustomTile(start, middle, 7, 'overwrite', GREEN).cells).toBe(
      start.cells,
    )
  })

  it('returns the same document when nothing would change', () => {
    const placed = setCustomTile(start, middle, 7, 'onTop', NO_TINT)

    expect(setCustomTile(placed, middle, 7, 'onTop', NO_TINT)).toBe(placed)
    expect(clearCustomTile(start, middle)).toBe(start)
    expect(clearCustomTiles(start)).toBe(start)
  })

  it('counts a changed mode as a change, with the same tile', () => {
    const placed = setCustomTile(start, middle, 7, 'onTop', NO_TINT)
    const overwriting = setCustomTile(placed, middle, 7, 'overwrite', NO_TINT)

    expect(overwriting).not.toBe(placed)
    expect(isCellOverwritten(overwriting, middle)).toBe(true)
  })

  it('counts a changed ink as a change, with the same tile and mode', () => {
    const placed = setCustomTile(start, middle, 7, 'onTop', NO_TINT)
    const inked = setCustomTile(placed, middle, 7, 'onTop', GREEN)

    expect(inked).not.toBe(placed)
    expect(inked.customTiles.get(middle)?.tint).toEqual(GREEN)
  })

  it('refuses a position off the grid and an index that is not one', () => {
    expect(setCustomTile(start, -1, 7, 'onTop', NO_TINT)).toBe(start)
    expect(setCustomTile(start, 9, 7, 'onTop', NO_TINT)).toBe(start)
    expect(setCustomTile(start, middle, -1, 'onTop', NO_TINT)).toBe(start)
    expect(setCustomTile(start, middle, 1.5, 'onTop', NO_TINT)).toBe(start)
  })
})

describe('setGroundColor', () => {
  const start = createEmptyDocument(3, 3)

  it('sets the colour under the board and takes it off again', () => {
    const grounded = setGroundColor(start, '#102030')

    expect(start.groundColor).toBe(NO_GROUND_COLOR)
    expect(grounded.groundColor).toBe('#102030')
    expect(setGroundColor(grounded, NO_GROUND_COLOR).groundColor).toBe(
      NO_GROUND_COLOR,
    )
  })

  it('leaves the cells and the placements alone — it is a backdrop, not a tile', () => {
    const placed = setCustomTile(start, 4, 7, 'onTop', GREEN)
    const grounded = setGroundColor(placed, '#102030')

    expect(grounded.cells).toBe(placed.cells)
    expect(grounded.customTiles).toBe(placed.customTiles)
  })

  it('returns the same document when the ground is already that', () => {
    const grounded = setGroundColor(start, '#102030')

    expect(setGroundColor(grounded, '#102030')).toBe(grounded)
    expect(setGroundColor(start, NO_GROUND_COLOR)).toBe(start)
  })

  /**
   * Unlike a placement, the ground is not an index into anything, so a resize
   * has nothing to rewrite and nothing to drop.
   */
  it('survives a resize', () => {
    expect(
      resizeDocument(setGroundColor(start, '#102030'), 8, 8).groundColor,
    ).toBe('#102030')
  })
})

describe('swapCustomTileMode', () => {
  const start = createEmptyDocument(3, 3)
  const middle = positionOf(3, 1, 1)

  it('flips the mode both ways and leaves the tile and its ink alone', () => {
    const placed = setCustomTile(start, middle, 7, 'onTop', GREEN)
    const overwriting = swapCustomTileMode(placed, middle)

    expect(overwriting.customTiles.get(middle)).toEqual({
      tileIndex: 7,
      mode: 'overwrite',
      tint: GREEN,
    })
    expect(
      swapCustomTileMode(overwriting, middle).customTiles.get(middle),
    ).toEqual({ tileIndex: 7, mode: 'onTop', tint: GREEN })
  })

  it('returns the same document for a cell with no tile placed', () => {
    expect(swapCustomTileMode(start, middle)).toBe(start)
    expect(swapCustomTileMode(start, -1)).toBe(start)
  })
})

describe('recolorCustomTile', () => {
  const start = createEmptyDocument(3, 3)
  const middle = positionOf(3, 1, 1)

  it('repaints a placement and leaves its tile and mode alone', () => {
    const placed = setCustomTile(start, middle, 7, 'overwrite', NO_TINT)

    expect(
      recolorCustomTile(placed, middle, GREEN).customTiles.get(middle),
    ).toEqual({ tileIndex: 7, mode: 'overwrite', tint: GREEN })
  })

  /**
   * Unlike swapping, recolouring is idempotent — which is what lets it be
   * dragged across a row of cells without flickering back and forth.
   */
  it('returns the same document when the ink is already that', () => {
    const inked = setCustomTile(start, middle, 7, 'onTop', GREEN)

    expect(recolorCustomTile(inked, middle, GREEN)).toBe(inked)
  })

  it('does not put art down on a cell that has none', () => {
    expect(recolorCustomTile(start, middle, GREEN)).toBe(start)
    expect(recolorCustomTile(start, -1, GREEN)).toBe(start)
  })
})
