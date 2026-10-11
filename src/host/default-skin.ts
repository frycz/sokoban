import type { Skin } from '../render/skin'

/**
 * `levels/default-skin.json` names one level whose skin every level without a
 * skin of its own borrows: `{ "from": "quarry-steps" }`, or `{ "from": null }`
 * for none. It is checked in beside the levels, so the game reads the choice
 * on start like the order, and the dev build's picker writes it back through
 * the dev server.
 *
 * Only the role columns travel. A level's art layers name cells of its own
 * grid, so a borrower draws in the default layer order. The ground colour
 * travels too, but only to a level that names none — the skin was drawn against
 * it, and its transparent pixels are where it shows through.
 *
 * Pure, so the rules for a file that has drifted from the directory are tested
 * rather than hoped for.
 */

/** What a level brought itself, kept apart from what it draws with. */
export type SkinnableLevel = {
  readonly slug: string
  readonly skin: Skin | null
  readonly groundColor: string | null
  readonly ownSkin: Skin | null
  readonly ownGroundColor: string | null
}

/**
 * The slug the file names, null for none, or undefined when the file is not
 * that shape.
 */
export function parseDefaultSkin(value: unknown): string | null | undefined {
  if (typeof value !== 'object' || value === null || !('from' in value)) {
    return undefined
  }

  const from = value.from

  return from === null || typeof from === 'string' ? from : undefined
}

export type SkinnedLevels<T> = {
  readonly levels: readonly T[]
  /** A slug that has no skin to lend, said out loud. */
  readonly problems: readonly string[]
}

/**
 * Every level drawn with its own skin, or with the default one when it has
 * none. Applied to what the levels brought rather than to what they draw with,
 * so choosing again is never choosing on top of the last choice.
 */
export function applyDefaultSkin<T extends SkinnableLevel>(
  levels: readonly T[],
  from: string | null,
): SkinnedLevels<T> {
  const source =
    from === null ? undefined : levels.find((level) => level.slug === from)
  const problems: string[] = []

  if (from !== null && !source?.ownSkin) {
    problems.push(
      `default-skin.json: names "${from}", which is not a level with a skin of its own.`,
    )
  }

  const lender = source?.ownSkin ? source : null

  return {
    levels: levels.map((level) => ({
      ...level,
      skin: level.ownSkin ?? lender?.ownSkin ?? null,
      groundColor: level.ownSkin
        ? level.ownGroundColor
        : (level.ownGroundColor ?? lender?.ownGroundColor ?? null),
    })),
    problems,
  }
}
