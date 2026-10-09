import { MAX_BACKING_PIXELS } from './backing-store'

/**
 * Multiples of the fit-to-view scale, so `1` always shows the whole thing
 * whatever its size and the steps above it are what pan around.
 */
const ZOOM_STEPS: readonly number[] = [1, 2, 3, 4, 6, 8, 12]

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

  /**
   * The step one click away, or undefined when there is none to take.
   *
   * Zooming in runs out of browser before it runs out of list. The content is
   * at most the view's size times the zoom in each direction, so its area grows
   * as the square of it: 12× of a 1600px-wide view is a canvas no browser will
   * allocate, while 12× of a 600px one is unremarkable. That is why the ceiling
   * is a budget measured against the view rather than a shorter list of steps —
   * the readout stops where the browser stops, on the machine it is running on.
   */
  function nextZoom(direction: number): number | undefined {
    const next = ZOOM_STEPS[ZOOM_STEPS.indexOf(zoom) + direction]

    if (next === undefined || direction < 0) {
      return next
    }

    const area =
      parts.view.clientWidth * next * (parts.view.clientHeight * next)

    return area > MAX_BACKING_PIXELS ? undefined : next
  }

  function syncControls(): void {
    parts.readout.textContent = zoom === 1 ? 'fit' : `${zoom}×`
    parts.outButton.disabled = !isEnabled() || nextZoom(-1) === undefined
    parts.inButton.disabled = !isEnabled() || nextZoom(1) === undefined
  }

  /**
   * Steps the zoom, keeping whatever was in the middle of the view in the
   * middle of it — zooming in on a corner of a big level otherwise lands
   * somewhere else entirely. The browser clamps the scroll offsets for us.
   */
  function step(direction: number): void {
    const next = nextZoom(direction)

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
