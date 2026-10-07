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
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context is unavailable')

  return function render(state: State): void {
    const { level, player, boxes } = state

    const dpr = window.devicePixelRatio || 1
    const cssWidth = canvas.clientWidth
    const cssHeight = canvas.clientHeight
    canvas.width = Math.round(cssWidth * dpr)
    canvas.height = Math.round(cssHeight * dpr)

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssWidth, cssHeight)

    const tile = Math.floor(Math.min(cssWidth / level.width, cssHeight / level.height))
    const originX = Math.floor((cssWidth - tile * level.width) / 2)
    const originY = Math.floor((cssHeight - tile * level.height) / 2)
    const at = (i: number) => ({
      x: originX + (i % level.width) * tile,
      y: originY + Math.floor(i / level.width) * tile,
    })

    for (let i = 0; i < level.walls.length; i++) {
      const { x, y } = at(i)

      if (level.walls[i]) {
        // Only walls touching the playfield are drawn, so the unreachable
        // void around the level stays empty instead of becoming a slab.
        if (!touchesFloor(level, i)) continue
        ctx.fillStyle = COLORS.wall
        ctx.fillRect(x, y, tile, tile)
        ctx.fillStyle = COLORS.wallEdge
        ctx.fillRect(x, y, tile, Math.max(1, Math.round(tile * 0.12)))
        continue
      }

      ctx.fillStyle = COLORS.floor
      ctx.fillRect(x, y, tile, tile)

      if (level.goals.has(i)) {
        ctx.fillStyle = COLORS.goal
        const r = tile * 0.16
        ctx.beginPath()
        ctx.arc(x + tile / 2, y + tile / 2, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    for (const box of boxes) {
      const { x, y } = at(box)
      const pad = tile * 0.14
      ctx.fillStyle = level.goals.has(box) ? COLORS.boxDone : COLORS.box
      roundRect(ctx, x + pad, y + pad, tile - pad * 2, tile - pad * 2, tile * 0.16)
      ctx.fill()
    }

    const { x, y } = at(player)
    ctx.fillStyle = COLORS.player
    ctx.beginPath()
    ctx.arc(x + tile / 2, y + tile / 2, tile * 0.33, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** True if any of the 8 surrounding cells is playable floor. */
function touchesFloor(level: Level, i: number): boolean {
  const x = i % level.width
  const y = Math.floor(i / level.width)
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || nx >= level.width || ny < 0 || ny >= level.height) continue
      if (!level.walls[ny * level.width + nx]) return true
    }
  }
  return false
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
