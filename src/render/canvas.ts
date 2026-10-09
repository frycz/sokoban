import {
  getPositionFromCoordinates,
  getPositionX,
  getPositionY,
} from '../core/rules'
import type { Level, LevelState } from '../core/types'
import { COLORS } from './colors'
import type { CustomTileMap } from './custom-tiles'
import {
  getRoleColor,
  getSkinColumnRect,
  getSkinTileRect,
  type Skin,
} from './skin'
import { getWallRole, type TileRole } from './tile-roles'

type BoardLayout = {
  readonly tile: number
  readonly originX: number
  readonly originY: number
}

/**
 * `(state) => draw`, and nothing else: no event listeners, no game rules, no
 * knowledge of history. A full redraw every time keeps the renderer a pure
 * function of state with nothing to invalidate, and a Sokoban board is small
 * enough that the cost is irrelevant.
 *
 * With a skin it draws the level's own tiles, and without one the procedural
 * palette — which is also what a level exported with no tiles plays as.
 *
 * `customTiles` are the cells the level's author gave a tile of their own. They
 * are columns in the atlas, so they need the skin: a bundle with tiles.json and
 * no skin.png has nothing for them to index, and the board draws without them.
 *
 * `groundColor` is the colour under the whole board, or null for none. Like the
 * tiles it is the level's own, fixed for its lifetime, which is why it is a
 * constructor argument rather than something read off the state.
 */
export function createRenderer(
  canvas: HTMLCanvasElement,
  skin: Skin | null = null,
  customTiles: CustomTileMap | null = null,
  groundColor: string | null = null,
): (levelState: LevelState) => void {
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas 2D context is unavailable')
  }

  return function render(levelState: LevelState): void {
    const layout = prepareCanvas(canvas, context, levelState.level, groundColor)

    if (skin) {
      context.imageSmoothingEnabled = !skin.isPixelated
      drawSkinnedBoard(context, levelState, layout, skin, customTiles)

      return
    }

    drawProceduralBoard(context, levelState, layout)
  }
}

/**
 * Resizes the backing store to the element, clears it, lays the ground colour
 * down if the level has one, and works out where the board sits. Shared by both
 * painters so a skinned and an unskinned board land on exactly the same grid —
 * and so the ground is under both.
 *
 * The ground covers the board's own rectangle rather than the whole canvas: it
 * is the level's backdrop, not the page's, so the letterboxing around a board
 * that does not match the canvas's shape stays the page's colour.
 *
 * Under everything, which is the whole point: it fills the cells the silhouette
 * culls, it shows through every transparent pixel the skin has, and a level with
 * a ground and no tiles at all is that colour and nothing else.
 */
function prepareCanvas(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  level: Level,
  groundColor: string | null,
): BoardLayout {
  const pixelRatio = window.devicePixelRatio || 1
  const cssWidth = canvas.clientWidth
  const cssHeight = canvas.clientHeight
  canvas.width = Math.round(cssWidth * pixelRatio)
  canvas.height = Math.round(cssHeight * pixelRatio)

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  context.clearRect(0, 0, cssWidth, cssHeight)

  const tile = Math.floor(
    Math.min(cssWidth / level.width, cssHeight / level.height),
  )

  const layout = {
    tile,
    originX: Math.floor((cssWidth - tile * level.width) / 2),
    originY: Math.floor((cssHeight - tile * level.height) / 2),
  }

  if (groundColor !== null) {
    context.fillStyle = groundColor
    context.fillRect(
      layout.originX,
      layout.originY,
      tile * level.width,
      tile * level.height,
    )
  }

  return layout
}

function getTopLeft(
  level: Level,
  layout: BoardLayout,
  position: number,
): { readonly x: number; readonly y: number } {
  return {
    x: layout.originX + getPositionX(level, position) * layout.tile,
    y: layout.originY + getPositionY(level, position) * layout.tile,
  }
}

/**
 * Layer order, which is also what the skin format asks of the art: floor under
 * every cell of the board, walls included, then wall or goal over it, then the
 * object over both, and last anything the author placed by hand. Floor being a
 * layer rather than a tile the others replace is what lets every other tile use
 * transparency.
 */
