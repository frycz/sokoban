import type { SheetRect } from '../../render/sheet'
import { getTintKey, isIdentityTint, type Tint } from '../tint'

/**
 * One tile of a sheet, tinted, at its own size. The preview and the atlas
 * packer both go through this — including when the tint is the identity — so
 * what the editor shows and what the export writes cannot be different pixels.
 *
 * A tile of its own rather than a tint applied at the draw call, because the
 * export has to extrude the tinted edges and the preview has to scale them:
 * both need the finished pixels in isolation, and neither may sample a
 * neighbour in the sheet.
 */
export function tintSheetTile(
  image: CanvasImageSource,
  rect: SheetRect,
  tint: Tint,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = rect.width
  canvas.height = rect.height

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas 2D context is unavailable')
  }

  const drawTile = (): void =>
    context.drawImage(
      image,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      rect.width,
      rect.height,
    )

  drawTile()

  if (isIdentityTint(tint)) {
    return canvas
  }

  context.fillStyle = tint.color

  if (tint.mode === 'flat') {
    // `source-in` keeps the destination's alpha and takes the source's colour,
    // which is precisely "repaint every pixel this tile has".
    context.globalCompositeOperation = 'source-in'
    context.fillRect(0, 0, rect.width, rect.height)
  } else {
    // A blend mode still composites source-over, so an opaque fill would also
    // paint the tile's transparent pixels the tint colour. Multiply first, then
    // take the alpha back off the tile itself — which is why the source image is
    // drawn twice, and why a mask stays a mask instead of becoming a block.
    context.globalCompositeOperation = 'multiply'
    context.fillRect(0, 0, rect.width, rect.height)
    context.globalCompositeOperation = 'destination-in'
    drawTile()
  }

  if (tint.background !== null) {
    // Last, and underneath: `destination-over` only lands where the tinted tile
    // is not already opaque, so the background fills the holes and nothing else.
    context.globalCompositeOperation = 'destination-over'
    context.fillStyle = tint.background
    context.fillRect(0, 0, rect.width, rect.height)
  }

  return canvas
}

/**
 * Tinting costs a canvas and two composites, which is far too much to redo per
 * repaint: the preview draws every cell of the board on every pointer move.
 *
 * Keyed by the sheet as well as by the tile and the tint, and weakly, so
 * swapping the sheet drops that sheet's tiles without anyone having to remember
 * to invalidate anything. The tile's rect is part of the key rather than its
 * index, because re-slicing changes what an index means and a rect is what it
 * means.
 */
export function createTintedTileCache(): (
  image: CanvasImageSource,
  rect: SheetRect,
  tint: Tint,
) => HTMLCanvasElement {
  const bySheet = new WeakMap<
    CanvasImageSource,
    Map<string, HTMLCanvasElement>
  >()

  return function getTintedTile(image, rect, tint) {
    let tiles = bySheet.get(image)

    if (!tiles) {
      tiles = new Map()
      bySheet.set(image, tiles)
    }

    const key = `${rect.x},${rect.y},${rect.width},${rect.height},${getTintKey(tint)}`
    const cached = tiles.get(key)

    if (cached) {
      return cached
    }

    const tile = tintSheetTile(image, rect, tint)
    tiles.set(key, tile)

    return tile
  }
}
