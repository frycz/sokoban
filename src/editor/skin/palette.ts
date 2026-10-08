import {
  getSheetGrid,
  getSourceTileRect,
  type SheetSettings,
} from '../../render/sheet'
import { computeSheetLayout } from './palette-layout'

const PALETTE_COLORS = {
  empty: '#7d8699',
  grid: 'rgba(255, 255, 255, 0.14)',
  selection: '#63a8e0',
}

/**
 * Draws the loaded sheet at its own grid, scaled to fit times the zoom, with
 * the selected tile ringed. Keeping the sheet's layout rather than reflowing
 * tiles into a list means the pointer handler can invert the same pure layout
 * maths to work out what was clicked.
 *
 * `view` is the scroll container; the canvas is sized to the zoomed content so
 * that panning is the browser's job rather than a second transform to invert.
 */
export function createPalettePainter(
  view: HTMLElement,
  canvas: HTMLCanvasElement,
): (
  image: ImageBitmap | null,
  settings: SheetSettings,
  isPixelated: boolean,
  selectedTileIndex: number,
  zoom: number,
) => void {
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas 2D context is unavailable')
  }

  return function paint(
    image,
    settings,
    isPixelated,
    selectedTileIndex,
    zoom,
  ): void {
    const layout = computeSheetLayout(
      image?.width ?? 0,
      image?.height ?? 0,
      view.clientWidth,
      view.clientHeight,
      zoom,
    )
    const cssWidth = layout.contentWidth
    const cssHeight = layout.contentHeight
    const pixelRatio = window.devicePixelRatio || 1

    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${cssHeight}px`
    canvas.width = Math.round(cssWidth * pixelRatio)
    canvas.height = Math.round(cssHeight * pixelRatio)

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.clearRect(0, 0, cssWidth, cssHeight)
    context.imageSmoothingEnabled = !isPixelated

    if (!image) {
      context.fillStyle = PALETTE_COLORS.empty
      context.font = '12px ui-monospace, monospace'
      context.textAlign = 'center'
      context.fillText('Load a tile sheet', cssWidth / 2, cssHeight / 2)

      return
    }

    const grid = getSheetGrid(settings, image.width, image.height)

    context.drawImage(
      image,
      layout.originX,
      layout.originY,
      image.width * layout.scale,
      image.height * layout.scale,
    )

    context.lineWidth = 1
    context.strokeStyle = PALETTE_COLORS.grid

    for (let tileIndex = 0; tileIndex < grid.tileCount; tileIndex++) {
      const rect = getSourceTileRect(settings, grid, tileIndex)
      context.strokeRect(
        layout.originX + rect.x * layout.scale + 0.5,
        layout.originY + rect.y * layout.scale + 0.5,
        rect.width * layout.scale,
        rect.height * layout.scale,
      )
    }

    if (selectedTileIndex >= 0 && selectedTileIndex < grid.tileCount) {
      const rect = getSourceTileRect(settings, grid, selectedTileIndex)
      context.lineWidth = 2
      context.strokeStyle = PALETTE_COLORS.selection
      context.strokeRect(
        layout.originX + rect.x * layout.scale - 1,
        layout.originY + rect.y * layout.scale - 1,
        rect.width * layout.scale + 2,
        rect.height * layout.scale + 2,
      )
    }
  }
}
