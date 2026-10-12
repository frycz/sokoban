/**
 * `levels/disabled.json` lists the levels left out of the campaign: still in
 * `levels/`, still in `order.json`, and still on the dev build's levels screen,
 * but never played. The dev build switches them on and off through the dev
 * server, the way it writes the order.
 *
 * Pure, so the rules for a file that has drifted from the directory are tested
 * rather than hoped for.
 */

/** The slugs in `disabled.json`, or null when the file is not a list of them. */
export function parseDisabledLevels(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  return value.every((slug) => typeof slug === 'string') ? value : null
}

export type DisabledLevels = {
  /** The listed slugs that are levels, each once. */
  readonly disabled: readonly string[]
  readonly problems: readonly string[]
}

/**
 * The listed slugs that name a level. A slug with no level is dropped and
 * reported. Disabling every level would leave no campaign, so then none is
 * disabled, and that is reported too.
 */
export function applyDisabledLevels(
  levels: readonly { readonly slug: string }[],
  listed: readonly string[],
): DisabledLevels {
  const slugs = new Set(levels.map((level) => level.slug))
  const disabled: string[] = []
  const problems: string[] = []

  for (const slug of listed) {
    if (!slugs.has(slug)) {
      problems.push(
        `disabled.json: lists "${slug}", which is not a level in levels/.`,
      )
      continue
    }

    if (!disabled.includes(slug)) {
      disabled.push(slug)
    }
  }

  if (levels.length > 0 && disabled.length === levels.length) {
    return {
      disabled: [],
      problems: [
        ...problems,
        'disabled.json: disables every level, so none is disabled.',
      ],
    }
  }

  return { disabled, problems }
}
