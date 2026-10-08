/**
 * The order roles appear in an exported atlas, left to right, and the order the
 * skin manifest records. Growing the set — wall autotile variants, ice,
 * conveyors — is appending entries here and widening the image; a manifest
 * names its own roles, so older skins keep loading unchanged.
 */
export const ROLE_ORDER = [
  'floor',
  'goal',
  'wall',
  'box',
  'boxOnGoal',
  'player',
] as const

/**
 * What a renderer paints, as opposed to what the level format spells. Derived
 * from state, never stored: the game reads it off `LevelState`, the editor off a
 * `Cell`. Deliberately not the seven XSB characters — `boxOnGoal` is its own
 * sprite because it is the only "this one is done" signal on the board.
 */
export type TileRole = (typeof ROLE_ORDER)[number]
