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
