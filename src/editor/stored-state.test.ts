import { describe, expect, it } from 'vitest'
import { xsb } from '../core/test-helpers'
import { setCustomTile } from './document'
import { bindRole, createEmptySkinDraft, UNBOUND } from './skin/skin'
import {
  decodeStoredLevel,
  decodeStoredSkin,
  encodeStoredLevel,
  encodeStoredSkin,
} from './stored-state'
import { formatDocumentAsXsb, parseXsbToDocument } from './xsb'

const SHEET = 'data:image/png;base64,AAAA'

const LEVEL = xsb('#######', '#.@ # #', '#$* $ #', '# ..  #', '#######')

/**
 * Builds a document from XSB, stores it, reads it back and spells it out again.
 * Fixtures write floor as `-` wherever it sits on an edge, because `xsb` plus
 * `parseXsbToDocument` trims an all-space row before the codec ever sees it —
 * which is the very thing the stored form exists to survive.
 */
/** A stored record for `LEVEL` with its custom tiles replaced wholesale. */
function storedLevelWith(customTiles: Record<string, unknown>): string {
  return JSON.stringify({
    ...(JSON.parse(encodeStoredLevel(parseXsbToDocument(LEVEL))) as Record<
      string,
      unknown
    >),
    customTiles,
  })
}

function roundTripLevel(text: string): string {
  const restored = decodeStoredLevel(
    encodeStoredLevel(parseXsbToDocument(text)),
  )

  if (!restored) {
    throw new Error('Expected the level to decode')
  }

  return formatDocumentAsXsb(restored)
}

describe('stored level', () => {
  it('round-trips a level unchanged', () => {
    expect(roundTripLevel(LEVEL)).toBe(LEVEL)
  })

  it('keeps a row of floor on the outer edge, which XSB would trim as blank', () => {
    expect(roundTripLevel(xsb('-----', '#@$.#', '-----'))).toBe(
      xsb('     ', '#@$.#', '     '),
    )
  })

  it('keeps an all-floor document, which has no non-blank row at all', () => {
    expect(roundTripLevel(xsb('---', '---'))).toBe(xsb('   ', '   '))
  })

  it('ignores anything that is not a current stored record', () => {
    expect(decodeStoredLevel(null)).toBeNull()
    expect(decodeStoredLevel('')).toBeNull()
    expect(decodeStoredLevel('not json')).toBeNull()
    expect(decodeStoredLevel('"a string"')).toBeNull()
    expect(decodeStoredLevel(JSON.stringify({ xsb: '###' }))).toBeNull()
    expect(
      decodeStoredLevel(JSON.stringify({ version: 2, xsb: '###' })),
    ).toBeNull()
    expect(decodeStoredLevel(JSON.stringify({ version: 1 }))).toBeNull()
  })

  it('keeps the custom tiles, which XSB has nowhere to put', () => {
    const placed = setCustomTile(
      setCustomTile(parseXsbToDocument(LEVEL), 8, 20, 'onTop'),
      9,
      21,
      'overwrite',
    )
    const restored = decodeStoredLevel(encodeStoredLevel(placed))

    expect(restored && [...restored.customTiles]).toEqual([
      [8, { tileIndex: 20, mode: 'onTop' }],
      [9, { tileIndex: 21, mode: 'overwrite' }],
    ])
  })

  it('drops a custom tile that is not on the level it came back with', () => {
    const restored = decodeStoredLevel(
      storedLevelWith({
        0: { tileIndex: 4, mode: 'onTop' },
        999: { tileIndex: 4, mode: 'onTop' },
        '-1': { tileIndex: 4, mode: 'onTop' },
        nonsense: { tileIndex: 4, mode: 'onTop' },
        1: { tileIndex: -2, mode: 'onTop' },
      }),
    )

    expect(restored && [...restored.customTiles]).toEqual([
      [0, { tileIndex: 4, mode: 'onTop' }],
    ])
  })

  /**
   * The mode is the one field a stored placement can be missing, because the
   * first build of the feature had no modes. On top is what those drew.
   */
  it('reads a placement with no mode, and a bare index, as on top', () => {
    const restored = decodeStoredLevel(
      storedLevelWith({ 0: { tileIndex: 4 }, 1: 5, 2: { mode: 'overwrite' } }),
    )

    expect(restored && [...restored.customTiles]).toEqual([
      [0, { tileIndex: 4, mode: 'onTop' }],
      [1, { tileIndex: 5, mode: 'onTop' }],
    ])
  })

  it('ignores a record whose level no longer parses', () => {
    expect(
      decodeStoredLevel(JSON.stringify({ version: 1, xsb: '#%#' })),
    ).toBeNull()
    expect(
      decodeStoredLevel(JSON.stringify({ version: 1, xsb: '' })),
    ).toBeNull()
  })
})

describe('stored skin', () => {
  const draft = bindRole(
    { ...createEmptySkinDraft(), name: 'mossy stone', isPixelated: false },
    'floor',
    7,
  )

  it('round-trips a draft and its sheet', () => {
    expect(decodeStoredSkin(encodeStoredSkin(draft, SHEET))).toEqual({
      draft,
      sheetDataUrl: SHEET,
    })
  })

  it('drops every binding when the sheet did not come back', () => {
    const restored = decodeStoredSkin(encodeStoredSkin(draft, null))

    expect(restored?.sheetDataUrl).toBeNull()
    expect(restored?.draft.bindings.floor).toBe(UNBOUND)
    expect(restored?.draft.name).toBe('mossy stone')
  })

  it('ignores a sheet that is not a data url', () => {
    expect(
      decodeStoredSkin(
        JSON.stringify({
          version: 1,
          sheetDataUrl: 'https://example.com/a.png',
        }),
      )?.sheetDataUrl,
    ).toBeNull()
  })

  it('falls back field by field when the record holds nonsense', () => {
    const empty = createEmptySkinDraft()
    const restored = decodeStoredSkin(
      JSON.stringify({
        version: 1,
        name: 42,
        isPixelated: 'yes',
        sheet: { tileWidth: 'wide', tileHeight: 0, margin: -3, spacing: 2.7 },
        bindings: { floor: 'first', goal: -2, wall: 1.5, box: 4 },
        sheetDataUrl: SHEET,
      }),
    )

    expect(restored?.draft.name).toBe(empty.name)
    expect(restored?.draft.isPixelated).toBe(empty.isPixelated)
    expect(restored?.draft.sheet).toEqual({
      tileWidth: empty.sheet.tileWidth,
      tileHeight: 1,
      margin: 0,
      spacing: 2,
    })
    expect(restored?.draft.bindings.floor).toBe(UNBOUND)
    expect(restored?.draft.bindings.goal).toBe(UNBOUND)
    expect(restored?.draft.bindings.wall).toBe(UNBOUND)
    expect(restored?.draft.bindings.box).toBe(4)
  })

  it('gives a role that did not exist when the state was written no binding', () => {
    const stored = JSON.parse(encodeStoredSkin(draft, SHEET)) as {
      bindings: Record<string, number>
    }
    delete stored.bindings.player
    stored.bindings.conveyor = 3

    const restored = decodeStoredSkin(JSON.stringify(stored))

    expect(restored?.draft.bindings.player).toBe(UNBOUND)
    expect(restored?.draft.bindings).not.toHaveProperty('conveyor')
  })

  it('ignores anything that is not a current stored record', () => {
    expect(decodeStoredSkin(null)).toBeNull()
    expect(decodeStoredSkin('not json')).toBeNull()
    expect(decodeStoredSkin(JSON.stringify({ version: 2 }))).toBeNull()
  })
})
