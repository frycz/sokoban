import { getPositionFromCoordinates } from '../core/rules'
import { BUILT_IN_LAYERS, type BuiltInLayer } from '../render/layers'
import { isSameTint, type Tint } from './tint'

/** What sits on a floor cell. A wall always holds nothing. */
type CellContent = 'empty' | 'box' | 'player'

export type Cell = {
  readonly isWall: boolean
  readonly isGoal: boolean
  readonly content: CellContent
}

/**
 * A tile the author put on one cell of an art layer: which tile of the sheet
 * skin mode has loaded, and the ink it is painted with.
 *
 * The index is the editor's own currency and the game never sees it — the
 * export turns it into an atlas column. The ink is the same: by the time the
 * game has the atlas the colour is already pixels. It is per cell rather than
 * per tile because one sprite can be green here and red there, and the export
 * gives each distinct ink its own column.
 */
export type CustomTile = {
  readonly tileIndex: number
  readonly tint: Tint
}

/**
 * Position → placement, for one art layer's cells.
 *
 * It is level data that names skin data. The placement belongs to the level the
 * way a wall does — it survives a resize and rides on the undo stack — but the
 * index only means something against the sheet it was picked from, which is why
 * loading or re-slicing a sheet clears it exactly as it clears the bindings.
 */
export type CustomTiles = ReadonlyMap<number, CustomTile>

/**
 * One layer of the level's draw order. The built-in ones are drawn from the
 * cells and have a fixed id; an art layer is painted by hand and has an id of
 * its own, because a name is something the author edits and an index moves
 * every time the stack is reordered.
 */
export type EditorLayer =
  | { readonly kind: 'builtIn'; readonly id: BuiltInLayer }
  | {
      readonly kind: 'art'
      readonly id: string
      readonly name: string
      readonly tiles: CustomTiles
    }

export type ArtLayer = Extract<EditorLayer, { kind: 'art' }>

const NO_CUSTOM_TILES: CustomTiles = new Map()

/**
 * Built-ins in the game's default order, with one empty art layer on top so the
 * place tool has somewhere to put a tile before the author has thought about
 * layers at all.
 */
export const DEFAULT_LAYERS: readonly EditorLayer[] = [
  ...BUILT_IN_LAYERS.map((id): EditorLayer => ({ kind: 'builtIn', id })),
  { kind: 'art', id: 'art-1', name: 'tiles', tiles: NO_CUSTOM_TILES },
]

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
  /** The draw order, bottom first. Every built-in layer is in it once. */
  readonly layers: readonly EditorLayer[]
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
    layers: DEFAULT_LAYERS,
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

export function getArtLayer(
  editorDocument: EditorDocument,
  layerId: string,
): ArtLayer | null {
  const layer = editorDocument.layers.find((each) => each.id === layerId)

  return layer?.kind === 'art' ? layer : null
}

/**
 * Rewrites one art layer's tiles, and returns the same document when the edit
 * returned the same map — the identity contract every edit here has, so a drag
 * across cells that already look like that records nothing.
 */
function editArtTiles(
  editorDocument: EditorDocument,
  layerId: string,
  edit: (tiles: CustomTiles) => CustomTiles,
): EditorDocument {
  const layer = getArtLayer(editorDocument, layerId)

  if (!layer) {
    return editorDocument
  }

  const tiles = edit(layer.tiles)

  if (tiles === layer.tiles) {
    return editorDocument
  }

  return {
    ...editorDocument,
    layers: editorDocument.layers.map((each) =>
      each === layer ? { ...layer, tiles } : each,
    ),
  }
}

/**
 * A tile placed by hand on one cell of one art layer. Returns the same document
 * when that cell already holds exactly that placement.
 *
 * A negative index is ignored rather than stored: it is what "no tile is
 * selected" looks like in skin mode, and `UNBOUND` is not a placement. A
 * built-in layer is ignored too — it is drawn from the cells, so there is
 * nothing in it to paint.
 */
export function setCustomTile(
  editorDocument: EditorDocument,
  layerId: string,
  position: number,
  tileIndex: number,
  tint: Tint,
): EditorDocument {
  if (position < 0 || position >= editorDocument.cells.length) {
    return editorDocument
  }

  if (!Number.isInteger(tileIndex) || tileIndex < 0) {
    return editorDocument
  }

  return editArtTiles(editorDocument, layerId, (tiles) => {
    const current = tiles.get(position)

    if (
      current &&
      current.tileIndex === tileIndex &&
      isSameTint(current.tint, tint)
    ) {
      return tiles
    }

    return new Map(tiles).set(position, { tileIndex, tint })
  })
}

/**
 * Repaints one placement and leaves its tile alone — its own edit because
 * re-stamping the cell to change the colour needs the original tile still
 * selected, and would quietly replace the art if it were not.
 *
 * Idempotent, so a drag over a row of cells settles rather than flickering, and
 * a cell with no placement is left alone: an ink paints art that is there, it
 * does not put art down.
 */
