/**
 * The swatch list both colour panels draw — colours mode's editable one and the
 * skin panel's read-only strip. One renderer rather than two, because what a
 * swatch *is* does not differ between them: a chip, its hex spelled out so it
 * can be read and copied, and buttons. What differs is which buttons, which is
 * the argument.
 *
 * The panel that owns the container reads the click back off the event, so this
 * module knows nothing about what an action means — only that it was asked for.
 */
export type SwatchAction = {
  /** Read back off the click; the panel decides what it means. */
  readonly action: string
  readonly glyph: string
  readonly title: string
}

/** The chip-and-hex button every row has, whatever else it is offered. */
export const SELECT_ACTION = 'select'

export type SwatchClick = {
  readonly action: string
  readonly index: number
}

export function renderSwatches(
  container: HTMLElement,
  colors: readonly string[],
  actions: readonly SwatchAction[],
  options: {
    readonly selectedIndex: number
    readonly emptyMessage: string
  },
): void {
  container.replaceChildren()

  if (colors.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'swatch-empty'
    empty.textContent = options.emptyMessage
    container.append(empty)

    return
  }

  for (const [index, color] of colors.entries()) {
    const row = document.createElement('div')
    row.className = 'swatch-row'

    const select = document.createElement('button')
    select.type = 'button'
    select.className = 'swatch'
    select.dataset.swatchAction = SELECT_ACTION
    select.dataset.swatchIndex = String(index)
    select.setAttribute('aria-pressed', String(index === options.selectedIndex))

    const chip = document.createElement('span')
    chip.className = 'chip'
    // The one colour on screen that has to be the colour itself, so it is set
    // inline — a stylesheet has no way to know it.
    chip.style.background = color

    const hex = document.createElement('span')
    hex.className = 'hex'
    hex.textContent = color

    select.append(chip, hex)
    row.append(select)

    for (const action of actions) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'swatch-action'
      button.dataset.swatchAction = action.action
      button.dataset.swatchIndex = String(index)
      button.title = `${action.title} — ${color}`
      button.textContent = action.glyph
      row.append(button)
    }

    container.append(row)
  }
}

/** The action and the row a click landed on, or null for a click on neither. */
export function readSwatchClick(target: Element): SwatchClick | null {
  const button = target.closest<HTMLElement>('button[data-swatch-action]')
  const index = Number(button?.dataset.swatchIndex)

  if (!button || !Number.isInteger(index)) {
    return null
  }

  return { action: button.dataset.swatchAction ?? '', index }
}
