import { describe, expect, it } from 'vitest'
import {
  addColorPalette,
  addColorsToPalette,
  EMPTY_COLOR_PALETTE_LIBRARY,
  findColorPalette,
  getNextColorPaletteId,
  removeColorFromPalette,
  removeColorPalette,
  renameColorPalette,
  replaceColorInPalette,
  resolveColorPalette,
  type ColorPaletteLibrary,
} from './color-palettes'

/** A library of one palette with the colours given, which is most of these. */
function libraryOf(...colors: string[]): ColorPaletteLibrary {
  return addColorsToPalette(
    addColorPalette(EMPTY_COLOR_PALETTE_LIBRARY, '1', 'sweetie'),
    '1',
    colors,
  )
}

function colorsOf(library: ColorPaletteLibrary, id = '1'): readonly string[] {
  return findColorPalette(library, id)?.colors ?? []
}

describe('addColorPalette', () => {
  it('names an unnamed palette after its id, so the list is never blank', () => {
    const library = addColorPalette(EMPTY_COLOR_PALETTE_LIBRARY, '1', '   ')

    expect(findColorPalette(library, '1')?.name).toBe('palette 1')
  })

  it('refuses an id already taken, rather than shadowing it', () => {
    const library = addColorPalette(EMPTY_COLOR_PALETTE_LIBRARY, '1', 'first')

    expect(addColorPalette(library, '1', 'second')).toBe(library)
  })

  it('hands out an id past every one in use, so live palettes never share', () => {
    const library = addColorPalette(
      addColorPalette(EMPTY_COLOR_PALETTE_LIBRARY, '1', 'a'),
      '2',
      'b',
    )

    expect(getNextColorPaletteId(EMPTY_COLOR_PALETTE_LIBRARY)).toBe('1')
    expect(getNextColorPaletteId(library)).toBe('3')
    // Still past the one left, which is the promise — deleting the highest does
    // hand its id back out, which the comment on it owns up to.
    expect(getNextColorPaletteId(removeColorPalette(library, '1'))).toBe('3')
  })
})

describe('resolveColorPalette', () => {
  it('falls back to the first palette when the chosen one is gone', () => {
    const library = addColorPalette(libraryOf('#ffffff'), '2', 'other')

    expect(resolveColorPalette(library, '2')?.id).toBe('2')
    expect(resolveColorPalette(removeColorPalette(library, '2'), '2')?.id).toBe(
      '1',
    )
  })

  it('is null only when there are no palettes at all', () => {
    expect(resolveColorPalette(EMPTY_COLOR_PALETTE_LIBRARY, null)).toBeNull()
    expect(resolveColorPalette(libraryOf(), null)?.id).toBe('1')
  })
})

describe('addColorsToPalette', () => {
  it('appends in the order pasted', () => {
    expect(colorsOf(libraryOf('#1a1c2c', '#5d275d'))).toEqual([
      '#1a1c2c',
      '#5d275d',
    ])
  })

  it('drops what the palette already holds, and duplicates within the batch', () => {
    const library = addColorsToPalette(libraryOf('#1a1c2c'), '1', [
      '#1a1c2c',
      '#5d275d',
      '#5d275d',
    ])

    expect(colorsOf(library)).toEqual(['#1a1c2c', '#5d275d'])
  })

  it('is the same library when every colour was already there', () => {
    const library = libraryOf('#1a1c2c')

    expect(addColorsToPalette(library, '1', ['#1a1c2c'])).toBe(library)
  })
})

describe('replaceColorInPalette', () => {
  it('keeps the colour in its place', () => {
    const library = replaceColorInPalette(
      libraryOf('#1a1c2c', '#5d275d', '#b13e53'),
      '1',
      1,
      '#ef7d57',
    )

    expect(colorsOf(library)).toEqual(['#1a1c2c', '#ef7d57', '#b13e53'])
  })

  /** A merge would leave the author looking at a shorter palette than they edited. */
  it('refuses a colour the palette already holds elsewhere', () => {
    const library = libraryOf('#1a1c2c', '#5d275d')

    expect(replaceColorInPalette(library, '1', 0, '#5d275d')).toBe(library)
  })

  it('refuses an index off the end', () => {
    const library = libraryOf('#1a1c2c')

    expect(replaceColorInPalette(library, '1', 1, '#5d275d')).toBe(library)
  })
})

describe('removeColorFromPalette', () => {
  it('takes out the one named and closes the gap', () => {
    const library = removeColorFromPalette(
      libraryOf('#1a1c2c', '#5d275d', '#b13e53'),
      '1',
      0,
    )

    expect(colorsOf(library)).toEqual(['#5d275d', '#b13e53'])
  })

  it('is the same library for an index that is not there', () => {
    const library = libraryOf('#1a1c2c')

    expect(removeColorFromPalette(library, '1', -1)).toBe(library)
    expect(removeColorFromPalette(library, '1', 1)).toBe(library)
  })
})

describe('renameColorPalette', () => {
  it('keeps the name as typed, so a space mid-name survives', () => {
    const library = renameColorPalette(libraryOf(), '1', 'dawn ')

    expect(findColorPalette(library, '1')?.name).toBe('dawn ')
  })

  it('is the same library when the name did not change', () => {
    const library = libraryOf()

    expect(renameColorPalette(library, '1', 'sweetie')).toBe(library)
  })
})

/**
 * The contract every panel leans on: an edit naming a palette that has been
 * deleted is a no-op, because a selection can always be one delete behind.
 */
it('leaves a library alone when the palette named is not in it', () => {
  const library = libraryOf('#1a1c2c')

  expect(addColorsToPalette(library, '9', ['#ffffff'])).toBe(library)
  expect(removeColorFromPalette(library, '9', 0)).toBe(library)
  expect(replaceColorInPalette(library, '9', 0, '#ffffff')).toBe(library)
  expect(renameColorPalette(library, '9', 'gone')).toBe(library)
  expect(removeColorPalette(library, '9')).toBe(library)
})
