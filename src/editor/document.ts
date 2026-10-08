import { getPositionFromCoordinates } from '../core/rules'

/** What sits on a floor cell. A wall always holds nothing. */
type CellContent = 'empty' | 'box' | 'player'

export type Cell = {
  readonly isWall: boolean
  readonly isGoal: boolean
  readonly content: CellContent
}

/**
 * Position → tile index in the sheet skin mode has loaded, for the cells whose
 * art the author has placed by hand instead of letting the skin decide.
 *
 * It is level data that names skin data. The placement belongs to the level the
 * way a wall does — it survives a resize and rides on the undo stack — but the
 * index only means something against the sheet it was picked from, which is why
 * loading or re-slicing a sheet clears it exactly as it clears the bindings.
 */
export type CustomTiles = ReadonlyMap<number, number>

export const NO_CUSTOM_TILES: CustomTiles = new Map()

/**
 * A level being drawn. Unlike `LevelState` this is deliberately allowed to be
 * invalid — no player, more boxes than goals, nothing sealed — because that is
 * what every level looks like halfway through. `validate.ts` judges a document;
 * nothing in this file rejects one.
 */
export type EditorDocument = {
  readonly width: number
  readonly height: number
  readonly cells: readonly Cell[]
  readonly customTiles: CustomTiles
}

/**
 * The palette. `wall` and `floor` replace a cell outright, so `floor` is also
 * the eraser; the other three layer onto whatever floor is already there.
 */
export type Brush = 'wall' | 'floor' | 'goal' | 'box' | 'player'

export const WALL_CELL: Cell = { isWall: true, isGoal: false, content: 'empty' }

export const FLOOR_CELL: Cell = {
  isWall: false,
  isGoal: false,
  content: 'empty',
}

export const MIN_DOCUMENT_SIZE = 3
export const MAX_DOCUMENT_SIZE = 64

export const DEFAULT_DOCUMENT_WIDTH = 16
export const DEFAULT_DOCUMENT_HEIGHT = 12

/**
 * Only the size controls clamp. Loading does not, so a level wider than the
 * editor's own limit still opens rather than being silently cropped.
 */
function clampDocumentSize(size: number): number {
  if (!Number.isFinite(size)) {
    return MIN_DOCUMENT_SIZE
  }

  return Math.max(
    MIN_DOCUMENT_SIZE,
    Math.min(MAX_DOCUMENT_SIZE, Math.floor(size)),
  )
}

export function createEmptyDocument(
  width: number,
  height: number,
): EditorDocument {
  const clampedWidth = clampDocumentSize(width)
  const clampedHeight = clampDocumentSize(height)

  // All wall, so the level is sealed by construction and drawing floor carves
  // a room out of solid rock rather than requiring a border to be traced.
  return {
    width: clampedWidth,
    height: clampedHeight,
    cells: new Array<Cell>(clampedWidth * clampedHeight).fill(WALL_CELL),
    customTiles: NO_CUSTOM_TILES,
  }
}

/** A blank level at the size the editor opens on. */
export function createEmptyLevelDocument(): EditorDocument {
  return createEmptyDocument(DEFAULT_DOCUMENT_WIDTH, DEFAULT_DOCUMENT_HEIGHT)
}

export function getCellX(
  editorDocument: EditorDocument,
  position: number,
): number {
  return position % editorDocument.width
}

export function getCellY(
  editorDocument: EditorDocument,
  position: number,
): number {
  return Math.floor(position / editorDocument.width)
}

function isSameCell(cell: Cell, other: Cell): boolean {
  return (
    cell.isWall === other.isWall &&
    cell.isGoal === other.isGoal &&
    cell.content === other.content
  )
}

function applyBrushToCell(cell: Cell, brush: Brush): Cell {
  switch (brush) {
    case 'wall':
      return WALL_CELL
    case 'floor':
      return FLOOR_CELL
    case 'goal':
      return { ...cell, isWall: false, isGoal: true }
    case 'box':
      return { ...cell, isWall: false, content: 'box' }
    case 'player':
      return { ...cell, isWall: false, content: 'player' }
  }
}

/**
 * Returns the same document when nothing changed, so callers can test for a
 * no-op by identity the way the host does with `step`.
 */
