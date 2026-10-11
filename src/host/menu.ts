export type MenuItem = {
  readonly label: string
  readonly action: () => void
}

export type Menu = {
  readonly element: HTMLElement
  /** Handles a key meant for the menu, returning whether it used it. */
  handleKey: (event: KeyboardEvent) => boolean
}

const PREVIOUS_KEYS = new Set(['ArrowUp', 'w', 'W'])
const NEXT_KEYS = new Set(['ArrowDown', 's', 'S'])
const ACTIVATE_KEYS = new Set(['Enter', ' '])

/**
 * A vertical list of choices, driven by the arrows (or W/S) and Enter, or by
 * the mouse. One highlight serves both: hovering moves it, so the item the
 * keyboard would pick is always the one that looks picked.
 *
 * The selection is the menu's own rather than the browser's focus, because a
 * click anywhere else on the page would take focus away and leave the arrows
 * driving nothing.
 */
export function createMenu(
  items: readonly MenuItem[],
  { onEscape }: { readonly onEscape?: () => void } = {},
): Menu {
  const element = document.createElement('div')
  element.className = 'menu'
  element.setAttribute('role', 'menu')

  let selected = 0

  const buttons = items.map((item, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'menu-item'
    button.setAttribute('role', 'menuitem')
    // Out of the tab order: the menu is keyboard-driven already, and a focused
    // button would answer Enter a second time.
    button.tabIndex = -1
    button.textContent = item.label
    button.addEventListener('mouseenter', () => select(index))
    button.addEventListener('click', () => item.action())

    return button
  })

  element.append(...buttons)

  function select(index: number): void {
    selected = (index + buttons.length) % buttons.length

    buttons.forEach((button, buttonIndex) => {
      button.classList.toggle('selected', buttonIndex === selected)
    })
  }

  select(0)

  function handleKey(event: KeyboardEvent): boolean {
    if (PREVIOUS_KEYS.has(event.key)) {
      select(selected - 1)

      return true
    }

    if (NEXT_KEYS.has(event.key)) {
      select(selected + 1)

      return true
    }

    if (ACTIVATE_KEYS.has(event.key)) {
      items[selected].action()

      return true
    }

    if (event.key === 'Escape' && onEscape) {
      onEscape()

      return true
    }

    return false
  }

  return { element, handleKey }
}
