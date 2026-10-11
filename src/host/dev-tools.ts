import { createRenderer } from '../render/canvas'
import { applyDefaultSkin } from './default-skin'
import type { PlayableLevel } from './levels'
import type { MenuItem } from './menu'

/**
 * The dev build's extras: every level at once, reordering the campaign, choosing
 * the skin levels without one borrow, playing it from any level, and solving a
 * level on demand. Loaded only by
 * `npm run dev` — `index.ts` imports this behind a constant the build folds to
 * false, so none of it, its styles included, reaches the shipped game.
 */

/** What the dev tools may do to the game. */
export type GameControls = {
  readonly levels: () => readonly PlayableLevel[]
  readonly setLevels: (ordered: readonly PlayableLevel[]) => void
  /** The level `default-skin.json` named when the game loaded, or null. */
  readonly defaultSkin: string | null
  readonly problems: readonly string[]
  readonly addScreen: (screen: HTMLElement) => void
  readonly showScreen: (screen: HTMLElement) => void
  readonly showTitle: () => void
  readonly startCampaignAt: (index: number) => void
  readonly winLevel: () => void
  /** Where the dev build puts its buttons under the board. */
  readonly gameFooter: HTMLElement
}

export type DevTools = {
  readonly titleItems: readonly MenuItem[]
  /** A key on the board meant for the dev tools, returning whether it was. */
  readonly handleGameKey: (event: KeyboardEvent) => boolean
}

const ORDER_ENDPOINT = '/api/level-order'
const DEFAULT_SKIN_ENDPOINT = '/api/default-skin'
const WIN_KEY = 'n'

const STYLES = `
  .dev-badge {
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #11131a;
    background: var(--gold);
    border-radius: 3px;
    padding: 1px 6px;
    vertical-align: middle;
  }
  #dev-levels {
    justify-content: flex-start;
    align-items: stretch;
    max-width: 1000px;
    width: 100%;
    margin: 0 auto;
  }
  #dev-levels header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  #dev-levels h1 {
    margin: 0;
    font-size: 16px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--bright);
  }
  #dev-levels .controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  #dev-levels label {
    color: var(--muted);
  }
  #dev-default-skin {
    font: inherit;
    color: var(--text);
    background: #1d2230;
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 3px 6px;
  }
  #dev-levels .hint {
    margin: 0;
    color: var(--muted);
  }
  #dev-level-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    align-content: start;
    gap: 12px;
  }
  .dev-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 8px;
    cursor: grab;
  }
  .dev-card:hover {
    border-color: #4b5570;
  }
  .dev-card.dragging {
    opacity: 0.4;
  }
  .dev-card.drop-target {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  /* The miniature is the game's own renderer at card size, so the canvas gets
     a fixed box to measure itself against rather than a fluid one. */
  .dev-card canvas {
    display: block;
    width: 100%;
    aspect-ratio: 4 / 3;
    background: #0c0e14;
    border-radius: 4px;
  }
  .dev-card .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--bright);
  }
  .dev-card .number {
    color: var(--gold);
  }
  .dev-card .meta {
    color: var(--muted);
    font-size: 12px;
  }
  .dev-card .actions {
    display: flex;
    gap: 6px;
  }
  .dev-card .actions .play {
    flex: 1 1 auto;
  }
  .dev-button {
    font: inherit;
    color: var(--muted);
    background: #1d2230;
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 3px 10px;
    cursor: pointer;
  }
  .dev-button:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--accent);
  }
  .dev-button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  #dev-levels-report {
    margin: 0;
    min-height: 1.5em;
    color: var(--gold);
    white-space: pre-line;
  }
`

type Card = {
  readonly element: HTMLElement
  readonly number: HTMLElement
  readonly up: HTMLButtonElement
  readonly down: HTMLButtonElement
  readonly repaint: () => void
}

