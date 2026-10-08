import { describe, expect, it } from 'vitest'
import { xsb } from '../core/test-helpers'
import {
  clearCustomTile,
  clearCustomTiles,
  createEmptyDocument,
  MAX_DOCUMENT_SIZE,
  MIN_DOCUMENT_SIZE,
  paintDocument,
  resizeDocument,
  setCustomTile,
} from './document'
import { formatDocumentAsXsb, parseXsbToDocument } from './xsb'

const positionOf = (width: number, x: number, y: number) => y * width + x

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
      setCustomTile(createEmptyDocument(4, 4), positionOf(4, 3, 0), 7),
      positionOf(4, 1, 2),
      9,
    )

    const widened = resizeDocument(start, 6, 4)

    expect(widened.customTiles.get(positionOf(6, 3, 0))).toBe(7)
    expect(widened.customTiles.get(positionOf(6, 1, 2))).toBe(9)
    expect(widened.customTiles.size).toBe(2)
  })

  it('drops a custom tile the resize cropped away', () => {
    const start = setCustomTile(
      createEmptyDocument(6, 6),
      positionOf(6, 5, 5),
      7,
    )

    expect(resizeDocument(start, 4, 4).customTiles.size).toBe(0)
  })
})

describe('custom tiles', () => {
  const start = createEmptyDocument(3, 3)
  const middle = positionOf(3, 1, 1)

  it('places a tile on one cell and takes it off again', () => {
    const placed = setCustomTile(start, middle, 7)

    expect(placed.customTiles.get(middle)).toBe(7)
    expect(clearCustomTile(placed, middle).customTiles.size).toBe(0)
  })

  it('leaves the cells alone, so a placement is art and not level structure', () => {
    expect(setCustomTile(start, middle, 7).cells).toBe(start.cells)
  })

  it('returns the same document when nothing would change', () => {
    const placed = setCustomTile(start, middle, 7)

    expect(setCustomTile(placed, middle, 7)).toBe(placed)
    expect(clearCustomTile(start, middle)).toBe(start)
    expect(clearCustomTiles(start)).toBe(start)
  })

  it('refuses a position off the grid and an index that is not one', () => {
    expect(setCustomTile(start, -1, 7)).toBe(start)
    expect(setCustomTile(start, 9, 7)).toBe(start)
    expect(setCustomTile(start, middle, -1)).toBe(start)
    expect(setCustomTile(start, middle, 1.5)).toBe(start)
  })
})
