/**
 * Device pixels the editor will ask for in one canvas: half of the 2^28 Chrome
 * allocates before it refuses the canvas outright.
 *
 * The editor's canvases are sized to their zoomed content rather than to the
 * view, so their area grows as the *square* of the zoom. Half the limit is not
 * timidity: a buffer that size is already half a gigabyte to allocate and zero,
 * which is a tab that stops responding rather than one that paints slowly.
 *
 * This is the budget the zoom steps stop at — see `createZoomControl` — which
 * is what keeps the clamp below from ever having to drop the ratio under 1.
 */
export const MAX_BACKING_PIXELS = 2 ** 27

/**
 * Sizes `canvas` to hold `cssWidth` × `cssHeight` of content, clears it, and
 * leaves the context scaled so the painter can work in CSS pixels throughout.
 *
 * The backing store is reassigned only when the size actually changes, because
 * assigning `width` reallocates and zeroes it — hundreds of megabytes at a deep
 * zoom, which the hover highlight would otherwise pay for on every repaint.
 */
export function prepareBackingStore(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
): void {
  // Past the budget it is the ratio that gives way, not the layout: at a zoom
  // that deep a tile is hundreds of pixels across and everything the painters
  // draw lands on whole CSS pixels, so the second device pixel per side was
  // buying nothing anyway.
  const pixelRatio = Math.max(
    1,
    Math.min(
      window.devicePixelRatio || 1,
      Math.sqrt(MAX_BACKING_PIXELS / Math.max(cssWidth * cssHeight, 1)),
    ),
  )
  const width = Math.round(cssWidth * pixelRatio)
  const height = Math.round(cssHeight * pixelRatio)

  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }

  // A resize resets the context and a skipped one leaves whatever the last
  // paint set behind, so the transform and the clear happen either way.
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  context.clearRect(0, 0, cssWidth, cssHeight)
}
