import { createEmptyLevelDocument, type EditorDocument } from './document'
import type { Session } from './session'
import { readStoredText, writeStoredText } from './storage'
import { decodeStoredLevel, encodeStoredLevel } from './stored-state'

/**
 * What the editor opens on: whatever was last autosaved, or a blank level. The
 * undo stack deliberately does not persist — a reload is a new session, and the
 * document is the work.
 */
export function createInitialLevelDocument(): EditorDocument {
  return (
    decodeStoredLevel(readStoredText('level')) ?? createEmptyLevelDocument()
  )
}

export type LevelAutosave = {
  /** Called from each mode's `update`, so every edit is covered by one of them. */
  persist: () => void
  /** Whether the last write was refused, for the panel to say so. */
  hasFailed: () => boolean
  /**
   * Moves the baseline to the current document without writing. For a reset,
   * where storage has just been cleared and the fresh document is already what
   * is stored: writing would put the key straight back.
   */
  markSaved: () => void
}

/**
 * The `level` slice is a pure function of the document, and both panels change
 * the document now — level mode paints cells, skin mode places custom tiles — so
 * the autosave for it belongs to neither and is handed to both. One owner still,
 * which is what keeps the key free of read-modify-write between them.
 *
 * Writing a few kilobytes of XSB is cheap enough to do per painted cell, and
 * comparing against what was last written means an unchanged document costs one
 * string compare — which is what keeps a hover, a resize or a mode switch from
 * writing at all.
 */
export function createLevelAutosave(session: Session): LevelAutosave {
  let savedLevel = encodeStoredLevel(session.current())
  let hasStorageFailed = false

  return {
    persist: () => {
      const text = encodeStoredLevel(session.current())

      if (text === savedLevel) {
        return
      }

      savedLevel = text
      hasStorageFailed = !writeStoredText('level', text)
    },
    hasFailed: () => hasStorageFailed,
    markSaved: () => {
      savedLevel = encodeStoredLevel(session.current())
      hasStorageFailed = false
    },
  }
}
