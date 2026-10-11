import {
  REQUIRED_ROLES,
  ROLE_ORDER,
  type TileRole,
} from '../../render/tile-roles'
import {
  DEFAULT_SHEET_SETTINGS,
  EXPORT_MARGIN,
  EXPORT_SPACING,
  clampSheetSettings,
  type SheetSettings,
} from '../../render/sheet'
import { NO_TINT, isSameTint, type Tint } from '../tint'

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
  /**
   * The ink each role's tile is drawn with, baked into the atlas at export so
   * that the game never learns what colour is.
   *
   * A second map rather than a field on the binding, because the two are
   * invalidated by different things: a tile index only means something against
   * one grid, but a colour means the same thing against any of them. So
   * re-slicing drops every binding and leaves the palette alone, and rebinding
   * afterwards comes back to the colours already chosen.
   */
  readonly tints: Readonly<Record<TileRole, Tint>>
  /**
   * `#rrggbb` painted under every role's tile whose own tint has no background,
   * or `null` for none. A role's own background wins, so this is the default and
   * the per-role field the exception — `getRoleTint` is where the two meet.
   */
  readonly background: string | null
}

/**
 * Built from `ROLE_ORDER` rather than written out, so a role added there cannot
 * be missing here. The cast is what that costs; the alternative is a literal
 * that silently drifts.
 */
const EMPTY_BINDINGS = Object.fromEntries(
  ROLE_ORDER.map((role) => [role, UNBOUND]),
) as Record<TileRole, number>

const EMPTY_TINTS = Object.fromEntries(
  ROLE_ORDER.map((role) => [role, NO_TINT]),
) as Record<TileRole, Tint>

export function createEmptySkinDraft(): SkinDraft {
  return {
    name: 'untitled',
    sheet: DEFAULT_SHEET_SETTINGS,
    isPixelated: true,
    bindings: EMPTY_BINDINGS,
    tints: EMPTY_TINTS,
    background: null,
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

export function unbindRole(draft: SkinDraft, role: TileRole): SkinDraft {
  return bindRole(draft, role, UNBOUND)
}

/**
 * Returns the same draft when nothing changed, as `bindRole` does. The tint is
 * kept when the role is unbound rather than reset with it: it is the author's
 * colour choice for that role, not a property of the tile that happened to be
 * there.
 */
export function setRoleTint(
  draft: SkinDraft,
  role: TileRole,
  tint: Tint,
): SkinDraft {
  if (isSameTint(draft.tints[role], tint)) {
    return draft
  }

  return { ...draft, tints: { ...draft.tints, [role]: tint } }
}

/** Returns the same draft when nothing changed, as `setRoleTint` does. */
export function setSkinBackground(
  draft: SkinDraft,
  background: string | null,
): SkinDraft {
  if (draft.background === background) {
    return draft
  }

  return { ...draft, background }
}

/**
 * The tint a role is actually drawn with: its own, with the skin-wide
 * background filled in when the role has none of its own. Everything that
 * paints a role — the thumbnails, the preview, the atlas — goes through this,
 * so the stored tint keeps saying only what the author set on that row.
 */
export function getRoleTint(draft: SkinDraft, role: TileRole): Tint {
  const tint = draft.tints[role]

  if (tint.background !== null || draft.background === null) {
    return tint
  }

  return { ...tint, background: draft.background }
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
 *
 * The tints stay. A colour is not an index, so nothing about it stopped being
 * true — and losing a hand-picked palette to a one-pixel change of margin would
 * be the kind of help nobody asked for.
 */
export function clearBindings(draft: SkinDraft): SkinDraft {
  return { ...draft, bindings: EMPTY_BINDINGS }
}

export function isRoleBound(draft: SkinDraft, role: TileRole): boolean {
  return draft.bindings[role] !== UNBOUND
}

/** Everything bound, in atlas column order — which is what gets packed. */
export function getBoundRoles(draft: SkinDraft): TileRole[] {
  return ROLE_ORDER.filter((role) => isRoleBound(draft, role))
}

/** Only the required six gate an export; the wall pieces are refinements. */
export function getMissingRequiredRoles(draft: SkinDraft): TileRole[] {
  return REQUIRED_ROLES.filter((role) => !isRoleBound(draft, role))
}

export function isSkinComplete(draft: SkinDraft): boolean {
  return getMissingRequiredRoles(draft).length === 0
}

/**
 * The manifest describes the exported atlas, not the sheet it was cut from — so
 * `margin` and `spacing` are the extrusion, and `roles` is the atlas layout in
 * column order, listing exactly the roles the image contains. The role list
 * being data rather than a convention in a comment is what lets a six-tile skin
 * and a fourteen-tile skin use one format with no version field.
 *
 * The tints are not in it, and that is the point: they are baked into the atlas
 * as pixels, so the manifest a tinted skin writes is byte for byte the one an
 * untinted skin writes and the game needs no notion of colour at all.
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
      roles: getBoundRoles(draft),
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
