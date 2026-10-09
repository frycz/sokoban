import { describe, expect, it } from 'vitest'
import {
  REQUIRED_ROLES,
  ROLE_ORDER,
  WALL_VARIANT_ROLES,
} from '../../render/tile-roles'
import { NO_TINT, type Tint } from '../tint'
import { getAtlasSize, getAtlasSlotX } from './atlas'
import {
  UNBOUND,
  bindRole,
  clearBindings,
  createEmptySkinDraft,
  formatSkinManifest,
  getBoundRoles,
  getMissingRequiredRoles,
  isSkinComplete,
  setRoleTint,
  setSheetSettings,
  toSkinFileName,
  unbindRole,
  type SkinDraft,
} from './skin'

const GREEN: Tint = { color: '#55aa33', mode: 'flat' }

function bindEverything(draft: SkinDraft): SkinDraft {
  return ROLE_ORDER.reduce(
    (current, role, index) => bindRole(current, role, index),
    draft,
  )
}

function bindRequired(draft: SkinDraft): SkinDraft {
  return REQUIRED_ROLES.reduce(
    (current, role, index) => bindRole(current, role, index),
    draft,
  )
}

describe('createEmptySkinDraft', () => {
  it('starts with every role unbound', () => {
    const draft = createEmptySkinDraft()

    expect(getBoundRoles(draft)).toEqual([])
    expect(getMissingRequiredRoles(draft)).toEqual([...REQUIRED_ROLES])
    expect(isSkinComplete(draft)).toBe(false)
  })
})

describe('bindRole', () => {
  it('binds one role without touching the others', () => {
    const draft = bindRole(createEmptySkinDraft(), 'wall', 7)

    expect(draft.bindings.wall).toBe(7)
    expect(draft.bindings.floor).toBe(UNBOUND)
  })

  it('rebinds a role rather than adding to it', () => {
    const draft = bindRole(
      bindRole(createEmptySkinDraft(), 'wall', 7),
      'wall',
      9,
    )

    expect(draft.bindings.wall).toBe(9)
  })

  it('returns the same draft when the binding is unchanged', () => {
    const draft = bindRole(createEmptySkinDraft(), 'wall', 7)

    expect(bindRole(draft, 'wall', 7)).toBe(draft)
  })

  it('is complete on the required six alone — wall pieces are optional', () => {
    const draft = bindRequired(createEmptySkinDraft())

    expect(isSkinComplete(draft)).toBe(true)
    expect(getBoundRoles(draft)).toHaveLength(REQUIRED_ROLES.length)
  })

  it('is incomplete while a required role is missing, whatever else is bound', () => {
    const draft = WALL_VARIANT_ROLES.reduce(
      (current, role, index) => bindRole(current, role, index),
      createEmptySkinDraft(),
    )

    expect(isSkinComplete(draft)).toBe(false)
    expect(getMissingRequiredRoles(draft)).toEqual([...REQUIRED_ROLES])
  })
})

describe('unbindRole', () => {
  it('removes a binding, so an optional piece can be taken back out', () => {
    const draft = unbindRole(bindEverything(createEmptySkinDraft()), 'wallTop')

    expect(draft.bindings.wallTop).toBe(UNBOUND)
    expect(getBoundRoles(draft)).not.toContain('wallTop')
    expect(isSkinComplete(draft)).toBe(true)
  })
})

describe('getBoundRoles', () => {
  it('is in atlas column order, not the order they were bound', () => {
    let draft = createEmptySkinDraft()
    draft = bindRole(draft, 'player', 1)
    draft = bindRole(draft, 'floor', 2)
    draft = bindRole(draft, 'wallTop', 3)

    expect(getBoundRoles(draft)).toEqual(['floor', 'wallTop', 'player'])
  })
})

describe('setRoleTint', () => {
  it('paints one role without touching the others or its tile', () => {
    const draft = setRoleTint(
      bindRole(createEmptySkinDraft(), 'wall', 7),
      'wall',
      GREEN,
    )

    expect(draft.tints.wall).toEqual(GREEN)
    expect(draft.tints.floor).toEqual(NO_TINT)
    expect(draft.bindings.wall).toBe(7)
  })

  it('returns the same draft when the ink is unchanged', () => {
    const draft = setRoleTint(createEmptySkinDraft(), 'wall', GREEN)

    expect(setRoleTint(draft, 'wall', { ...GREEN })).toBe(draft)
  })

  /**
   * An ink outliving its tile is harmless — it is a colour the author chose for
   * that role, not a property of whatever tile happened to be bound — and it is
   * what makes rebinding after a re-slice come back to the same palette.
   */
  it('survives the role being unbound', () => {
    const draft = unbindRole(
      setRoleTint(bindRole(createEmptySkinDraft(), 'wall', 7), 'wall', GREEN),
      'wall',
    )

    expect(draft.bindings.wall).toBe(UNBOUND)
    expect(draft.tints.wall).toEqual(GREEN)
  })
})

