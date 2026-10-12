import { readHexColor } from '../render/colors'
import { clampSheetSettings, type SheetSettings } from '../render/sheet'

/** How many entries a recent list keeps — the newest first. */
const RECENT_LIMIT = 10

/**
 * `item` moved to the front, without a second copy of it, and the list cut to
 * `limit`. Returns the same list when the item is already first, so a drag that
 * keeps using one colour does not rebuild anything.
 */
export function pushRecent<T>(
  list: readonly T[],
  item: T,
  limit: number = RECENT_LIMIT,
): readonly T[] {
  if (list[0] === item) {
    return list
  }

  return [item, ...list.filter((each) => each !== item)].slice(0, limit)
}

/**
 * What the `recent` slice keeps. The tiles are indices, so the slicing they were
 * picked against goes with them — the sheet itself is already in the `skin`
 * slice, and on reload that is the sheet they were picked from.
 */
export type StoredRecent = {
  readonly colors: readonly string[]
  readonly tiles: readonly number[]
  readonly sheet: SheetSettings
}

export function encodeStoredRecent(recent: StoredRecent): string {
  return JSON.stringify(recent)
}

/**
 * Null for a record that is not one, and an entry that does not read is dropped
 * rather than failing the rest: a recent list is a convenience, and losing one
 * colour of it is better than losing all ten.
 */
export function decodeStoredRecent(text: string | null): StoredRecent | null {
  if (text === null) {
    return null
  }

  let value: unknown

  try {
    value = JSON.parse(text)
  } catch {
    return null
  }

  if (typeof value !== 'object' || value === null) {
    return null
  }

  const record = value as Record<string, unknown>
  const sheet = record.sheet

  if (typeof sheet !== 'object' || sheet === null) {
    return null
  }

  const colors = Array.isArray(record.colors)
    ? record.colors
        .map(readHexColor)
        .filter((color): color is string => color !== null)
    : []
  const tiles = Array.isArray(record.tiles)
    ? record.tiles.filter(
        (tile): tile is number => Number.isInteger(tile) && tile >= 0,
      )
    : []

  return {
    colors: [...new Set(colors)].slice(0, RECENT_LIMIT),
    tiles: [...new Set(tiles)].slice(0, RECENT_LIMIT),
    sheet: clampSheetSettings(sheet as SheetSettings),
  }
}
