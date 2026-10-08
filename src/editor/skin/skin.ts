import { ROLE_ORDER, type TileRole } from '../../render/tile-roles'
import {
  DEFAULT_SHEET_SETTINGS,
  EXPORT_MARGIN,
  EXPORT_SPACING,
  clampSheetSettings,
  type SheetSettings,
} from './sheet'

export const UNBOUND = -1

/**
 * A skin being built. The bindings say which tile of the loaded sheet each role
 * takes — one tile per role, no per-cell art, because the game renderer resolves
 * sprites from state and never sees a cell's identity.
 */
export type SkinDraft = {
  readonly name: string
  readonly sheet: SheetSettings
  readonly isPixelated: boolean
  readonly bindings: Readonly<Record<TileRole, number>>
}

const EMPTY_BINDINGS: Record<TileRole, number> = {
  floor: UNBOUND,
  goal: UNBOUND,
  wall: UNBOUND,
  box: UNBOUND,
  boxOnGoal: UNBOUND,
  player: UNBOUND,
}

export function createEmptySkinDraft(): SkinDraft {
  return {
    name: 'untitled',
    sheet: DEFAULT_SHEET_SETTINGS,
    isPixelated: true,
    bindings: EMPTY_BINDINGS,
  }
}

/** Returns the same draft when nothing changed, as the level edits do. */
export function bindRole(
  draft: SkinDraft,
  role: TileRole,
  tileIndex: number,
): SkinDraft {
  if (draft.bindings[role] === tileIndex) {
    return draft
  }

  return { ...draft, bindings: { ...draft.bindings, [role]: tileIndex } }
}

export function setSheetSettings(
  draft: SkinDraft,
  sheet: SheetSettings,
): SkinDraft {
  return { ...draft, sheet: clampSheetSettings(sheet) }
}

/**
 * Re-slicing the sheet invalidates every binding, because a tile index only
 * means anything against one grid. Dropping them is honest; silently keeping
 * indices that now point at different art is not.
 */
export function clearBindings(draft: SkinDraft): SkinDraft {
  return { ...draft, bindings: EMPTY_BINDINGS }
}

export function getUnboundRoles(draft: SkinDraft): TileRole[] {
  return ROLE_ORDER.filter((role) => draft.bindings[role] === UNBOUND)
}

export function isSkinComplete(draft: SkinDraft): boolean {
  return getUnboundRoles(draft).length === 0
}

/**
 * The manifest describes the exported atlas, not the sheet it was cut from — so
 * `margin` and `spacing` are the extrusion, and `roles` is the atlas layout in
 * column order. The role list is data rather than a convention in a comment,
 * which is what lets the set grow without a version field.
 */
export function formatSkinManifest(draft: SkinDraft): string {
  const { tileWidth, tileHeight } = clampSheetSettings(draft.sheet)

  return `${JSON.stringify(
    {
      name: draft.name,
      tileWidth,
      tileHeight,
      margin: EXPORT_MARGIN,
      spacing: EXPORT_SPACING,
      pixelated: draft.isPixelated,
      roles: [...ROLE_ORDER],
    },
    null,
    2,
  )}\n`
}

export function toSkinFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug === '' ? 'skin' : slug
}
