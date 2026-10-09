import { readHexColor } from '../render/colors'

/**
 * Hex as an author types or pastes it, which is looser than what the program
 * stores. `#rrggbb` lowercase is the only shape anything downstream accepts —
 * see `readHexColor` — but nobody types the `#`, palette sites hand out bare
 * `1a1c2c`, and CSS is full of `#fff`. So this is the one widening, and it
 * widens *into* `readHexColor` rather than around it: every colour still leaves
 * here in the one format, or does not leave at all.
 */
const SHORTHAND_LENGTH = 3

/** One field's worth: a whole string that has to be a colour, or nothing. */
export function parseHexColor(text: string): string | null {
  const digits = text.trim().replace(/^#/, '').toLowerCase()

  if (digits.length === SHORTHAND_LENGTH) {
    return readHexColor(
      `#${[...digits].map((digit) => `${digit}${digit}`).join('')}`,
    )
  }

  return readHexColor(`#${digits}`)
}

/**
 * Every colour in a block of pasted text, in the order they appear — a comma
 * list, a column, a CSS snippet, a JSON array.
 *
 * Tokenised rather than scanned for hex-looking windows, because a token has to
 * be a colour *whole*: `#ffffffaa` is a format this program does not have, and
 * finding `#ffffff` inside it would silently drop the alpha rather than say it
 * could not read it. The cost is that a word spelled in hex letters — `add`,
 * `face` — is a colour here. That is the right trade for a box labelled "paste
 * hex colours", and the count that comes back is how an author sees it happen.
 */
export function parseHexColors(text: string): readonly string[] {
  const colors: string[] = []

  // The lookahead splits before a `#` as well, so colours run together with no
  // separator at all still arrive as separate tokens.
  for (const token of text.split(/[^#0-9a-fA-F]+|(?=#)/)) {
    const color = parseHexColor(token)

    if (color !== null) {
      colors.push(color)
    }
  }

  return colors
}

/** The way back out: one per line, which is what a paste box is read from. */
export function formatHexColors(colors: readonly string[]): string {
  return colors.join('\n')
}