export function paintDocument(
  editorDocument: EditorDocument,
  position: number,
  brush: Brush,
): EditorDocument {
  if (position < 0 || position >= editorDocument.cells.length) {
    return editorDocument
  }

  const currentCell = editorDocument.cells[position]
  const paintedCell = applyBrushToCell(currentCell, brush)

  if (isSameCell(currentCell, paintedCell)) {
    return editorDocument
  }

  const cells = [...editorDocument.cells]
  cells[position] = paintedCell

  // One player only: painting a player moves the existing one rather than
  // adding a second, so the single-player rule is an invariant of the document
  // instead of something validation has to police.
  if (paintedCell.content === 'player') {
    for (let other = 0; other < cells.length; other++) {
      if (other !== position && cells[other].content === 'player') {
        cells[other] = { ...cells[other], content: 'empty' }
      }
    }
  }

  return { ...editorDocument, cells }
}

/**
 * A tile placed by hand on one cell, over whatever the skin would have drawn
 * there. Returns the same document when that cell already holds that tile, so a
 * drag across a row of already-placed cells records nothing — the identity
 * contract `paintDocument` has.
 *
 * A negative index is ignored rather than stored: it is what "no tile is
 * selected" looks like in skin mode, and `UNBOUND` is not a placement.
 */
export function setCustomTile(
  editorDocument: EditorDocument,
  position: number,
  tileIndex: number,
): EditorDocument {
  if (position < 0 || position >= editorDocument.cells.length) {
    return editorDocument
  }

  if (!Number.isInteger(tileIndex) || tileIndex < 0) {
    return editorDocument
  }

  if (editorDocument.customTiles.get(position) === tileIndex) {
    return editorDocument
  }

  const customTiles = new Map(editorDocument.customTiles)
  customTiles.set(position, tileIndex)

  return { ...editorDocument, customTiles }
}

export function clearCustomTile(
  editorDocument: EditorDocument,
  position: number,
): EditorDocument {
  if (!editorDocument.customTiles.has(position)) {
    return editorDocument
  }

  const customTiles = new Map(editorDocument.customTiles)
  customTiles.delete(position)

  return { ...editorDocument, customTiles }
}

export function clearCustomTiles(
  editorDocument: EditorDocument,
): EditorDocument {
  if (editorDocument.customTiles.size === 0) {
    return editorDocument
  }

  return { ...editorDocument, customTiles: NO_CUSTOM_TILES }
}

/** Keeps the top-left corner and pads any new rows or columns with wall. */
export function resizeDocument(
  editorDocument: EditorDocument,
  width: number,
  height: number,
): EditorDocument {
  const clampedWidth = clampDocumentSize(width)
  const clampedHeight = clampDocumentSize(height)

  if (
    clampedWidth === editorDocument.width &&
    clampedHeight === editorDocument.height
  ) {
    return editorDocument
  }

  const cells = new Array<Cell>(clampedWidth * clampedHeight).fill(WALL_CELL)
  const keptWidth = Math.min(clampedWidth, editorDocument.width)
  const keptHeight = Math.min(clampedHeight, editorDocument.height)

  for (let y = 0; y < keptHeight; y++) {
    for (let x = 0; x < keptWidth; x++) {
      cells[getPositionFromCoordinates(x, y, clampedWidth)] =
        editorDocument.cells[
          getPositionFromCoordinates(x, y, editorDocument.width)
        ]
    }
  }

  // A position is an index into one grid, so every placement has to be rewritten
  // against the new width or it would land on a different cell. Anchored at the
  // top-left like the cells, and dropped rather than clamped when it falls
  // outside what the resize kept.
  const customTiles = new Map<number, number>()

  for (const [position, tileIndex] of editorDocument.customTiles) {
    const x = getCellX(editorDocument, position)
    const y = getCellY(editorDocument, position)

    if (x < keptWidth && y < keptHeight) {
      customTiles.set(getPositionFromCoordinates(x, y, clampedWidth), tileIndex)
    }
  }

  return { width: clampedWidth, height: clampedHeight, cells, customTiles }
}

export function countCells(
  editorDocument: EditorDocument,
  predicate: (cell: Cell) => boolean,
): number {
  let count = 0

  for (const cell of editorDocument.cells) {
    if (predicate(cell)) {
      count++
    }
  }

  return count
}
