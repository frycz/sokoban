import { createRenderer } from '../render/canvas'
import type { PlayableLevel } from './levels'
import type { Menu } from './menu'

/**
 * The game's Select Level screen: every level as a card with a miniature of
 * its board, laid out in a grid the arrows (or WASD) move around. It looks
 * like the dev build's level list but is its own, so the two can grow apart.
 */

export type LevelCard = {
  readonly level: PlayableLevel
  /** The line under the name: a result, "next", or "locked". */
  readonly status: string
  readonly locked: boolean
}

export type LevelGrid = Menu & {
  /**
   * Draws every miniature against its card's current size — so only once the
   * grid is on screen, and again whenever the window resizes.
   */
  readonly repaint: () => void
  /** Brings the selected card into view. */
  readonly reveal: () => void
}

const LEFT_KEYS = new Set(['ArrowLeft', 'a', 'A'])
const RIGHT_KEYS = new Set(['ArrowRight', 'd', 'D'])
const UP_KEYS = new Set(['ArrowUp', 'w', 'W'])
const DOWN_KEYS = new Set(['ArrowDown', 's', 'S'])
const ACTIVATE_KEYS = new Set(['Enter', ' '])

/**
 * One highlight serves keyboard and mouse alike, as in the menus. A locked
 * card is shown but can be neither selected nor played.
 */
export function createLevelGrid(
  cards: readonly LevelCard[],
  {
    onPick,
    onEscape,
    initial,
  }: {
    readonly onPick: (index: number) => void
    readonly onEscape: () => void
    readonly initial: number
  },
): LevelGrid {
  const element = document.createElement('div')
  element.className = 'level-grid'
  element.setAttribute('role', 'menu')

  let selected = initial

  const built = cards.map((card, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'level-card'
    button.setAttribute('role', 'menuitem')
    // Out of the tab order, as in the menus: Enter is the grid's own.
    button.tabIndex = -1
    button.disabled = card.locked

    const miniature = document.createElement('canvas')
    const paint = createRenderer(
      miniature,
      card.level.skin,
      card.level.layers,
      card.level.groundColor,
    )

    const name = document.createElement('span')
    name.className = 'name'
    const number = document.createElement('span')
    number.className = 'number'
    number.textContent = `${index + 1}. `
    name.append(number, card.level.name)

    const status = document.createElement('span')
    status.className = 'status'
    status.textContent = card.status

    button.append(miniature, name, status)

    // Real pointer movement only: a grid scrolled by the arrows slides cards
    // under a still pointer, and that must not steal the highlight.
    button.addEventListener('mousemove', (event) => {
      if ((event.movementX !== 0 || event.movementY !== 0) && !card.locked) {
        select(index)
      }
    })
    button.addEventListener('click', () => onPick(index))

    return { button, repaint: () => paint(card.level.levelState) }
  })

  element.append(...built.map((each) => each.button))

  function select(index: number): void {
    selected = index

    built.forEach(({ button }, buttonIndex) => {
      button.classList.toggle('selected', buttonIndex === selected)
    })
  }

  select(initial)

  /** Cards in the first row — the grid's width, read from its layout. */
  function countColumns(): number {
    const top = built[0]?.button.offsetTop
    const index = built.findIndex(({ button }) => button.offsetTop !== top)

    return index === -1 ? built.length : index
  }

  /** Moves when the target is a card that can be played; stays otherwise. */
  function moveBy(offset: number): void {
    const target = selected + offset

    if (target < 0 || target >= cards.length || cards[target].locked) {
      return
    }

    select(target)
    reveal()
  }

  function reveal(): void {
    built[selected]?.button.scrollIntoView({ block: 'nearest' })
  }

  function handleKey(event: KeyboardEvent): boolean {
    if (LEFT_KEYS.has(event.key)) {
      moveBy(-1)
    } else if (RIGHT_KEYS.has(event.key)) {
      moveBy(1)
    } else if (UP_KEYS.has(event.key)) {
      moveBy(-countColumns())
    } else if (DOWN_KEYS.has(event.key)) {
      moveBy(countColumns())
    } else if (ACTIVATE_KEYS.has(event.key)) {
      if (!cards[selected].locked) {
        onPick(selected)
      }
    } else if (event.key === 'Escape') {
      onEscape()
    } else {
      return false
    }

    return true
  }

  return {
    element,
    handleKey,
    repaint: () => {
      for (const each of built) {
        each.repaint()
      }
    },
    reveal,
  }
}
