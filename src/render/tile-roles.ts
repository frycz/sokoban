/**
 * The order roles appear in an exported atlas, left to right. A manifest names
 * the roles it actually contains, so growing this list does not break skins
 * already exported — and a skin need not bind all of it.
 */
export const ROLE_ORDER = [
  'floor',
  'goal',
  'wall',
  'wallTop',
  'wallRight',
  'wallBottom',
  'wallLeft',
  'wallTopLeft',
  'wallTopRight',
  'wallBottomRight',
  'wallBottomLeft',
  'box',
  'boxOnGoal',
  'player',
] as const

/**
 * What a renderer paints, as opposed to what the level format spells. Derived
 * from state, never stored: the game reads it off `LevelState`, the editor off a
 * document. Deliberately not the seven XSB characters — `boxOnGoal` is its own
 * sprite because it is the only "this one is done" signal on the board.
 */
export type TileRole = (typeof ROLE_ORDER)[number]

/**
 * Without these six nothing can be drawn, so they gate an export. Everything
 * else refines and is optional.
 */
export const REQUIRED_ROLES = [
  'floor',
  'goal',
  'wall',
  'box',
  'boxOnGoal',
  'player',
] as const

/**
 * The eight edge and corner pieces. Optional: a skin that binds only `wall`
 * renders every wall as that one flat tile, which is what a six-tile skin did
 * before these existed.
 */
export const WALL_VARIANT_ROLES = [
  'wallTop',
  'wallRight',
  'wallBottom',
  'wallLeft',
  'wallTopLeft',
  'wallTopRight',
  'wallBottomRight',
  'wallBottomLeft',
] as const

const WALL_VARIANTS: ReadonlySet<string> = new Set(WALL_VARIANT_ROLES)

export function isWallVariantRole(role: TileRole): boolean {
  return WALL_VARIANTS.has(role)
}

/**
 * What to draw instead when a role has no tile. The one place this mapping
 * lives, so the editor's preview and the game agree about an incomplete skin.
 */
export function getBaseRole(role: TileRole): TileRole {
  return isWallVariantRole(role) ? 'wall' : role
}

/**
 * Which of a wall cell's eight neighbours are open — that is, not wall. All
 * eight, not just the four sides, because the corner of a one-cell-thick
 * border touches the room only diagonally: `#####` over `#   #` has no floor
 * orthogonally adjacent to its top-left cell, so four neighbours can never
 * tell a corner from a buried block.
 */
export type WallNeighbourhood = {
  readonly north: boolean
  readonly east: boolean
  readonly south: boolean
  readonly west: boolean
  readonly northEast: boolean
  readonly southEast: boolean
  readonly southWest: boolean
  readonly northWest: boolean
}

/**
 * A piece is named for where it sits in the frame **around** the floor, not for
 * which of its own faces is exposed — those are opposites. Floor to the south
 * means this cell is the top edge of the wall enclosing it, so it takes
 * `wallTop`; floor to the south-east makes it the frame's top-left corner.
 *
 * Getting this backwards renders a room inside out, with the cap of each wall
 * facing away from the player.
 */
const EDGE_BY_OPEN_SIDE = [
  ['south', 'wallTop'],
  ['north', 'wallBottom'],
  ['east', 'wallLeft'],
  ['west', 'wallRight'],
] as const

const CORNER_BY_OPEN_DIAGONAL = [
  ['southEast', 'wallTopLeft'],
  ['southWest', 'wallTopRight'],
  ['northEast', 'wallBottomLeft'],
  ['northWest', 'wallBottomRight'],
] as const

/**
 * Picks one of the nine wall pieces for a cell from its neighbourhood.
 *
 * One open side is an edge; no open side but an open diagonal is a corner;
 * nothing open at all is the fill. Two or more open sides is either a thin wall
 * or an inner corner, and a nine-piece set has no tile for either — those
 * degrade to the first edge in priority order, which prefers the top. Resolving
 * them properly needs the 47-piece blob set, a much larger art burden.
 *
 * Note that `wall` is in practice the fallback rather than a tile that gets
 * drawn: a cell with nothing open anywhere is culled before it reaches here,
 * exactly as in the game. It stays required because every unbound piece falls
 * back to it, which is what keeps a six-tile skin working.
 */
export function getWallRole(open: WallNeighbourhood): TileRole {
  const edges = EDGE_BY_OPEN_SIDE.filter(([side]) => open[side])

  if (edges.length === 1) {
    return edges[0][1]
  }

  if (edges.length === 0) {
    const corner = CORNER_BY_OPEN_DIAGONAL.find(([diagonal]) => open[diagonal])

    return corner ? corner[1] : 'wall'
  }

  return edges[0][1]
}
