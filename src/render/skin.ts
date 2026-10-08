import { COLORS } from './colors'
import {
  clampSheetSettings,
  getSheetGrid,
  getSourceTileRect,
  type SheetGrid,
  type SheetRect,
  type SheetSettings,
} from './sheet'
import { ROLE_ORDER, getBaseRole, type TileRole } from './tile-roles'

/**
 * A skin as it arrives from disk: the editor's `skin.json`, regrouped so the
 * four slicing numbers are the `SheetSettings` the slicer already takes.
 *
 * `roles` is the atlas layout — `roles[n]` is the tile in column `n` — and it
 * lists exactly what the image contains, which is what lets a six-tile skin and
 * a fourteen-tile skin share one format with no version field.
 */
export type SkinManifest = {
  readonly name: string
  readonly sheet: SheetSettings
  readonly isPixelated: boolean
  readonly roles: readonly string[]
}

/** A manifest bound to its decoded atlas, ready to draw from. */
export type Skin = {
  readonly image: HTMLImageElement
  readonly sheet: SheetSettings
  readonly isPixelated: boolean
  readonly grid: SheetGrid
  readonly columnOfRole: Partial<Record<TileRole, number>>
}

const KNOWN_ROLES: ReadonlySet<string> = new Set(ROLE_ORDER)

/**
 * What a role with no tile draws as, so a partial skin shows a flat block
 * rather than a hole. Shared with the editor's preview, so the two cannot
 * disagree about what an unfinished skin looks like. Every wall piece takes the
 * wall colour, since by the time a colour is needed the sprite fallback has
 * already sent the piece to the base `wall` role.
 */
const ROLE_COLORS: Record<TileRole, string> = {
  floor: COLORS.floor,
  goal: COLORS.goal,
  wall: COLORS.wall,
  wallTop: COLORS.wall,
  wallRight: COLORS.wall,
  wallBottom: COLORS.wall,
  wallLeft: COLORS.wall,
  wallTopLeft: COLORS.wall,
  wallTopRight: COLORS.wall,
  wallBottomRight: COLORS.wall,
  wallBottomLeft: COLORS.wall,
  box: COLORS.box,
  boxOnGoal: COLORS.boxDone,
  player: COLORS.player,
}

export function getRoleColor(role: TileRole): string {
  return ROLE_COLORS[role]
}

/**
 * Field by field rather than a cast: a manifest is a file on disk that someone
 * can hand-edit, and a skin built from nonsense would fail at the first
 * `drawImage` instead of at the parse.
 *
 * Returns null for anything unusable. An unrecognised role name is not that: it
 * still occupies its column, so it is skipped rather than dropped, and a
 * manifest written by a later editor with roles this build has never heard of
 * keeps working for the roles it does know.
 */
export function parseSkinManifest(value: unknown): SkinManifest | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const record = value as Record<string, unknown>

  if (!Array.isArray(record.roles) || record.roles.length === 0) {
    return null
  }

  const roles = record.roles.filter(
    (role): role is string => typeof role === 'string',
  )

  if (roles.length !== record.roles.length) {
    return null
  }

  return {
    name: typeof record.name === 'string' ? record.name : 'untitled',
    sheet: clampSheetSettings({
      tileWidth: readNumber(record.tileWidth),
      tileHeight: readNumber(record.tileHeight),
      margin: readNumber(record.margin),
      spacing: readNumber(record.spacing),
    }),
    isPixelated: record.pixelated !== false,
    roles,
  }
}

export function createSkin(
  manifest: SkinManifest,
  image: HTMLImageElement,
): Skin {
  const columnOfRole: Partial<Record<TileRole, number>> = {}

  for (const [column, role] of manifest.roles.entries()) {
    if (KNOWN_ROLES.has(role)) {
      columnOfRole[role as TileRole] = column
    }
  }

  return {
    image,
    sheet: manifest.sheet,
    isPixelated: manifest.isPixelated,
    grid: getSheetGrid(manifest.sheet, image.naturalWidth, image.naturalHeight),
    columnOfRole,
  }
}

/**
 * Where to cut this role's tile out of the atlas, or null when the skin has no
 * tile for it and the caller should fall back to `getRoleColor`.
 *
 * An unbound wall piece resolves to the base `wall` tile through `getBaseRole`,
 * the same mapping the editor's preview uses, so a six-tile skin draws every
 * wall in both places.
 */
export function getSkinTileRect(
  skin: Skin,
  requested: TileRole,
): SheetRect | null {
  const role =
    skin.columnOfRole[requested] === undefined
      ? getBaseRole(requested)
      : requested
  const column = skin.columnOfRole[role]

  if (column === undefined) {
    return null
  }

  return getSkinColumnRect(skin, column)
}

/**
 * Where to cut a column out of the atlas by number rather than by role — which
 * is what the custom tiles need, because they sit in the columns past the ones
 * `roles` names and so have no role to ask for.
 */
export function getSkinColumnRect(
  skin: Skin,
  column: number,
): SheetRect | null {
  const rect = getSourceTileRect(skin.sheet, skin.grid, column)

  return rect.width === 0 ? null : rect
}

function readNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number.NaN
}
