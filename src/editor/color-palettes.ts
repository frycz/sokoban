/**
 * Named lists of colours an author keeps across a level: the inks a sprite set
 * is drawn with, the ground it sits on, the ramp a tileset was made from.
 *
 * "Palette" already means something in `skin/palette.ts` — the grid a tile
 * sheet is cut into, which is art. This one is colour, so every name here says
 * `colorPalette` in full and neither reads as the other.
 *
 * Pure, and every edit returns the library it was given when nothing changed —
 * the same identity contract `paintDocument` has, which is what lets a panel
 * redraw only on a real change and what keeps autosave down to one compare.
 */
export type ColorPalette = {
  /**
   * Stable across renames, because two panels remember a choice by it and a
   * rename must not look like a different palette to either.
   */
  readonly id: string
  readonly name: string
  /** `#rrggbb` lowercase, unique within the palette, in the order added. */
  readonly colors: readonly string[]
}

export type ColorPaletteLibrary = {
  readonly palettes: readonly ColorPalette[]
}

export const EMPTY_COLOR_PALETTE_LIBRARY: ColorPaletteLibrary = { palettes: [] }

export function findColorPalette(
  library: ColorPaletteLibrary,
  id: string,
): ColorPalette | null {
  return library.palettes.find((palette) => palette.id === id) ?? null
}

/**
 * The palette a panel's remembered choice names, or the first one when that
 * palette is gone — which is what a delete in colours mode leaves the skin
 * panel holding. Null only when there are no palettes at all.
 *
 * Shared rather than written twice because the two panels choose separately:
 * the selection is each panel's own view state, and only the way it is resolved
 * against the library is common.
 */
export function resolveColorPalette(
  library: ColorPaletteLibrary,
  id: string | null,
): ColorPalette | null {
  const chosen = id === null ? null : findColorPalette(library, id)

  return chosen ?? library.palettes[0] ?? null
}

/**
 * The id the next palette should get: past every id in use, so no two live
 * palettes ever share one. Derived from the library rather than from a clock or
 * a counter, so this module stays pure and a test can name the id it expects;
 * `addColorPalette` takes the id rather than making one, so the caller has it to
 * select with without reading the result back out.
 *
 * Deleting the highest-numbered palette does hand its id back out, which the
 * other panel's remembered choice can land on — it would show a palette that is
 * not the one it was looking at. The alternative is a counter stored beside the
 * palettes, a second source of truth that a hand edit can put out of step; and
 * the cost of being wrong here is showing the wrong palette to copy a hex from,
 * which is a click to correct. Nothing in a level or a skin refers to a palette.
 */
export function getNextColorPaletteId(library: ColorPaletteLibrary): string {
  const used = library.palettes.map((palette) => Number(palette.id))
  const highest = Math.max(
    0,
    ...used.filter((id) => Number.isInteger(id) && id > 0),
  )

  return String(highest + 1)
}

/**
 * Appends an empty palette. A blank name is allowed through as the id-derived
 * fallback rather than refused, because naming it is not the point of making it
 * — the colours are, and a name can be typed later.
 */
export function addColorPalette(
  library: ColorPaletteLibrary,
  id: string,
  name: string,
): ColorPaletteLibrary {
  if (findColorPalette(library, id) !== null) {
    return library
  }

  return {
    palettes: [
      ...library.palettes,
      { id, name: name.trim() === '' ? `palette ${id}` : name, colors: [] },
    ],
  }
}

export function removeColorPalette(
  library: ColorPaletteLibrary,
  id: string,
): ColorPaletteLibrary {
  if (findColorPalette(library, id) === null) {
    return library
  }

  return { palettes: library.palettes.filter((palette) => palette.id !== id) }
}

/**
 * The name as typed, untrimmed, because the field is the one editing it: a
 * trim here would delete the space the author just pressed in the middle of a
 * two-word name.
 */
export function renameColorPalette(
  library: ColorPaletteLibrary,
  id: string,
  name: string,
): ColorPaletteLibrary {
  return editColorPalette(library, id, (palette) =>
    palette.name === name ? palette : { ...palette, name },
  )
}

/**
 * Appends whichever of `colors` the palette does not already hold, deduplicated
 * against each other as well. A palette is a set of distinct inks, so pasting
 * the same ramp twice is a no-op rather than a palette of pairs — and the
 * caller can say how many landed by comparing the counts.
 */
export function addColorsToPalette(
  library: ColorPaletteLibrary,
  id: string,
  colors: readonly string[],
): ColorPaletteLibrary {
  return editColorPalette(library, id, (palette) => {
    const added = colors.filter(
      (color, index) =>
        !palette.colors.includes(color) && colors.indexOf(color) === index,
    )

    if (added.length === 0) {
      return palette
    }

    return { ...palette, colors: [...palette.colors, ...added] }
  })
}

export function removeColorFromPalette(
  library: ColorPaletteLibrary,
  id: string,
  index: number,
): ColorPaletteLibrary {
  return editColorPalette(library, id, (palette) => {
    if (index < 0 || index >= palette.colors.length) {
      return palette
    }

    return {
      ...palette,
      colors: palette.colors.filter((_, at) => at !== index),
    }
  })
}

/**
 * Edit in place: the colour at `index` becomes `color`, keeping its position.
 * Refused when the colour is already somewhere else in the palette, because
 * that would silently merge two entries into one and leave the author looking
 * at a palette one colour shorter than the one they edited.
 */
export function replaceColorInPalette(
  library: ColorPaletteLibrary,
  id: string,
  index: number,
  color: string,
): ColorPaletteLibrary {
  return editColorPalette(library, id, (palette) => {
    if (index < 0 || index >= palette.colors.length) {
      return palette
    }

    if (palette.colors.includes(color)) {
      return palette
    }

    return {
      ...palette,
      colors: palette.colors.map((existing, at) =>
        at === index ? color : existing,
      ),
    }
  })
}

/**
 * The one place the identity contract is kept, so no edit above has to remember
 * it: an edit that returns the palette it was handed returns the library
 * untouched, and a missing palette is not an error — the panel's selection can
 * always be one delete behind.
 */
function editColorPalette(
  library: ColorPaletteLibrary,
  id: string,
  edit: (palette: ColorPalette) => ColorPalette,
): ColorPaletteLibrary {
  const palette = findColorPalette(library, id)

  if (palette === null) {
    return library
  }

  const edited = edit(palette)

  if (edited === palette) {
    return library
  }

  return {
    palettes: library.palettes.map((entry) =>
      entry === palette ? edited : entry,
    ),
  }
}
