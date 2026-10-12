/**
 * The only module that touches `localStorage`, and the only thing between the
 * editor and the browser's storage quirks: access throws outright in some
 * embeddings, a Safari private window accepts reads and refuses writes, and a
 * write can fail on quota at any time. Every call is guarded, and a failure is
 * reported rather than thrown — the editor has to keep working unsaved.
 *
 * One key per owner — the three modes, the publish panel, the mode switcher and
 * skin mode's live link, and the saves panel's current save —
 * each written only by the one that owns that state, so none of them ever has to
 * coordinate a read-modify-write of a shared record.
 */
const SLICES = [
  'level',
  'skin',
  'publish',
  'palettes',
  'mode',
  'live',
  'save',
] as const

export type StoredSlice = (typeof SLICES)[number]

function getKey(slice: StoredSlice): string {
  return `sokoban.editor.${slice}`
}

function getStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readStoredText(slice: StoredSlice): string | null {
  try {
    return getStorage()?.getItem(getKey(slice)) ?? null
  } catch {
    return null
  }
}

/**
 * Returns whether the text was stored. The caller decides what a refusal means:
 * for a level it is a warning, for a skin it is a cue to store less.
 */
export function writeStoredText(slice: StoredSlice, text: string): boolean {
  const storage = getStorage()

  if (!storage) {
    return false
  }

  try {
    storage.setItem(getKey(slice), text)

    return true
  } catch {
    return false
  }
}

export function clearStoredEditor(): void {
  const storage = getStorage()

  if (!storage) {
    return
  }

  for (const slice of SLICES) {
    try {
      storage.removeItem(getKey(slice))
    } catch {
      // Nothing to do about it, and the caller resets either way.
    }
  }
}
