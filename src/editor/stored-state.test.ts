import { describe, expect, it } from 'vitest'
import { xsb } from '../core/test-helpers'
import { setCustomTile, setGroundColor } from './document'
import {
  bindRole,
  createEmptySkinDraft,
  setRoleTint,
  UNBOUND,
} from './skin/skin'
import { NO_TINT, type Tint } from './tint'
import {
  decodeStoredLevel,
  decodeStoredSkin,
  encodeStoredLevel,
  encodeStoredSkin,
} from './stored-state'
import { formatDocumentAsXsb, parseXsbToDocument } from './xsb'

const GREEN: Tint = { color: '#55aa33', mode: 'flat' }

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

/** A stored record for `LEVEL` with its ground colour replaced wholesale. */
function storedLevelGround(groundColor: unknown): string {
  return JSON.stringify({
    ...(JSON.parse(encodeStoredLevel(parseXsbToDocument(LEVEL))) as Record<
      string,
      unknown
    >),
    groundColor,
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
      setCustomTile(parseXsbToDocument(LEVEL), 8, 20, 'onTop', NO_TINT),
      9,
      21,
      'overwrite',
      GREEN,
    )
    const restored = decodeStoredLevel(encodeStoredLevel(placed))

    expect(restored && [...restored.customTiles]).toEqual([
      [8, { tileIndex: 20, mode: 'onTop', tint: NO_TINT }],
      [9, { tileIndex: 21, mode: 'overwrite', tint: GREEN }],
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
      [0, { tileIndex: 4, mode: 'onTop', tint: NO_TINT }],
    ])
  })

  /**
   * The mode and the ink are the two fields a stored placement can be missing,
   * because neither existed in the first build of the feature. On top with no
   * ink is what those drew, so absence already means the right thing and the
   * stored version never had to move.
   */
  it('reads a placement with no mode or ink, and a bare index, as on top', () => {
    const restored = decodeStoredLevel(
      storedLevelWith({ 0: { tileIndex: 4 }, 1: 5, 2: { mode: 'overwrite' } }),
    )

    expect(restored && [...restored.customTiles]).toEqual([
      [0, { tileIndex: 4, mode: 'onTop', tint: NO_TINT }],
      [1, { tileIndex: 5, mode: 'onTop', tint: NO_TINT }],
    ])
  })

  it('reads an ink it cannot make sense of as no ink at all', () => {
    const restored = decodeStoredLevel(
      storedLevelWith({
        0: { tileIndex: 4, mode: 'onTop', tint: { color: 'rebeccapurple' } },
        1: {
          tileIndex: 4,
          mode: 'onTop',
          tint: { color: '#ABC123', mode: 'x' },
        },
        2: { tileIndex: 4, mode: 'onTop', tint: 'green' },
      }),
    )

    expect(restored && [...restored.customTiles]).toEqual([
      [0, { tileIndex: 4, mode: 'onTop', tint: NO_TINT }],
      // The colour is fine, only the mode is nonsense — and a case-folded hex
      // is a colour, so only the mode falls back.
      [
        1,
        {
          tileIndex: 4,
          mode: 'onTop',
          tint: { color: '#abc123', mode: 'multiply' },
        },
      ],
      [2, { tileIndex: 4, mode: 'onTop', tint: NO_TINT }],
    ])
  })

  /**
   * The ground colour is the other thing XSB has nowhere to put. A record
   * written before it existed has none, which is what it was drawn with, so its
   * absence already means the right thing and the stored version did not move.
   */
  it('keeps the ground colour, and reads a missing or unusable one as none', () => {
    const grounded = setGroundColor(parseXsbToDocument(LEVEL), '#102030')

    expect(decodeStoredLevel(encodeStoredLevel(grounded))?.groundColor).toBe(
      '#102030',
    )
    expect(
      decodeStoredLevel(encodeStoredLevel(parseXsbToDocument(LEVEL)))
        ?.groundColor,
    ).toBeNull()
    expect(
      decodeStoredLevel(storedLevelGround('rebeccapurple'))?.groundColor,
    ).toBeNull()
    expect(decodeStoredLevel(storedLevelGround('#ABC123'))?.groundColor).toBe(
      '#abc123',
    )
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
  const draft = setRoleTint(
    bindRole(
      { ...createEmptySkinDraft(), name: 'mossy stone', isPixelated: false },
      'floor',
      7,
    ),
    'floor',
    GREEN,
  )

  it('round-trips a draft and its sheet', () => {
    expect(decodeStoredSkin(encodeStoredSkin(draft, SHEET))).toEqual({
      draft,
      sheetDataUrl: SHEET,
    })
  })

  /**
   * The palette outlives the sheet, as it outlives a re-slice: a colour was
   * never an index into a grid, so nothing about it stopped being true.
   */
  it('drops every binding but keeps the palette when the sheet did not come back', () => {
    const restored = decodeStoredSkin(encodeStoredSkin(draft, null))

    expect(restored?.sheetDataUrl).toBeNull()
    expect(restored?.draft.bindings.floor).toBe(UNBOUND)
    expect(restored?.draft.tints.floor).toEqual(GREEN)
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
        tints: { floor: { color: 'chartreuse' }, goal: GREEN, wall: 7 },
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
    expect(restored?.draft.tints.floor).toEqual(NO_TINT)
    expect(restored?.draft.tints.goal).toEqual(GREEN)
    expect(restored?.draft.tints.wall).toEqual(NO_TINT)
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