export function recolorCustomTile(
  editorDocument: EditorDocument,
  layerId: string,
  position: number,
  tint: Tint,
): EditorDocument {
  return editArtTiles(editorDocument, layerId, (tiles) => {
    const current = tiles.get(position)

    if (!current || isSameTint(current.tint, tint)) {
      return tiles
    }

    return new Map(tiles).set(position, { ...current, tint })
  })
}

export function clearCustomTile(
  editorDocument: EditorDocument,
  layerId: string,
  position: number,
): EditorDocument {
  return editArtTiles(editorDocument, layerId, (tiles) => {
    if (!tiles.has(position)) {
      return tiles
    }

    const cleared = new Map(tiles)
    cleared.delete(position)

    return cleared
  })
}

/**
 * The id the next art layer gets: one past the highest in use, so an id is
 * never handed out twice within a document, even after the layer that had it
 * was deleted and undo brought it back.
 */
export function getNextArtLayerId(editorDocument: EditorDocument): string {
  let highest = 0

  for (const layer of editorDocument.layers) {
    const number = layer.kind === 'art' ? Number(layer.id.slice(4)) : 0

    if (Number.isInteger(number) && number > highest) {
      highest = number
    }
  }

  return `art-${highest + 1}`
}

/**
 * A new, empty art layer directly above `belowId`, or on top of the stack when
 * that is not a layer. Named after its id so two new layers never look alike
 * until the author names them.
 */
export function addArtLayer(
  editorDocument: EditorDocument,
  belowId: string | null,
): EditorDocument {
  const id = getNextArtLayerId(editorDocument)
  const layer: EditorLayer = {
    kind: 'art',
    id,
    name: `layer ${id.slice(4)}`,
    tiles: NO_CUSTOM_TILES,
  }
  const below = editorDocument.layers.findIndex((each) => each.id === belowId)
  const layers = [...editorDocument.layers]
  layers.splice(below < 0 ? layers.length : below + 1, 0, layer)

  return { ...editorDocument, layers }
}

/** Art layers only: a built-in one is the level's, and always in the stack. */
export function removeArtLayer(
  editorDocument: EditorDocument,
  layerId: string,
): EditorDocument {
  if (!getArtLayer(editorDocument, layerId)) {
    return editorDocument
  }

  return {
    ...editorDocument,
    layers: editorDocument.layers.filter((each) => each.id !== layerId),
  }
}

/**
 * One step up (`1`, towards the top of the stack) or down (`-1`). Any layer can
 * move, built-in ones included — that is the whole point of the order being
 * data. Returns the same document at either end of the stack.
 */
export function moveLayer(
  editorDocument: EditorDocument,
  layerId: string,
  direction: 1 | -1,
): EditorDocument {
  const from = editorDocument.layers.findIndex((each) => each.id === layerId)
  const to = from + direction

  if (from < 0 || to < 0 || to >= editorDocument.layers.length) {
    return editorDocument
  }

  const layers = [...editorDocument.layers]
  ;[layers[from], layers[to]] = [layers[to], layers[from]]

  return { ...editorDocument, layers }
}

export function renameArtLayer(
  editorDocument: EditorDocument,
  layerId: string,
  name: string,
): EditorDocument {
  const layer = getArtLayer(editorDocument, layerId)

  if (!layer || layer.name === name) {
    return editorDocument
  }

  return {
    ...editorDocument,
    layers: editorDocument.layers.map((each) =>
      each === layer ? { ...layer, name } : each,
    ),
  }
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

/**
 * Every placement on every art layer at once — what a new or re-sliced sheet
 * invalidates. The layers themselves stay: their order and names mean the same
 * against any sheet.
 */
export function clearCustomTiles(
  editorDocument: EditorDocument,
): EditorDocument {
  if (
    !editorDocument.layers.some(
      (layer) => layer.kind === 'art' && layer.tiles.size > 0,
    )
  ) {
    return editorDocument
  }

  return {
    ...editorDocument,
    layers: editorDocument.layers.map((layer) =>
      layer.kind === 'art' ? { ...layer, tiles: NO_CUSTOM_TILES } : layer,
    ),
  }
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
  const layers = editorDocument.layers.map((layer): EditorLayer => {
    if (layer.kind === 'builtIn') {
      return layer
    }

    const tiles = new Map<number, CustomTile>()

    for (const [position, customTile] of layer.tiles) {
      const x = getCellX(editorDocument, position)
      const y = getCellY(editorDocument, position)

      if (x < keptWidth && y < keptHeight) {
        tiles.set(getPositionFromCoordinates(x, y, clampedWidth), customTile)
      }
    }

    return { ...layer, tiles }
  })

  return {
    width: clampedWidth,
    height: clampedHeight,
    cells,
    layers,
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
