import { describe, expect, it } from 'vitest'
import { xsb } from '../core/test-helpers'
import {
  createEmptyDocument,
  MAX_DOCUMENT_SIZE,
  MIN_DOCUMENT_SIZE,
  paintDocument,
  resizeDocument,
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
})
