import { COLORS } from '../render/colors'
import { prepareBackingStore } from './backing-store'
import { getCellX, getCellY, type EditorDocument } from './document'
import { computeGridLayout } from './layout'

const EDITOR_COLORS = {
  grid: '#1b1f29',
  hover: '#ffffff',
}

/**
 * Draws a document and nothing else. No pointer handling, no undo, no brush —
 * the same deal the game renderer has with `LevelState`.
 *
 * Unlike the game, every wall is drawn: in the editor there is no "outside the
 * level" to hide, because the walls are the thing being edited.
 *
 * `view` is the scroll container; the canvas is sized to the zoomed content so
 * that panning is the browser's job rather than a second transform to invert —
 * the sheet palette works the same way.
 */
export function createEditorRenderer(
  view: HTMLElement,
  canvas: HTMLCanvasElement,
): (
  editorDocument: EditorDocument,
  hoverPosition: number,
  zoom: number,
) => void {
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas 2D context is unavailable')
  }

  return function render(
    editorDocument: EditorDocument,
    hoverPosition: number,
    zoom: number,
  ): void {
    const layout = computeGridLayout(
      editorDocument,
      view.clientWidth,
      view.clientHeight,
      zoom,
    )
    prepareBackingStore(
      canvas,
      context,
      layout.contentWidth,
      layout.contentHeight,
    )

    const { tileSize } = layout
    const topLeftOf = (position: number) => ({
      x: layout.originX + getCellX(editorDocument, position) * tileSize,
      y: layout.originY + getCellY(editorDocument, position) * tileSize,
    })

    // Floor under every cell, walls included, then everything else over it —
    // the same layer order the game renderer and the skin preview use.
    for (let position = 0; position < editorDocument.cells.length; position++) {
      const cell = editorDocument.cells[position]
      const { x, y } = topLeftOf(position)

      context.fillStyle = COLORS.floor
      context.fillRect(x, y, tileSize, tileSize)

      if (cell.isWall) {
        context.fillStyle = COLORS.wall
        context.fillRect(x, y, tileSize, tileSize)
        context.fillStyle = COLORS.wallEdge
        context.fillRect(
          x,
          y,
          tileSize,
          Math.max(1, Math.round(tileSize * 0.12)),
        )
        continue
      }

      if (cell.isGoal) {
        context.fillStyle = COLORS.goal
        context.beginPath()
        context.arc(
          x + tileSize / 2,
          y + tileSize / 2,
          tileSize * 0.16,
          0,
          Math.PI * 2,
        )
        context.fill()
      }
    }

    context.strokeStyle = EDITOR_COLORS.grid
    context.lineWidth = 1

    for (let x = 0; x <= editorDocument.width; x++) {
      const lineX = layout.originX + x * tileSize + 0.5
      context.beginPath()
      context.moveTo(lineX, layout.originY)
      context.lineTo(lineX, layout.originY + editorDocument.height * tileSize)
      context.stroke()
    }

    for (let y = 0; y <= editorDocument.height; y++) {
      const lineY = layout.originY + y * tileSize + 0.5
      context.beginPath()
      context.moveTo(layout.originX, lineY)
      context.lineTo(layout.originX + editorDocument.width * tileSize, lineY)
      context.stroke()
    }

    for (let position = 0; position < editorDocument.cells.length; position++) {
      const cell = editorDocument.cells[position]

      if (cell.content !== 'box') {
        continue
      }

      const { x, y } = topLeftOf(position)
      const padding = tileSize * 0.14
      context.fillStyle = cell.isGoal ? COLORS.boxDone : COLORS.box
      roundedRectanglePath(
        context,
        x + padding,
        y + padding,
        tileSize - padding * 2,
        tileSize - padding * 2,
        tileSize * 0.16,
      )
      context.fill()
    }

    for (let position = 0; position < editorDocument.cells.length; position++) {
      if (editorDocument.cells[position].content !== 'player') {
        continue
      }

      const { x, y } = topLeftOf(position)
      context.fillStyle = COLORS.player
      context.beginPath()
      context.arc(
        x + tileSize / 2,
        y + tileSize / 2,
        tileSize * 0.33,
        0,
        Math.PI * 2,
      )
      context.fill()
    }

    if (hoverPosition >= 0 && hoverPosition < editorDocument.cells.length) {
      const { x, y } = topLeftOf(hoverPosition)
      context.strokeStyle = EDITOR_COLORS.hover
      context.lineWidth = 2
      context.strokeRect(x + 1, y + 1, tileSize - 2, tileSize - 2)
    }
  }
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
