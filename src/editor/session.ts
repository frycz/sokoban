import {
  clearCustomTile,
  clearCustomTiles,
  paintDocument,
  resizeDocument,
  setCustomTile,
  type Brush,
  type EditorDocument,
} from './document'

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
   * Skin mode's two placement tools. They coalesce per stroke like `paint`,
   * because placing custom tiles is the same dragging gesture.
   */
  placeCustomTile: (position: number, tileIndex: number) => boolean
  eraseCustomTile: (position: number) => boolean
  /** Every placement at once — what a new or re-sliced sheet invalidates. */
  eraseAllCustomTiles: () => boolean
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

  function placeCustomTile(position: number, tileIndex: number): boolean {
    return stroke(setCustomTile(current(), position, tileIndex))
  }

  function eraseCustomTile(position: number): boolean {
    return stroke(clearCustomTile(current(), position))
  }

  function eraseAllCustomTiles(): boolean {
    const cleared = clearCustomTiles(current())

    if (cleared === current()) {
      return false
    }

    commit(cleared)

    return true
  }

  function resize(width: number, height: number): boolean {
    const resized = resizeDocument(current(), width, height)

    if (resized === current()) {
      return false
    }

    commit(resized)

    return true
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
    eraseAllCustomTiles,
    resize,
    replace: commit,
    undo,
  }
}
