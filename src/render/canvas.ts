import type { Level, State } from '../core/types'

const COLORS = {
  floor: '#262b38',
  wall: '#4b5570',
  wallEdge: '#5e6a88',
  goal: '#6d5a3f',
  box: '#c08552',
  boxDone: '#6faf6a',
  player: '#63a8e0',
}

/**
 * Builds a renderer bound to one canvas. The returned function is the only
 * thing the host needs, and it knows nothing beyond the state it is handed.
 */
export function createRenderer(canvas: HTMLCanvasElement): (state: State) => void {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')

  return function render(state: State): void {
    const { level, playerPosition, boxPositions } = state

    const pixelRatio = window.devicePixelRatio || 1
    const cssWidth = canvas.clientWidth
    const cssHeight = canvas.clientHeight
    canvas.width = Math.round(cssWidth * pixelRatio)
    canvas.height = Math.round(cssHeight * pixelRatio)

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.clearRect(0, 0, cssWidth, cssHeight)

    const tile = Math.floor(Math.min(cssWidth / level.width, cssHeight / level.height))
    const originX = Math.floor((cssWidth - tile * level.width) / 2)
    const originY = Math.floor((cssHeight - tile * level.height) / 2)
    const topLeftOf = (position: number) => ({
      x: originX + (position % level.width) * tile,
      y: originY + Math.floor(position / level.width) * tile,
    })

    for (let position = 0; position < level.wallMap.length; position++) {
      const { x, y } = topLeftOf(position)

      if (level.wallMap[position]) {
        // Only walls touching the playfield are drawn, so the unreachable
        // void around the level stays empty instead of becoming a slab.
        if (!touchesFloor(level, position)) continue
        context.fillStyle = COLORS.wall
        context.fillRect(x, y, tile, tile)
        context.fillStyle = COLORS.wallEdge
        context.fillRect(x, y, tile, Math.max(1, Math.round(tile * 0.12)))
        continue
      }

      context.fillStyle = COLORS.floor
      context.fillRect(x, y, tile, tile)

      if (level.goalPositions.has(position)) {
        context.fillStyle = COLORS.goal
        context.beginPath()
        context.arc(x + tile / 2, y + tile / 2, tile * 0.16, 0, Math.PI * 2)
        context.fill()
      }
    }

    for (const box of boxPositions) {
      const { x, y } = topLeftOf(box)
      const padding = tile * 0.14
      context.fillStyle = level.goalPositions.has(box) ? COLORS.boxDone : COLORS.box
      roundedRectanglePath(
        context,
        x + padding,
        y + padding,
        tile - padding * 2,
        tile - padding * 2,
        tile * 0.16
      )
      context.fill()
    }

    const { x, y } = topLeftOf(playerPosition)
    context.fillStyle = COLORS.player
    context.beginPath()
    context.arc(x + tile / 2, y + tile / 2, tile * 0.33, 0, Math.PI * 2)
    context.fill()
  }
}

/** True if any of the 8 surrounding cells is playable floor. */
function touchesFloor(level: Level, position: number): boolean {
  const x = position % level.width
  const y = Math.floor(position / level.width)
  for (let offsetY = -1; offsetY <= 1; offsetY++) {
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      const neighbourX = x + offsetX
      const neighbourY = y + offsetY
      if (neighbourX < 0 || neighbourX >= level.width) continue
      if (neighbourY < 0 || neighbourY >= level.height) continue
      if (!level.wallMap[neighbourY * level.width + neighbourX]) return true
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
  radius: number
): void {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.arcTo(x + width, y, x + width, y + height, radius)
  context.arcTo(x + width, y + height, x, y + height, radius)
  context.arcTo(x, y + height, x, y, radius)
  context.arcTo(x, y, x + width, y, radius)
  context.closePath()
}
