import {
  paintDocument,
  resizeDocument,
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

  function paint(position: number, brush: Brush): boolean {
    const painted = paintDocument(current(), position, brush)

    // `paintDocument` returns the same object when the cell already looked like
    // that, so identity means the stroke did nothing here.
    if (painted === current()) {
      return false
    }

    if (strokeOwnsTopEntry) {
      documents[documents.length - 1] = painted
    } else {
      documents.push(painted)
      strokeOwnsTopEntry = true
    }

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
    resize,
    replace: commit,
    undo,
  }
}
