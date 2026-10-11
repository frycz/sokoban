/**
 * `levels/order.json` is the campaign: a list of level slugs, first level
 * first. It is checked in beside the levels, so the order a player meets them
 * in is part of the game rather than anything a browser remembers, and the dev
 * build's reordering writes it back through the dev server.
 *
 * Pure, so the rules for a file that has drifted from the directory are tested
 * rather than hoped for.
 */

/** The slugs in `order.json`, or null when the file is not a list of them. */
export function parseLevelOrder(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  return value.every((slug) => typeof slug === 'string') ? value : null
}

export type OrderedLevels<T> = {
  readonly levels: readonly T[]
  /** Slugs the file names that have no level, said out loud. */
  readonly problems: readonly string[]
}

/**
 * The levels in the file's order. A level the file does not mention — one just
 * exported — goes after the listed ones in the order it came in, so a new level
 * is playable straight away rather than invisible until someone orders it. A
 * slug with no level is skipped and reported, and a slug listed twice counts
 * once, where it first appears.
 */
export function applyLevelOrder<T extends { readonly slug: string }>(
  levels: readonly T[],
  order: readonly string[],
): OrderedLevels<T> {
  const bySlug = new Map(levels.map((level) => [level.slug, level]))
  const placed = new Set<string>()
  const ordered: T[] = []
  const problems: string[] = []

  for (const slug of order) {
    if (placed.has(slug)) {
      continue
    }

    const level = bySlug.get(slug)

    if (!level) {
      problems.push(
        `order.json: lists "${slug}", which is not a level in levels/.`,
      )
      continue
    }

    placed.add(slug)
    ordered.push(level)
  }

  for (const level of levels) {
    if (!placed.has(level.slug)) {
      ordered.push(level)
    }
  }

  return { levels: ordered, problems }
}
