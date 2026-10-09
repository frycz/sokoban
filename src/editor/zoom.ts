/**
 * Multiples of the fit-to-view scale, so `1` always shows the whole thing
 * whatever its size and the steps above it are what pan around.
 */
const ZOOM_STEPS: readonly number[] = [1, 2, 3, 4, 6, 8, 12, 16]

export type ZoomControl = {
  readonly current: () => number
  /** Buttons and readout for the zoom as it is now; called from `update`. */
  readonly syncControls: () => void
  readonly reset: () => void
}

/**
 * The zoom shared by the three views that have one: the tile sheet, and the
 * board in each mode. It owns the step, the two buttons, the ctrl + wheel
 * gesture and the scroll anchoring; sizing the canvas to the zoomed content is
 * the painter's, which is what makes panning the browser's job rather than a
 * second transform the pointer handler would have to invert.
 *
 * `repaint` is the mode's redraw, because the zoom is view state like the
 * selected brush: nothing is stored, and the canvas resize happens there.
 */
export function createZoomControl(parts: {
  readonly view: HTMLElement
  /** The canvas the painter sizes — its client size is the zoomed content. */
  readonly content: HTMLElement
  readonly outButton: HTMLButtonElement
  readonly inButton: HTMLButtonElement
  readonly readout: HTMLElement
  /** False greys the buttons out, for a palette with no sheet loaded. */
  readonly isEnabled?: () => boolean
  readonly repaint: () => void
}): ZoomControl {
  let zoom = 1

  const isEnabled = (): boolean => parts.isEnabled?.() ?? true

  function syncControls(): void {
    parts.readout.textContent = zoom === 1 ? 'fit' : `${zoom}×`
    parts.outButton.disabled = !isEnabled() || zoom === ZOOM_STEPS[0]
    parts.inButton.disabled =
      !isEnabled() || zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]
  }

  /**
   * Steps the zoom, keeping whatever was in the middle of the view in the
   * middle of it — zooming in on a corner of a big level otherwise lands
   * somewhere else entirely. The browser clamps the scroll offsets for us.
   */
  function step(steps: number): void {
    const next = ZOOM_STEPS[ZOOM_STEPS.indexOf(zoom) + steps]

    if (next === undefined || !isEnabled()) {
      return
    }

    const anchorX =
      (parts.view.scrollLeft + parts.view.clientWidth / 2) /
      Math.max(parts.content.clientWidth, 1)
    const anchorY =
      (parts.view.scrollTop + parts.view.clientHeight / 2) /
      Math.max(parts.content.clientHeight, 1)

    zoom = next
    parts.repaint()

    parts.view.scrollLeft =
      anchorX * parts.content.clientWidth - parts.view.clientWidth / 2
    parts.view.scrollTop =
      anchorY * parts.content.clientHeight - parts.view.clientHeight / 2
  }

  parts.outButton.addEventListener('click', () => {
    step(-1)
  })

  parts.inButton.addEventListener('click', () => {
    step(1)
  })

  // A plain wheel scrolls the zoomed content, as it does anywhere else; the
  // modifier is what the browser's own page zoom uses, so it is the gesture
  // already in people's hands.
  parts.view.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) {
        return
      }

      event.preventDefault()

      if (event.deltaY !== 0) {
        step(event.deltaY < 0 ? 1 : -1)
      }
    },
    { passive: false },
  )

  return {
    current: () => zoom,
    syncControls,
    reset: () => {
      zoom = 1
    },
  }
}