describe('clearBindings', () => {
  it('drops every binding, because an index only means one grid', () => {
    const draft = clearBindings(bindEverything(createEmptySkinDraft()))

    expect(getBoundRoles(draft)).toEqual([])
  })

  it('keeps the name and the sheet settings', () => {
    const draft = clearBindings({
      ...bindEverything(createEmptySkinDraft()),
      name: 'mossy',
    })

    expect(draft.name).toBe('mossy')
    expect(draft.sheet.tileWidth).toBe(32)
  })

  /** A colour is not an index, so a re-slice has not invalidated it. */
  it('keeps the palette', () => {
    const draft = clearBindings(
      setRoleTint(bindEverything(createEmptySkinDraft()), 'floor', GREEN),
    )

    expect(draft.tints.floor).toEqual(GREEN)
  })
})

describe('setSheetSettings', () => {
  it('clamps what it stores', () => {
    const draft = setSheetSettings(createEmptySkinDraft(), {
      tileWidth: 16,
      tileHeight: 24,
      margin: -3,
      spacing: 2,
    })

    expect(draft.sheet).toEqual({
      tileWidth: 16,
      tileHeight: 24,
      margin: 0,
      spacing: 2,
    })
  })
})

describe('formatSkinManifest', () => {
  it('describes the exported atlas, not the sheet it was cut from', () => {
    const draft = setSheetSettings(
      { ...bindEverything(createEmptySkinDraft()), name: 'mossy stone' },
      { tileWidth: 16, tileHeight: 24, margin: 4, spacing: 4 },
    )

    expect(JSON.parse(formatSkinManifest(draft))).toEqual({
      name: 'mossy stone',
      tileWidth: 16,
      tileHeight: 24,
      // The source sheet's margin and spacing are irrelevant to the consumer;
      // these describe the one-pixel extrusion of the packed atlas.
      margin: 1,
      spacing: 2,
      pixelated: true,
      roles: [...ROLE_ORDER],
    })
  })

  /**
   * The ink is pixels in the atlas by the time anything reads this file, which
   * is the whole reason the game needs no notion of colour: a tinted skin and an
   * untinted one write the same manifest.
   */
  it('says nothing about the inks, because they are baked into the atlas', () => {
    const draft = setRoleTint(
      bindRequired(createEmptySkinDraft()),
      'floor',
      GREEN,
    )

    expect(JSON.parse(formatSkinManifest(draft))).toEqual(
      JSON.parse(formatSkinManifest(bindRequired(createEmptySkinDraft()))),
    )
  })

  it('lists only the roles the image actually contains', () => {
    // This is what lets a six-tile skin and a fourteen-tile skin share one
    // format with no version field: the file says what is in it.
    const manifest = JSON.parse(
      formatSkinManifest(bindRequired(createEmptySkinDraft())),
    ) as { roles: string[] }

    expect(manifest.roles).toEqual([
      'floor',
      'goal',
      'wall',
      'box',
      'boxOnGoal',
      'player',
    ])
  })

  it('ends with a newline', () => {
    expect(formatSkinManifest(createEmptySkinDraft()).endsWith('}\n')).toBe(
      true,
    )
  })
})

describe('getAtlasSize', () => {
  it('has a column per bound role and nothing for the rest', () => {
    expect(getAtlasSize(bindRequired(createEmptySkinDraft()))).toEqual({
      width: 6 * (32 + 2),
      height: 32 + 2,
    })
    expect(getAtlasSize(bindEverything(createEmptySkinDraft())).width).toBe(
      14 * (32 + 2),
    )
  })

  it('is empty before anything is bound', () => {
    expect(getAtlasSize(createEmptySkinDraft()).width).toBe(0)
  })

  it('leaves exactly one pixel of extrusion between neighbours', () => {
    const draft = createEmptySkinDraft()
    const first = getAtlasSlotX(draft, 0)
    const second = getAtlasSlotX(draft, 1)

    expect(first).toBe(1)
    // The first tile ends at 32, so 33 is its extrusion and 34 is the next
    // tile's — no column is shared, which is what stops seams bleeding.
    expect(second).toBe(first + 32 + 2)
  })

  it('tracks a non-square tile', () => {
    const draft = setSheetSettings(bindRequired(createEmptySkinDraft()), {
      tileWidth: 16,
      tileHeight: 24,
      margin: 0,
      spacing: 0,
    })

    expect(getAtlasSize(draft)).toEqual({ width: 6 * 18, height: 26 })
  })
})

describe('toSkinFileName', () => {
  it('slugifies a name', () => {
    expect(toSkinFileName('Mossy Stone v2')).toBe('mossy-stone-v2')
  })

  it('falls back when nothing survives', () => {
    expect(toSkinFileName('  ***  ')).toBe('skin')
  })
})
