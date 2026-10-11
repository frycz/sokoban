import { describe, expect, it } from 'vitest'
import { xsb } from '../core/test-helpers'
import {
  addArtLayer,
  clearCustomTile,
  clearCustomTiles,
  createEmptyDocument,
  getArtLayer,
  MAX_DOCUMENT_SIZE,
  MIN_DOCUMENT_SIZE,
  NO_GROUND_COLOR,
  paintDocument,
  recolorCustomTile,
  moveLayer,
  removeArtLayer,
  renameArtLayer,
  resizeDocument,
  setCustomTile,
  setGroundColor,
  type CustomTile,
  type EditorDocument,
} from './document'
import { NO_TINT, type Tint } from './tint'
import { formatDocumentAsXsb, parseXsbToDocument } from './xsb'

const positionOf = (width: number, x: number, y: number) => y * width + x

const GREEN: Tint = { color: '#55aa33', mode: 'flat', background: null }

/** The art layer every new document starts with. */
const ART = 'art-1'

const tilesOf = (editorDocument: EditorDocument, layerId = ART) =>
  getArtLayer(editorDocument, layerId)?.tiles ?? new Map<number, CustomTile>()

const layerIdsOf = (editorDocument: EditorDocument) =>
  editorDocument.layers.map((layer) => layer.id)

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
        ART,
        positionOf(4, 3, 0),
        7,
        NO_TINT,
      ),
      ART,
      positionOf(4, 1, 2),
      9,
      GREEN,
    )

    const widened = resizeDocument(start, 6, 4)

    expect(tilesOf(widened).get(positionOf(6, 3, 0))).toEqual({
      tileIndex: 7,
      tint: NO_TINT,
    })
    // The ink rides along with the rest of the placement: it is part of what
    // that cell looks like, not something keyed by position.
    expect(tilesOf(widened).get(positionOf(6, 1, 2))).toEqual({
      tileIndex: 9,
      tint: GREEN,
    })
    expect(tilesOf(widened).size).toBe(2)
  })

  it('drops a custom tile the resize cropped away', () => {
    const start = setCustomTile(
      createEmptyDocument(6, 6),
      ART,
      positionOf(6, 5, 5),
      7,
      NO_TINT,
    )

    expect(tilesOf(resizeDocument(start, 4, 4)).size).toBe(0)
  })

  it('keeps the layer order and names through a resize', () => {
    const start = moveLayer(createEmptyDocument(4, 4), 'player', -1)

    expect(layerIdsOf(resizeDocument(start, 6, 6))).toEqual(layerIdsOf(start))
  })
})

describe('custom tiles', () => {
  const start = createEmptyDocument(3, 3)
  const middle = positionOf(3, 1, 1)

  it('places a tile on one cell and takes it off again', () => {
    const placed = setCustomTile(start, ART, middle, 7, NO_TINT)

    expect(tilesOf(placed).get(middle)).toEqual({ tileIndex: 7, tint: NO_TINT })
    expect(tilesOf(clearCustomTile(placed, ART, middle)).size).toBe(0)
  })

  it('leaves the cells alone, so a placement is art and not level structure', () => {
    expect(setCustomTile(start, ART, middle, 7, GREEN).cells).toBe(start.cells)
  })

  it('returns the same document when nothing would change', () => {
    const placed = setCustomTile(start, ART, middle, 7, NO_TINT)

    expect(setCustomTile(placed, ART, middle, 7, NO_TINT)).toBe(placed)
    expect(clearCustomTile(start, ART, middle)).toBe(start)
    expect(clearCustomTiles(start)).toBe(start)
  })

  it('counts a changed ink as a change, with the same tile', () => {
    const placed = setCustomTile(start, ART, middle, 7, NO_TINT)
    const inked = setCustomTile(placed, ART, middle, 7, GREEN)

    expect(inked).not.toBe(placed)
    expect(tilesOf(inked).get(middle)?.tint).toEqual(GREEN)
  })

  it('refuses a position off the grid and an index that is not one', () => {
    expect(setCustomTile(start, ART, -1, 7, NO_TINT)).toBe(start)
    expect(setCustomTile(start, ART, 9, 7, NO_TINT)).toBe(start)
    expect(setCustomTile(start, ART, middle, -1, NO_TINT)).toBe(start)
    expect(setCustomTile(start, ART, middle, 1.5, NO_TINT)).toBe(start)
  })

  /** A built-in layer is drawn from the cells, so there is nothing to paint. */
  it('refuses a built-in layer and one that does not exist', () => {
    expect(setCustomTile(start, 'walls', middle, 7, NO_TINT)).toBe(start)
    expect(setCustomTile(start, 'art-9', middle, 7, NO_TINT)).toBe(start)
  })

  it('keeps each layer its own tile on the same cell', () => {
    const twoLayers = addArtLayer(start, 'floor')
    const placed = setCustomTile(
      setCustomTile(twoLayers, ART, middle, 7, NO_TINT),
      'art-2',
      middle,
      3,
      NO_TINT,
    )

    expect(tilesOf(placed).get(middle)?.tileIndex).toBe(7)
    expect(tilesOf(placed, 'art-2').get(middle)?.tileIndex).toBe(3)
  })

  it('clears every art layer at once and keeps the layers', () => {
    const placed = setCustomTile(
      setCustomTile(addArtLayer(start, null), ART, middle, 7, NO_TINT),
      'art-2',
      middle,
      3,
      NO_TINT,
    )
    const cleared = clearCustomTiles(placed)

    expect(layerIdsOf(cleared)).toEqual(layerIdsOf(placed))
    expect(tilesOf(cleared).size + tilesOf(cleared, 'art-2').size).toBe(0)
  })
})

