import {
  addArtLayer,
  clearCustomTile,
  clearCustomTiles,
  moveLayer,
  paintDocument,
  recolorCustomTile,
  removeArtLayer,
  renameArtLayer,
  resizeDocument,
  setCustomTile,
  setGroundColor,
  type Brush,
  type EditorDocument,
} from './document'
import type { Tint } from './tint'

export type Session = {
  current: () => EditorDocument
  canUndo: () => boolean
  /**
   * Opens an undo entry. Every `paint` until the next `beginStroke` folds into
   * it, so dragging across twenty cells undoes as one action.
   */
  beginStroke: () => void
  /** Returns whether the document changed. */
  paint: (position: number, brush: Brush) => boolean
  /**
   * Skin mode's three placement tools, each on one art layer. They coalesce per
   * stroke like `paint`, because placing custom tiles is the same dragging
   * gesture.
   */
  placeCustomTile: (
    layerId: string,
    position: number,
    tileIndex: number,
    tint: Tint,
  ) => boolean
  eraseCustomTile: (layerId: string, position: number) => boolean
  recolorCustomTile: (layerId: string, position: number, tint: Tint) => boolean
  /**
   * The layer stack's own edits, one undo entry each. `addArtLayer` puts the
   * new layer directly above `belowId`.
   */
  addArtLayer: (belowId: string | null) => boolean
  removeArtLayer: (layerId: string) => boolean
  moveLayer: (layerId: string, direction: 1 | -1) => boolean
  renameArtLayer: (layerId: string, name: string) => boolean
  /** Every placement at once — what a new or re-sliced sheet invalidates. */
  eraseAllCustomTiles: () => boolean
  /**
   * The colour under the whole board, or null for none. A stroke like the
   * placement tools, because a colour input fires continuously while it is
   * dragged: one entry per visit to the picker rather than one per shade passed
   * through on the way.
   */
  setGroundColor: (groundColor: string | null) => boolean
  resize: (width: number, height: number) => boolean
  /** Replaces the document wholesale — a new level, or loaded XSB. */
  replace: (editorDocument: EditorDocument) => void
  undo: () => boolean
}

/**
 * The editor's only mutable value, and the counterpart to the game's
 * `createHistory`. It owns the undo stack and nothing else — the selected brush
 * is view state and stays in `index.ts`.
 */
export function createSession(initial: EditorDocument): Session {
  const documents: EditorDocument[] = [initial]
  let strokeOwnsTopEntry = false

  const current = () => documents[documents.length - 1]

  function commit(editorDocument: EditorDocument): void {
    documents.push(editorDocument)
    strokeOwnsTopEntry = false
  }

  /**
   * Folds an edit into the stroke's single undo entry. Every pure edit returns
   * the same object when the cell already looked like that, so identity means
   * the stroke did nothing here and there is nothing to record.
   */
  function stroke(edited: EditorDocument): boolean {
    if (edited === current()) {
      return false
    }

    if (strokeOwnsTopEntry) {
      documents[documents.length - 1] = edited
    } else {
      documents.push(edited)
      strokeOwnsTopEntry = true
    }

    return true
  }

  function paint(position: number, brush: Brush): boolean {
    return stroke(paintDocument(current(), position, brush))
  }

  function placeCustomTile(
    layerId: string,
    position: number,
    tileIndex: number,
    tint: Tint,
  ): boolean {
    return stroke(setCustomTile(current(), layerId, position, tileIndex, tint))
  }

  function eraseCustomTile(layerId: string, position: number): boolean {
    return stroke(clearCustomTile(current(), layerId, position))
  }

  function recolor(layerId: string, position: number, tint: Tint): boolean {
    return stroke(recolorCustomTile(current(), layerId, position, tint))
  }

  /** One undo entry of its own, or nothing when the edit changed nothing. */
  function commitIfChanged(edited: EditorDocument): boolean {
    if (edited === current()) {
      return false
    }

    commit(edited)

    return true
  }

  function setGround(groundColor: string | null): boolean {
    return stroke(setGroundColor(current(), groundColor))
  }

  function resize(width: number, height: number): boolean {
    return commitIfChanged(resizeDocument(current(), width, height))
  }

  function undo(): boolean {
    if (documents.length === 1) {
      return false
    }

    documents.pop()
    strokeOwnsTopEntry = false

    return true
  }

  return {
    current,
    canUndo: () => documents.length > 1,
    beginStroke: () => {
      strokeOwnsTopEntry = false
    },
    paint,
    placeCustomTile,
    eraseCustomTile,
    recolorCustomTile: recolor,
    addArtLayer: (belowId) => commitIfChanged(addArtLayer(current(), belowId)),
    removeArtLayer: (layerId) =>
      commitIfChanged(removeArtLayer(current(), layerId)),
    moveLayer: (layerId, direction) =>
      commitIfChanged(moveLayer(current(), layerId, direction)),
    renameArtLayer: (layerId, name) =>
      commitIfChanged(renameArtLayer(current(), layerId, name)),
    eraseAllCustomTiles: () => commitIfChanged(clearCustomTiles(current())),
    setGroundColor: setGround,
    resize,
    replace: commit,
    undo,
  }
}
