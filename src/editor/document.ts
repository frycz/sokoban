import { getPositionFromCoordinates } from '../core/rules'
import type { CustomTileMode } from '../render/custom-tiles'
import { isSameTint, type Tint } from './tint'

/** What sits on a floor cell. A wall always holds nothing. */
type CellContent = 'empty' | 'box' | 'player'

export type Cell = {
  readonly isWall: boolean
  readonly isGoal: boolean
  readonly content: CellContent
}

/**
 * A tile the author put on one cell: which tile of the sheet skin mode has
 * loaded, and whether the skin still draws under it.
 *
 * The index is the editor's own currency and the game never sees it — the
 * export turns it into an atlas column — but the mode travels all the way
 * through, which is why its type is the one the bundle format uses.
 *
 * The ink goes the other way again: the game never sees it either, because by
 * the time it has the atlas the colour is already pixels. It is per cell rather
 * than per tile for the same reason the mode is — one sprite can be green here
 * and red there — and the export gives each distinct ink its own column.
 */
export type CustomTile = {
  readonly tileIndex: number
  readonly mode: CustomTileMode
  readonly tint: Tint
}

/**
 * Position → placement, for the cells whose art the author has placed by hand
 * instead of letting the skin decide.
 *
 * It is level data that names skin data. The placement belongs to the level the
 * way a wall does — it survives a resize and rides on the undo stack — but the
 * index only means something against the sheet it was picked from, which is why
 * loading or re-slicing a sheet clears it exactly as it clears the bindings.
 */
export type CustomTiles = ReadonlyMap<number, CustomTile>

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
  /**
   * The colour under the whole board, or null for none — see
   * `NO_GROUND_COLOR`.
   */
  readonly groundColor: string | null
}

/**
 * No ground, which is what a level has unless its author says otherwise: the
 * board is drawn onto nothing and keeps its silhouette against the page.
 *
 * Unlike a tint, "none" cannot be a colour that happens to change nothing — any
 * colour at all fills the cells the silhouette culls and backs every
 * transparent pixel — so this one really is an absence.
 */
export const NO_GROUND_COLOR = null

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
    groundColor: NO_GROUND_COLOR,
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
 * there. Returns the same document when that cell already holds exactly that
 * placement, so a drag across a row of already-placed cells records nothing —
 * the identity contract `paintDocument` has.
 *
 * A negative index is ignored rather than stored: it is what "no tile is
 * selected" looks like in skin mode, and `UNBOUND` is not a placement.
 */
export function setCustomTile(
  editorDocument: EditorDocument,
  position: number,
  tileIndex: number,
  mode: CustomTileMode,
  tint: Tint,
): EditorDocument {
  if (position < 0 || position >= editorDocument.cells.length) {
    return editorDocument
  }

  if (!Number.isInteger(tileIndex) || tileIndex < 0) {
    return editorDocument
  }

  const current = editorDocument.customTiles.get(position)

  if (
    current &&
    current.tileIndex === tileIndex &&
    current.mode === mode &&
    isSameTint(current.tint, tint)
  ) {
    return editorDocument
  }

  const customTiles = new Map(editorDocument.customTiles)
  customTiles.set(position, { tileIndex, mode, tint })

  return { ...editorDocument, customTiles }
}

/**
 * Repaints one placement and leaves its tile and its mode alone — the ink's
 * twin of `swapCustomTileMode`, and its own edit for the same reason:
 * re-stamping the cell to change the colour needs the original tile still
 * selected, and would quietly replace the art if it were not.
 *
 * Unlike swapping this is idempotent, so a drag over a row of cells settles
 * rather than flickering, and a cell with no placement is left alone: an ink
 * paints art that is there, it does not put art down.
 */
export function recolorCustomTile(
  editorDocument: EditorDocument,
  position: number,
  tint: Tint,
): EditorDocument {
  const current = editorDocument.customTiles.get(position)

  if (!current || isSameTint(current.tint, tint)) {
    return editorDocument
  }

  const customTiles = new Map(editorDocument.customTiles)
  customTiles.set(position, { ...current, tint })

  return { ...editorDocument, customTiles }
}

/**
 * Flips one placement between compositing over the skin and replacing it, and
 * leaves its tile alone. The way the choice is changed after the fact: the
 * alternative is re-stamping the cell, which needs the original tile still
 * selected to not also change the art.
 */
export function swapCustomTileMode(
  editorDocument: EditorDocument,
  position: number,
): EditorDocument {
  const current = editorDocument.customTiles.get(position)

  if (!current) {
    return editorDocument
  }

  const customTiles = new Map(editorDocument.customTiles)
  customTiles.set(position, {
    ...current,
    mode: current.mode === 'onTop' ? 'overwrite' : 'onTop',
  })

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

/**
 * The colour under the whole board, or `NO_GROUND_COLOR` for none. Returns the
 * same document when it already has that ground, so a colour input dragged back
 * to where it started records nothing — the identity contract every edit here
 * has.
 *
 * It is level data rather than skin data for the same reason a placement is: it
 * is this level's backdrop, it means the same against any sheet, and a level
 * published with an unfinished skin still has it. What it is not is a tile — no
 * art names it and nothing can bind it — which is why it sits beside the cells
 * rather than taking a role.
 */
export function setGroundColor(
  editorDocument: EditorDocument,
  groundColor: string | null,
): EditorDocument {
  if (groundColor === editorDocument.groundColor) {
    return editorDocument
  }

  return { ...editorDocument, groundColor }
}

/** Whether the skin's own layers are suppressed on this cell. */
export function isCellOverwritten(
  editorDocument: EditorDocument,
  position: number,
): boolean {
  return editorDocument.customTiles.get(position)?.mode === 'overwrite'
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
  const customTiles = new Map<number, CustomTile>()

  for (const [position, customTile] of editorDocument.customTiles) {
    const x = getCellX(editorDocument, position)
    const y = getCellY(editorDocument, position)

    if (x < keptWidth && y < keptHeight) {
      customTiles.set(
        getPositionFromCoordinates(x, y, clampedWidth),
        customTile,
      )
    }
  }

  return {
    width: clampedWidth,
    height: clampedHeight,
    cells,
    customTiles,
    groundColor: editorDocument.groundColor,
  }
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