describe('layers', () => {
  const start = createEmptyDocument(3, 3)

  it('starts with the built-ins in the game order and one art layer on top', () => {
    expect(layerIdsOf(start)).toEqual([
      'floor',
      'walls',
      'goals',
      'boxes',
      'player',
      ART,
    ])
  })

  it('adds an art layer directly above the given one, with an unused id', () => {
    const added = addArtLayer(start, 'floor')

    expect(layerIdsOf(added).slice(0, 3)).toEqual(['floor', 'art-2', 'walls'])
    expect(layerIdsOf(addArtLayer(added, null)).at(-1)).toBe('art-3')
  })

  it('does not hand out an id twice, even after the highest is removed', () => {
    const added = addArtLayer(addArtLayer(start, null), null)
    const removed = removeArtLayer(added, 'art-2')

    expect(layerIdsOf(addArtLayer(removed, null)).at(-1)).toBe('art-4')
  })

  it('moves any layer, built-ins included, and stops at either end', () => {
    const moved = moveLayer(start, 'player', -1)

    expect(layerIdsOf(moved).slice(3, 5)).toEqual(['player', 'boxes'])
    expect(moveLayer(start, 'floor', -1)).toBe(start)
    expect(moveLayer(start, ART, 1)).toBe(start)
  })

  it('removes and renames art layers only', () => {
    expect(removeArtLayer(start, 'walls')).toBe(start)
    expect(layerIdsOf(removeArtLayer(start, ART))).not.toContain(ART)
    expect(renameArtLayer(start, 'walls', 'rock')).toBe(start)
    expect(getArtLayer(renameArtLayer(start, ART, 'rugs'), ART)?.name).toBe(
      'rugs',
    )
    expect(renameArtLayer(start, ART, 'tiles')).toBe(start)
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
    const placed = setCustomTile(start, ART, 4, 7, GREEN)
    const grounded = setGroundColor(placed, '#102030')

    expect(grounded.cells).toBe(placed.cells)
    expect(grounded.layers).toBe(placed.layers)
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

describe('recolorCustomTile', () => {
  const start = createEmptyDocument(3, 3)
  const middle = positionOf(3, 1, 1)

  it('repaints a placement and leaves its tile alone', () => {
    const placed = setCustomTile(start, ART, middle, 7, NO_TINT)

    expect(
      tilesOf(recolorCustomTile(placed, ART, middle, GREEN)).get(middle),
    ).toEqual({ tileIndex: 7, tint: GREEN })
  })

  /**
   * Recolouring is idempotent — which is what lets it be dragged across a row
   * of cells without flickering back and forth.
   */
  it('returns the same document when the ink is already that', () => {
    const inked = setCustomTile(start, ART, middle, 7, GREEN)

    expect(recolorCustomTile(inked, ART, middle, GREEN)).toBe(inked)
  })

  it('does not put art down on a cell that has none', () => {
    expect(recolorCustomTile(start, ART, middle, GREEN)).toBe(start)
    expect(recolorCustomTile(start, ART, -1, GREEN)).toBe(start)
  })
})