function drawSkinnedBoard(
  context: CanvasRenderingContext2D,
  levelState: LevelState,
  layout: BoardLayout,
  skin: Skin,
  customTiles: CustomTileMap | null,
): void {
  const { level, playerCurrentPosition, boxPositions } = levelState

  const drawRole = (role: TileRole, x: number, y: number): void => {
    const rect = getSkinTileRect(skin, role)

    if (!rect) {
      // A manifest missing a role it was supposed to carry. Flat colour keeps
      // the board readable instead of leaving a hole in it.
      context.fillStyle = getRoleColor(role)
      context.fillRect(x, y, layout.tile, layout.tile)

      return
    }

    context.drawImage(
      skin.image,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      x,
      y,
      layout.tile,
      layout.tile,
    )
  }

  // A cell the author chose to overwrite is the placed tile and nothing else,
  // so none of the skin's layers go down under it — which is what makes a
  // transparent tile a hole in the board rather than a window onto the floor.
  const isOverwritten = (position: number): boolean =>
    customTiles?.get(position)?.mode === 'overwrite'

  for (let position = 0; position < level.wallMap.length; position++) {
    const isWall = level.wallMap[position]

    // Outside the level nothing is drawn at all, not even floor, so a skin
    // never has to supply art for it and the board keeps its silhouette.
    if (isWall && !touchesFloor(level, position)) {
      continue
    }

    if (isOverwritten(position)) {
      continue
    }

    const { x, y } = getTopLeft(level, layout, position)
    drawRole('floor', x, y)

    if (isWall) {
      drawRole(getWallRoleAt(level, position), x, y)
      continue
    }

    if (level.goalPositions.has(position)) {
      drawRole('goal', x, y)
    }
  }

  for (const box of boxPositions) {
    if (isOverwritten(box)) {
      continue
    }

    const { x, y } = getTopLeft(level, layout, box)
    drawRole(level.goalPositions.has(box) ? 'boxOnGoal' : 'box', x, y)
  }

  if (!isOverwritten(playerCurrentPosition)) {
    const player = getTopLeft(level, layout, playerCurrentPosition)
    drawRole('player', player.x, player.y)
  }

  if (!customTiles) {
    return
  }

  // Last, over everything, and over the cells the silhouette culled too: the
  // author said what this cell looks like, which outranks both the skin's answer
  // and the board's own outline.
  for (const [position, placement] of customTiles) {
    if (position >= level.wallMap.length) {
      continue
    }

    const rect = getSkinColumnRect(skin, placement.column)

    if (!rect) {
      continue
    }

    const { x, y } = getTopLeft(level, layout, position)
    context.drawImage(
      skin.image,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      x,
      y,
      layout.tile,
      layout.tile,
    )
  }
}

/** The same board in flat colour, for a level that shipped without tiles. */
function drawProceduralBoard(
  context: CanvasRenderingContext2D,
  levelState: LevelState,
  layout: BoardLayout,
): void {
  const { level, playerCurrentPosition, boxPositions } = levelState
  const { tile } = layout

  for (let position = 0; position < level.wallMap.length; position++) {
    const { x, y } = getTopLeft(level, layout, position)
    const isWall = level.wallMap[position]

    if (isWall && !touchesFloor(level, position)) {
      continue
    }

    context.fillStyle = COLORS.floor
    context.fillRect(x, y, tile, tile)

    if (isWall) {
      context.fillStyle = COLORS.wall
      context.fillRect(x, y, tile, tile)
      context.fillStyle = COLORS.wallEdge
      context.fillRect(x, y, tile, Math.max(1, Math.round(tile * 0.12)))
      continue
    }

    if (level.goalPositions.has(position)) {
      context.fillStyle = COLORS.goal
      context.beginPath()
      context.arc(x + tile / 2, y + tile / 2, tile * 0.16, 0, Math.PI * 2)
      context.fill()
    }
  }

  for (const box of boxPositions) {
    const { x, y } = getTopLeft(level, layout, box)
    const padding = tile * 0.14
    context.fillStyle = level.goalPositions.has(box)
      ? COLORS.boxDone
      : COLORS.box
    roundedRectanglePath(
      context,
      x + padding,
      y + padding,
      tile - padding * 2,
      tile - padding * 2,
      tile * 0.16,
    )
    context.fill()
  }

  const { x, y } = getTopLeft(level, layout, playerCurrentPosition)
  context.fillStyle = COLORS.player
  context.beginPath()
  context.arc(x + tile / 2, y + tile / 2, tile * 0.33, 0, Math.PI * 2)
  context.fill()
}

function isOpenAt(level: Level, x: number, y: number): boolean {
  // Off the grid counts as wall, so the outer edge does not read as an exposed
  // face. The parser seals every level anyway; this keeps it true regardless.
  if (x < 0 || x >= level.width || y < 0 || y >= level.height) {
    return false
  }

  return !level.wallMap[getPositionFromCoordinates(x, y, level.width)]
}

/**
 * Which of the nine wall pieces this cell takes. The classifier itself is in
 * `tile-roles.ts`, shared with the editor, so the level you draw and the level
 * you play cannot disagree about which piece a wall gets; this only reads the
 * neighbourhood off a `Level`.
 */
function getWallRoleAt(level: Level, position: number): TileRole {
  const x = getPositionX(level, position)
  const y = getPositionY(level, position)

  return getWallRole({
    north: isOpenAt(level, x, y - 1),
    east: isOpenAt(level, x + 1, y),
    south: isOpenAt(level, x, y + 1),
    west: isOpenAt(level, x - 1, y),
    northEast: isOpenAt(level, x + 1, y - 1),
    southEast: isOpenAt(level, x + 1, y + 1),
    southWest: isOpenAt(level, x - 1, y + 1),
    northWest: isOpenAt(level, x - 1, y - 1),
  })
}

function touchesFloor(level: Level, position: number): boolean {
  const x = getPositionX(level, position)
  const y = getPositionY(level, position)

  for (let offsetY = -1; offsetY <= 1; offsetY++) {
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      if (isOpenAt(level, x + offsetX, y + offsetY)) {
        return true
      }
    }
  }

  return false
}

function roundedRectanglePath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.arcTo(x + width, y, x + width, y + height, radius)
  context.arcTo(x + width, y + height, x, y + height, radius)
  context.arcTo(x, y + height, x, y, radius)
  context.arcTo(x, y, x + width, y, radius)
  context.closePath()
}
