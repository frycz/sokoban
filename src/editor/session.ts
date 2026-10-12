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

/**
 * State that lives outside the document but is undone with it — the skin draft
 * and the colour palettes. `read` must return the same object while nothing
 * changed, because identity is how a change is told from a redraw.
 */
export type UndoSlice<T> = {
  read: () => T
  write: (value: T) => void
}

/** How many edits back Undo reaches. */
export const UNDO_LIMIT = 10

export type Session = {
  current: () => EditorDocument
  canUndo: () => boolean
  /**
   * Opens an undo entry. Every edit until the next `beginStroke` folds into it,
   * so dragging across twenty cells undoes as one action. `index.ts` calls it
   * at the start of every gesture, which is what makes one gesture one entry.
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
  /**
   * Puts a slice on the undo stack. Its current value becomes what every entry
   * so far holds, so the history starts from wherever the slice is now.
   */
  track: <T>(slice: UndoSlice<T>) => void
  /**
   * Records whatever the tracked slices changed since the last entry, folded
   * into the open stroke like any other edit. Returns whether anything changed.
   */
  record: () => boolean
  /**
   * Steps back one entry, writing back every tracked slice the entry changed.
   * The document needs no writing back: `current` reads it off the stack.
   */
  undo: () => boolean
  /** Called whenever the stack changes, for the Undo button. */
  onChange: (listener: () => void) => void
}

type Entry = {
  readonly document: EditorDocument
  readonly slices: readonly unknown[]
}

/**
 * The editor's only undo stack, and the counterpart to the game's
 * `createHistory`. It owns the document; the skin and the palettes stay with
 * their panels and are tracked as slices, so an entry is a snapshot of all
 * three and Undo steps back through any edit to any of them. Selections, tools
 * and zoom are view state and are not on it.
 */
export function createSession(initial: EditorDocument): Session {
  const slices: UndoSlice<unknown>[] = []
  const entries: Entry[] = [{ document: initial, slices: [] }]
  const listeners: (() => void)[] = []
  let strokeOwnsTopEntry = false

  const top = () => entries[entries.length - 1]
  const current = () => top().document
  const readSlices = () => slices.map((slice) => slice.read())

  function notify(): void {
    for (const listener of listeners) {
      listener()
    }
  }

  /**
   * Opens a new entry, or replaces the stroke's own. Every pure edit returns
   * the same object when nothing changed, so the callers only get here for a
   * real change.
   */
  function write(entry: Entry, foldsIntoStroke: boolean): void {
    if (foldsIntoStroke && strokeOwnsTopEntry) {
      entries[entries.length - 1] = entry
    } else {
      entries.push(entry)

      if (entries.length > UNDO_LIMIT + 1) {
        entries.shift()
      }
    }

    // A commit also owns its entry, so whatever else the same gesture changes
    // — the bindings a new sheet clears — undoes along with it.
    strokeOwnsTopEntry = true
    notify()
  }

  function commit(editorDocument: EditorDocument): void {
    write({ document: editorDocument, slices: readSlices() }, false)
  }

  /** Folds an edit into the stroke's single undo entry. */
  function stroke(edited: EditorDocument): boolean {
    if (edited === current()) {
      return false
    }

    write({ document: edited, slices: readSlices() }, true)

    return true
  }

  function record(): boolean {
    const values = readSlices()

    if (values.every((value, index) => value === top().slices[index])) {
      return false
    }

    write({ document: current(), slices: values }, true)

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

  function track<T>(slice: UndoSlice<T>): void {
    const value = slice.read()

    slices.push(slice as UndoSlice<unknown>)

    for (const [index, entry] of entries.entries()) {
      entries[index] = { ...entry, slices: [...entry.slices, value] }
    }
  }

  function undo(): boolean {
    if (entries.length === 1) {
      return false
    }

    const undone = top()
    entries.pop()
    const restored = top()
    strokeOwnsTopEntry = false

    for (const [index, slice] of slices.entries()) {
      if (undone.slices[index] !== restored.slices[index]) {
        slice.write(restored.slices[index])
      }
    }

    notify()

    return true
  }

  return {
    current,
    canUndo: () => entries.length > 1,
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
    track,
    record,
    undo,
    onChange: (listener) => {
      listeners.push(listener)
    },
  }
}