export function createDevTools(game: GameControls): DevTools {
  const style = document.createElement('style')
  style.textContent = STYLES
  document.head.append(style)

  const screen = createLevelsScreen()
  const list = screen.querySelector<HTMLElement>('#dev-level-list')!
  const report = screen.querySelector<HTMLElement>('#dev-levels-report')!
  const skinPicker =
    screen.querySelector<HTMLSelectElement>('#dev-default-skin')!
  document.body.append(screen)
  game.addScreen(screen)

  const problems = game.problems.join('\n')
  const cards = new Map<string, Card>()
  let draggedSlug: string | null = null
  let defaultSkin = game.defaultSkin

  function cardFor(level: PlayableLevel): Card {
    const existing = cards.get(level.slug)

    if (existing) {
      return existing
    }

    const card = createCard(level)
    cards.set(level.slug, card)

    return card
  }

  function createCard(level: PlayableLevel): Card {
    const element = document.createElement('div')
    element.className = 'dev-card'
    element.draggable = true

    const miniature = document.createElement('canvas')
    const paint = createRenderer(
      miniature,
      level.skin,
      level.layers,
      level.groundColor,
    )

    const title = document.createElement('div')
    title.className = 'name'
    const number = document.createElement('span')
    number.className = 'number'
    title.append(number, level.name)

    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.textContent = `${level.slug} · ${
      level.skin ? `${level.skin.sheet.tileWidth}px tiles` : 'no tiles'
    }${level.skin && !level.ownSkin ? ' (default skin)' : ''}`

    const actions = document.createElement('div')
    actions.className = 'actions'
    const play = createButton('Play from here', () =>
      game.startCampaignAt(indexOf(level.slug)),
    )
    play.classList.add('play')
    const up = createButton('↑', () => move(level.slug, -1))
    up.title = 'Earlier'
    const down = createButton('↓', () => move(level.slug, 1))
    down.title = 'Later'
    actions.append(play, up, down)

    element.append(miniature, title, meta, actions)

    element.addEventListener('dragstart', (event) => {
      draggedSlug = level.slug
      element.classList.add('dragging')
      event.dataTransfer?.setData('text/plain', level.slug)
    })
    element.addEventListener('dragend', () => {
      draggedSlug = null
      element.classList.remove('dragging')
      clearDropTargets()
    })
    element.addEventListener('dragover', (event) => {
      if (draggedSlug === null || draggedSlug === level.slug) {
        return
      }

      event.preventDefault()
      clearDropTargets()
      element.classList.add('drop-target')
    })
    element.addEventListener('dragleave', () => {
      element.classList.remove('drop-target')
    })
    element.addEventListener('drop', (event) => {
      event.preventDefault()
      clearDropTargets()

      if (draggedSlug !== null) {
        moveTo(draggedSlug, indexOf(level.slug))
      }
    })

    return {
      element,
      number,
      up,
      down,
      repaint: () => paint(level.levelState),
    }
  }

  function clearDropTargets(): void {
    for (const card of cards.values()) {
      card.element.classList.remove('drop-target')
    }
  }

  function indexOf(slug: string): number {
    return game.levels().findIndex((level) => level.slug === slug)
  }

  function move(slug: string, offset: number): void {
    moveTo(slug, indexOf(slug) + offset)
  }

  function moveTo(slug: string, target: number): void {
    const levels = [...game.levels()]
    const from = indexOf(slug)

    if (
      from === -1 ||
      target < 0 ||
      target >= levels.length ||
      from === target
    ) {
      return
    }

    const [level] = levels.splice(from, 1)
    levels.splice(target, 0, level)
    game.setLevels(levels)
    renderList()
    void saveOrder(levels)
  }

  /** Re-appends the cached cards in campaign order; nothing is rebuilt. */
  function renderList(): void {
    const levels = game.levels()

    list.replaceChildren(
      ...levels.map((level, index) => {
        const card = cardFor(level)
        card.number.textContent = `${index + 1}. `
        card.up.disabled = index === 0
        card.down.disabled = index === levels.length - 1

        return card.element
      }),
    )
  }

  function repaintAll(): void {
    for (const level of game.levels()) {
      cardFor(level).repaint()
    }
  }

  /**
   * Written on every change, so the file is always what the screen shows. The
   * built-in fallback is not in `levels/`, so there is nothing to order.
   */
  async function saveOrder(levels: readonly PlayableLevel[]): Promise<void> {
    const slugs = levels.map((level) => level.slug)

    try {
      const response = await fetch(ORDER_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(slugs),
      })
      const answer = (await response.json()) as {
        message?: string
        file?: string
      }

      setReport(
        response.ok
          ? `Saved to ${answer.file ?? 'levels/order.json'}.`
          : `Not saved: ${answer.message ?? response.statusText}`,
      )
    } catch (error) {
      setReport(
        `Not saved: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Every level that shipped a skin can lend it. Rebuilt on each visit, so the
   * list follows the campaign order.
   */
  function renderSkinPicker(): void {
    const none = new Option('None — flat colour', '')
    const lenders = game
      .levels()
      .filter((level) => level.ownSkin)
      .map((level) => new Option(`${level.name} (${level.slug})`, level.slug))

    skinPicker.replaceChildren(none, ...lenders)
    skinPicker.value = defaultSkin ?? ''
  }

  /**
   * Applied only once the file is written, so the screen never shows a choice
   * the next load would not make. The cards are rebuilt rather than reused,
   * because a card's renderer holds the skin it was made with.
   */
  async function saveDefaultSkin(from: string | null): Promise<void> {
    try {
      const response = await fetch(DEFAULT_SKIN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from }),
      })
      const answer = (await response.json()) as {
        message?: string
        file?: string
      }

      if (!response.ok) {
        skinPicker.value = defaultSkin ?? ''
        setReport(`Not saved: ${answer.message ?? response.statusText}`)

        return
      }

      defaultSkin = from
      game.setLevels(applyDefaultSkin(game.levels(), from).levels)
      cards.clear()
      renderList()
      repaintAll()
      setReport(`Saved to ${answer.file ?? 'levels/default-skin.json'}.`)
    } catch (error) {
      skinPicker.value = defaultSkin ?? ''
      setReport(
        `Not saved: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  function setReport(message: string): void {
    report.textContent = [message, problems].filter(Boolean).join('\n')
  }

  function showLevels(): void {
    renderSkinPicker()
    renderList()
    setReport('')
    game.showScreen(screen)
    repaintAll()
  }

  skinPicker.addEventListener('change', () => {
    void saveDefaultSkin(skinPicker.value || null)
    // The arrow keys must go back to the screen rather than cycle the choice.
    skinPicker.blur()
  })

  screen
    .querySelector('#dev-levels-back')!
    .addEventListener('click', game.showTitle)

  window.addEventListener('keydown', (event) => {
    if (!screen.hidden && event.key === 'Escape') {
      event.preventDefault()
      game.showTitle()
    }
  })

  window.addEventListener('resize', () => {
    if (!screen.hidden) {
      repaintAll()
    }
  })

  const winButton = createButton(`Win level (${WIN_KEY.toUpperCase()})`, () =>
    game.winLevel(),
  )
  const badge = document.createElement('span')
  badge.className = 'dev-badge'
  badge.textContent = 'dev'
  game.gameFooter.append(badge, winButton)

  return {
    titleItems: [{ label: 'Levels (dev)', action: showLevels }],
    handleGameKey: (event) => {
      if (event.key.toLowerCase() !== WIN_KEY) {
        return false
      }

      game.winLevel()

      return true
    },
  }
}

function createLevelsScreen(): HTMLElement {
  const screen = document.createElement('section')
  screen.id = 'dev-levels'
  screen.className = 'screen'
  screen.hidden = true
  screen.innerHTML = `
    <header>
      <h1>Levels <span class="dev-badge">dev</span></h1>
      <div class="controls">
        <label for="dev-default-skin">Default skin</label>
        <select id="dev-default-skin"></select>
        <button type="button" class="dev-button" id="dev-levels-back">Title (Esc)</button>
      </div>
    </header>
    <p class="hint">Drag a card, or use ↑ ↓, to reorder the campaign — saved to levels/order.json as you go. Default skin is what levels without a skin of their own are drawn with — saved to levels/default-skin.json. Play from here starts a fresh run at that level.</p>
    <div id="dev-level-list"></div>
    <p id="dev-levels-report"></p>
  `

  return screen
}

function createButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'dev-button'
  button.textContent = label
  // A click must not leave the button focused, or Enter and Space would press
  // it again while the arrow keys play the board.
  button.addEventListener('click', (event) => {
    event.stopPropagation()
    button.blur()
    action()
  })

  return button
}
