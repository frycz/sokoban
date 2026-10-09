import {
  EMPTY_COLOR_PALETTE_LIBRARY,
  type ColorPaletteLibrary,
} from './color-palettes'
import { readStoredText, writeStoredText } from './storage'
import {
  decodeStoredColorPalettes,
  encodeStoredColorPalettes,
} from './stored-state'

/**
 * The library and the autosave for it, in one value, handed to both panels that
 * touch it — colours mode edits it, the skin panel reads it to pick an ink
 * from. The same arrangement `createLevelAutosave` has for the level slice, and
 * for the same reason: the slice belongs to neither panel, so neither owns the
 * key.
 *
 * It is not on the undo stack. The stack is the document's, and a palette is
 * not part of the level — it is a thing kept beside it, which is why deleting
 * one asks first instead.
 */
export type ColorPaletteLibraryStore = {
  current: () => ColorPaletteLibrary
  /**
   * Returns whether the library actually changed, so a panel can redraw only on
   * a real edit: every edit in `color-palettes.ts` hands back the library it was
   * given when it was a no-op, and this is where that is read.
   */
  replace: (library: ColorPaletteLibrary) => boolean
  /** Called from colours mode's `update`, as the level slice is from each mode's. */
  persist: () => void
  hasFailed: () => boolean
  /** Moves the baseline without writing; see `LevelAutosave.markSaved`. */
  markSaved: () => void
}

/** What the editor opens on: whatever was last autosaved, or no palettes. */
export function createInitialColorPaletteLibrary(): ColorPaletteLibrary {
  return (
    decodeStoredColorPalettes(readStoredText('palettes')) ??
    EMPTY_COLOR_PALETTE_LIBRARY
  )
}

export function createColorPaletteLibraryStore(
  initial: ColorPaletteLibrary,
): ColorPaletteLibraryStore {
  let library = initial
  // Identity rather than the text, like skin mode's baseline: every edit
  // replaces the library wholesale and returns the same object when nothing
  // changed, so identity is exact and costs nothing to compare.
  let savedLibrary = library
  let hasStorageFailed = false

  return {
    current: () => library,
    replace: (next) => {
      if (next === library) {
        return false
      }

      library = next

      return true
    },
    persist: () => {
      if (library === savedLibrary) {
        return
      }

      savedLibrary = library
      hasStorageFailed = !writeStoredText(
        'palettes',
        encodeStoredColorPalettes(library),
      )
    },
    hasFailed: () => hasStorageFailed,
    markSaved: () => {
      savedLibrary = library
      hasStorageFailed = false
    },
  }
}
