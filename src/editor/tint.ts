/**
 * What a tint does to the pixels under it.
 *
 * `multiply` keeps the art's own shading and darkens it toward the colour, so a
 * white tile becomes that colour exactly and a multicoloured one is shaded
 * rather than repainted. It can only ever darken, which is the price of white
 * being its no-op. `flat` keeps nothing but the tile's alpha and throws the
 * luminance away, so every pixel the tile has becomes the colour — the full
 * gamut, and what a monochrome stencil actually wants.
 *
 * For a tile whose ink is already white the two are indistinguishable, which is
 * exactly why the author says which rather than the editor inferring it from
 * the art — the same reason `onTop` and `overwrite` are a choice.
 */
type TintMode = 'multiply' | 'flat'

export type Tint = {
  /** `#rrggbb`, lowercase — the colour input's own format. */
  readonly color: string
  readonly mode: TintMode
}

const WHITE = '#ffffff'

/**
 * Multiplying by white changes nothing, so "no tint" is a value rather than an
 * absence: nothing has an optional field to branch on, and a tile that was
 * never tinted is the same tile as one tinted back to white.
 */
export const NO_TINT: Tint = { color: WHITE, mode: 'multiply' }

/** Only `multiply` has a no-op: a flat white repaints a coloured tile white. */
export function isIdentityTint(tint: Tint): boolean {
  return tint.mode === 'multiply' && tint.color === WHITE
}

export function isSameTint(tint: Tint, other: Tint): boolean {
  return tint.color === other.color && tint.mode === other.mode
}

/** Two tiles share an atlas column only if this matches as well as the index. */
export function getTintKey(tint: Tint): string {
  return `${tint.mode}:${tint.color}`
}

const COLOR_PATTERN = /^#[0-9a-f]{6}$/

function readTintColor(value: unknown): string {
  if (typeof value !== 'string') {
    return WHITE
  }

  const color = value.trim().toLowerCase()

  return COLOR_PATTERN.test(color) ? color : WHITE
}

/**
 * The one way a tint is built from values that have not been checked — storage,
 * a hand edit in devtools, the colour input's own string. Anything unusable
 * reads as no tint rather than as a colour the canvas would reject silently.
 */
export function readTint(value: unknown): Tint {
  if (typeof value !== 'object' || value === null) {
    return NO_TINT
  }

  const record = value as Record<string, unknown>

  return {
    color: readTintColor(record.color),
    mode: record.mode === 'flat' ? 'flat' : 'multiply',
  }
}
