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

const ROLE_BY_KEY: ReadonlyMap<string, TileRole> = new Map(
  ROLE_COLOR_KEYS.flatMap(({ role, keys }) =>
    keys.map((key) => [key.toLowerCase(), role] as const),
  ),
)

export type RoleColorImport = {
  /** In the order the keys appear; a role named twice keeps the last colour. */
  readonly colors: ReadonlyMap<TileRole, string>
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
  const unknownKeys: string[] = []
  const invalidKeys: string[] = []

  for (const [key, entry] of Object.entries(value)) {
    const role = ROLE_BY_KEY.get(key.toLowerCase())

    if (role === undefined) {
      unknownKeys.push(key)
      continue
    }

    const color = typeof entry === 'string' ? parseHexColor(entry) : null

    if (color === null) {
      invalidKeys.push(key)
      continue
    }

    colors.set(role, color)
  }

  return { colors, unknownKeys, invalidKeys }
}
