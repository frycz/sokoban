import { describe, expect, it } from 'vitest'
import { ROLE_ORDER } from '../../render/tile-roles'
import { getAtlasSize, getAtlasSlotX } from './atlas'
import {
  UNBOUND,
  bindRole,
  clearBindings,
  createEmptySkinDraft,
  formatSkinManifest,
  getUnboundRoles,
  isSkinComplete,
  setSheetSettings,
  toSkinFileName,
  type SkinDraft,
} from './skin'

function bindEverything(draft: SkinDraft): SkinDraft {
  return ROLE_ORDER.reduce(
    (current, role, index) => bindRole(current, role, index),
    draft,
  )
}

describe('createEmptySkinDraft', () => {
  it('starts with every role unbound', () => {
    const draft = createEmptySkinDraft()

    expect(getUnboundRoles(draft)).toEqual([...ROLE_ORDER])
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

  it('is complete once all six roles are bound', () => {
    expect(isSkinComplete(bindEverything(createEmptySkinDraft()))).toBe(true)
  })
})

describe('clearBindings', () => {
  it('drops every binding, because an index only means one grid', () => {
    const draft = clearBindings(bindEverything(createEmptySkinDraft()))

    expect(getUnboundRoles(draft)).toEqual([...ROLE_ORDER])
  })

  it('keeps the name and the sheet settings', () => {
    const draft = clearBindings({
      ...bindEverything(createEmptySkinDraft()),
      name: 'mossy',
    })

    expect(draft.name).toBe('mossy')
    expect(draft.sheet.tileWidth).toBe(32)
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
      roles: ['floor', 'goal', 'wall', 'box', 'boxOnGoal', 'player'],
    })
  })

  it('names the roles in atlas column order, so the layout is data', () => {
    const manifest = JSON.parse(formatSkinManifest(createEmptySkinDraft())) as {
      roles: string[]
    }

    expect(manifest.roles).toEqual([...ROLE_ORDER])
  })

  it('ends with a newline', () => {
    expect(formatSkinManifest(createEmptySkinDraft()).endsWith('}\n')).toBe(
      true,
    )
  })
})

describe('getAtlasSize', () => {
  it('is one row of extruded tiles', () => {
    expect(getAtlasSize(createEmptySkinDraft())).toEqual({
      width: 6 * (32 + 2),
      height: 32 + 2,
    })
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
    const draft = setSheetSettings(createEmptySkinDraft(), {
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
