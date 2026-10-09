/**
 * The board palette, shared by the game renderer and the editor so the level
 * you draw looks like the level you play. When themes land this becomes the
 * default theme's values rather than a module anything imports directly.
 */
export const COLORS = {
  floor: '#262b38',
  wall: '#4b5570',
  wallEdge: '#5e6a88',
  goal: '#6d5a3f',
  box: '#c08552',
  boxDone: '#6faf6a',
  player: '#63a8e0',
}

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/

/**
 * The one way a colour an author picked arrives from outside the program — a
 * bundle's `level.json`, the editor's autosave, a colour input's own string.
 * `#rrggbb` lowercase, which is the colour input's format, and null for anything
 * else: a colour the canvas would reject is silently no colour at all, so it is
 * better to have nowhere for it to get in.
 *
 * Shared because both sides of `levels/` need it: the editor reads the ink and
 * the ground colour its controls hand back, and the game reads the ground colour
 * a bundle states.
 */
export function readHexColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const color = value.trim().toLowerCase()

  return HEX_COLOR_PATTERN.test(color) ? color : null
}
