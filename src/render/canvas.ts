import {
  getPositionFromCoordinates,
  getPositionX,
  getPositionY,
} from '../core/rules'
import type { Level, LevelState } from '../core/types'
import { COLORS } from './colors'
import {
  DEFAULT_LAYER_STACK,
  type BuiltInLayer,
  type LayerStack,
} from './layers'
import {
  getRoleColor,
  getSkinColumnRect,
  getSkinTileRect,
  type Skin,
} from './skin'
import { getWallRole, type TileRole } from './tile-roles'

/**
 * A move in flight: the state it left and how far along it is, 0 to 1. The
 * board is the same at both ends, so only the player and a pushed box are drawn
 * between cells; the caller owns the clock and the easing.
 */
export type Motion = {
  readonly from: LevelState
  readonly progress: number
}

type Point = { readonly x: number; readonly y: number }

/** Where each movable piece is drawn this frame, by its cell in the state. */
type PiecePoint = (position: number) => Point

/**
 * The largest a cell is ever drawn, in CSS pixels. Without a cap the board
 * always fills the canvas, so a small level got huge tiles and a big one small
 * tiles; with it every level that fits plays at the same scale, and only a
 * board too big for the screen shrinks. 48 is a whole multiple of a 16px skin,
 * so pixel art stays square at full size.
 */
const MAX_TILE_PX = 48

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
 * `layers` is the level's draw order, bottom first, with the art layers the
 * author painted between the built-in ones. Art tiles are columns in the atlas,
 * so they need the skin: a bundle with tiles.json and no skin.png has nothing
 * for them to index, and the board draws in the default order without them.
 *
 * `groundColor` is the colour under the whole board, or null for none. Like the
 * tiles it is the level's own, fixed for its lifetime, which is why it is a
 * constructor argument rather than something read off the state.
 *
 * `motion` is the one thing that is not state: without it the pieces sit on
 * their cells, with it they are drawn part way from where `motion.from` had
 * them.
 */
export function createRenderer(
  canvas: HTMLCanvasElement,
  skin: Skin | null = null,
  layers: LayerStack = DEFAULT_LAYER_STACK,
  groundColor: string | null = null,
): (levelState: LevelState, motion?: Motion) => void {
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas 2D context is unavailable')
  }

  return function render(levelState: LevelState, motion?: Motion): void {
    const layout = prepareCanvas(canvas, context, levelState.level, groundColor)
    const piecePoint = createPiecePoint(levelState, layout, motion)

    if (skin) {
      context.imageSmoothingEnabled = !skin.isPixelated
      drawSkinnedBoard(
        context,
        levelState,
        layout,
        piecePoint,
        skin,
        layers,
        groundColor,
      )

      return
    }

    drawProceduralBoard(context, levelState, layout, piecePoint, groundColor)
  }
}

/**
 * The player came from wherever `motion.from` had it, and a pushed box from the
 * one cell `from` had a box on that the state does not — a push moves exactly
 * one. Undo is the same move backwards, so it needs nothing of its own.
 */
