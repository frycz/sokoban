import { ROLE_ORDER, type TileRole } from '../../render/tile-roles'
import { parseHexColor } from '../hex'
import { ROLE_LABELS } from './roles'

/**
 * `"box placed"` → `"boxPlaced"`, `"corner top-left"` → `"cornerTopLeft"` — the
 * sidebar's label spelled as a JSON key, so an author can name a role the way
 * the panel shows it rather than having to know the atlas name.
 */
function toCamelCase(label: string): string {
  return label
    .split(/[\s-]+/)
    .map((word, index) =>
      index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join('')
}

/**
 * Every key the import accepts, per role: the role's own name first — what
 * `skin.json` and the atlas use — then its label in camel case when that reads
 * differently. One table, so the help text and the parser cannot disagree.
 */
export const ROLE_COLOR_KEYS: readonly {
  readonly role: TileRole
  readonly keys: readonly string[]
}[] = ROLE_ORDER.map((role) => {
  const alias = toCamelCase(ROLE_LABELS[role])

  return { role, keys: alias === role ? [role] : [role, alias] }
})

/**
 * The colour behind the level. Not a role — it belongs to the level, not the
 * skin — but it is the other colour a palette is chosen for, so the import
 * takes it beside them.
 */
export const GROUND_KEY = 'ground'

/**
 * The skin-wide tile background, what fills every role's transparent pixels
 * unless the role has a background of its own.
 */
export const TILE_BACKGROUND_KEY = 'tileBg'

/**
 * Appended to any role key to name that role's own background instead of its
 * colour: `floorBg`, `boxPlacedBg`.
 */
export const BACKGROUND_SUFFIX = 'Bg'

const ROLE_BY_KEY: ReadonlyMap<string, TileRole> = new Map(
  ROLE_COLOR_KEYS.flatMap(({ role, keys }) =>
    keys.map((key) => [key.toLowerCase(), role] as const),
  ),
)

export type RoleColorImport = {
  /** In the order the keys appear; a role named twice keeps the last colour. */
  readonly colors: ReadonlyMap<TileRole, string>
  /** Each role's own background, from its `<key>Bg`; same order rule. */
  readonly backgrounds: ReadonlyMap<TileRole, string>
  /** `null` when the JSON has no readable `ground`. */
  readonly ground: string | null
  /** `null` when the JSON has no readable `tileBg`. */
  readonly tileBackground: string | null
  /** Keys that name no role. */
  readonly unknownKeys: readonly string[]
  /** Keys that name a role but whose value is not a hex this program reads. */
  readonly invalidKeys: readonly string[]
}

/**
 * A pasted `{ "floor": "#1a1c2c", "boxPlaced": "5d275d" }`. Keys are matched
 * without regard to case; values are read the way a hex field reads them, so
 * `#fff` and a bare `1a1c2c` both work. Anything that is not a JSON object is
 * `null` — there is nothing to report key by key.
 */
export function parseRoleColors(text: string): RoleColorImport | null {
  let value: unknown

  try {
    value = JSON.parse(text)
  } catch {
    return null
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }

  const colors = new Map<TileRole, string>()
  const backgrounds = new Map<TileRole, string>()
  const unknownKeys: string[] = []
  const invalidKeys: string[] = []
  let ground: string | null = null
  let tileBackground: string | null = null

  for (const [key, entry] of Object.entries(value)) {
    const color = typeof entry === 'string' ? parseHexColor(entry) : null
    const lowerKey = key.toLowerCase()
    const suffix = BACKGROUND_SUFFIX.toLowerCase()

    if (
      lowerKey === GROUND_KEY ||
      lowerKey === TILE_BACKGROUND_KEY.toLowerCase()
    ) {
      if (color === null) {
        invalidKeys.push(key)
      } else if (lowerKey === GROUND_KEY) {
        ground = color
      } else {
        tileBackground = color
      }

      continue
    }

    const isBackground = lowerKey.endsWith(suffix)
    const role = isBackground
      ? ROLE_BY_KEY.get(lowerKey.slice(0, -suffix.length))
      : ROLE_BY_KEY.get(lowerKey)

    if (role === undefined) {
      unknownKeys.push(key)
      continue
    }

    if (color === null) {
      invalidKeys.push(key)
      continue
    }

    ;(isBackground ? backgrounds : colors).set(role, color)
  }

  return {
    colors,
    backgrounds,
    ground,
    tileBackground,
    unknownKeys,
    invalidKeys,
  }
}