function createPiecePoint(
  levelState: LevelState,
  layout: BoardLayout,
  motion: Motion | undefined,
): PiecePoint {
  const { level } = levelState
  const atCell = (position: number): Point =>
    getTopLeft(level, layout, position)

  if (!motion || motion.progress >= 1) {
    return atCell
  }

  const { from, progress } = motion
  const origins = new Map<number, number>([
    [levelState.playerCurrentPosition, from.playerCurrentPosition],
  ])
  const left = [...from.boxPositions].filter(
    (box) => !levelState.boxPositions.has(box),
  )
  const arrived = [...levelState.boxPositions].filter(
    (box) => !from.boxPositions.has(box),
  )

  arrived.forEach((box, index) => {
    if (index < left.length) {
      origins.set(box, left[index])
    }
  })

  return (position) => {
    const to = atCell(position)
    const origin = origins.get(position)

    if (origin === undefined) {
      return to
    }

    const start = atCell(origin)

    // Whole pixels, so a pixel-art skin does not smear between cells.
    return {
      x: Math.round(start.x + (to.x - start.x) * progress),
      y: Math.round(start.y + (to.y - start.y) * progress),
    }
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
    Math.min(MAX_TILE_PX, cssWidth / level.width, cssHeight / level.height),
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
): Point {
  return {
    x: layout.originX + getPositionX(level, position) * layout.tile,
    y: layout.originY + getPositionY(level, position) * layout.tile,
  }
}

/**
 * The level's own stack, bottom first: built-in layers are drawn from the state,
 * art layers from the atlas columns the author placed. Floor being a layer
 * rather than a tile the others replace is what lets every other tile use
 * transparency, and the order being data rather than code is what lets an art
 * layer sit between any two of them.
 */
function drawSkinnedBoard(
  context: CanvasRenderingContext2D,
  levelState: LevelState,
  layout: BoardLayout,
  piecePoint: PiecePoint,
  skin: Skin,
  layers: LayerStack,
  groundColor: string | null,
): void {
  const { level, playerCurrentPosition, boxPositions } = levelState

  const drawRole = (role: TileRole, position: number): void => {
    drawRoleAt(role, getTopLeft(level, layout, position))
  }

  const drawRoleAt = (role: TileRole, { x, y }: Point): void => {
    const rect = getSkinTileRect(skin, role)

    if (!rect) {
      // A manifest missing a role it was supposed to carry. Flat colour keeps
      // the board readable instead of leaving a hole in it — except a floor
      // over a ground, where the ground is what should show.
      if (role === 'floor' && groundColor !== null) {
        return
      }

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

  // Outside the level nothing built in is drawn at all, not even floor, so a
  // skin never has to supply art for it and the board keeps its silhouette.
  const isOnBoard = (position: number): boolean =>
    !level.wallMap[position] || touchesFloor(level, position)

  const drawBuiltIn = (id: BuiltInLayer): void => {
    switch (id) {
      case 'floor':
        for (let position = 0; position < level.wallMap.length; position++) {
          if (isOnBoard(position)) {
            drawRole('floor', position)
          }
        }

        return
      case 'walls':
        for (let position = 0; position < level.wallMap.length; position++) {
          if (level.wallMap[position] && isOnBoard(position)) {
            drawRole(getWallRoleAt(level, position), position)
          }
        }

        return
      case 'goals':
        for (const goal of level.goalPositions) {
          drawRole('goal', goal)
        }

        return
      case 'boxes':
        for (const box of boxPositions) {
          drawRoleAt(
            level.goalPositions.has(box) ? 'boxOnGoal' : 'box',
            piecePoint(box),
          )
        }

        return
      case 'player':
        drawRoleAt('player', piecePoint(playerCurrentPosition))

        return
    }
  }

  for (const layer of layers) {
    if (layer.kind === 'builtIn') {
      drawBuiltIn(layer.id)
      continue
    }

    // Over the cells the silhouette culled too: the author said what this cell
    // looks like, which outranks the board's own outline.
    for (const [position, column] of layer.tiles) {
      if (position >= level.wallMap.length) {
        continue
      }

      const rect = getSkinColumnRect(skin, column)

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
}

/** The same board in flat colour, for a level that shipped without tiles. */
function drawProceduralBoard(
  context: CanvasRenderingContext2D,
  levelState: LevelState,
  layout: BoardLayout,
  piecePoint: PiecePoint,
  groundColor: string | null,
): void {
  const { level, playerCurrentPosition, boxPositions } = levelState
  const { tile } = layout

  for (let position = 0; position < level.wallMap.length; position++) {
    const { x, y } = getTopLeft(level, layout, position)
    const isWall = level.wallMap[position]

    if (isWall && !touchesFloor(level, position)) {
      continue
    }

    // With a ground there is no floor tile to draw: the ground is the floor.
    if (groundColor === null) {
      context.fillStyle = COLORS.floor
      context.fillRect(x, y, tile, tile)
    }

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
    const { x, y } = piecePoint(box)
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

  const { x, y } = piecePoint(playerCurrentPosition)
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
