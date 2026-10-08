import { isSolved } from '../core/rules'
import type { LevelState } from '../core/types'
import { createRenderer } from '../render/canvas'
import { createHistory, type Command, type History } from './history'
import { loadLevelCatalog, type PlayableLevel } from './levels'

const BINDINGS: Record<string, Command> = {
  ArrowUp: { type: 'move', playerMoveDirection: 'up' },
  ArrowDown: { type: 'move', playerMoveDirection: 'down' },
  ArrowLeft: { type: 'move', playerMoveDirection: 'left' },
  ArrowRight: { type: 'move', playerMoveDirection: 'right' },
  w: { type: 'move', playerMoveDirection: 'up' },
  s: { type: 'move', playerMoveDirection: 'down' },
  a: { type: 'move', playerMoveDirection: 'left' },
  d: { type: 'move', playerMoveDirection: 'right' },
  z: { type: 'undo' },
  u: { type: 'undo' },
  r: { type: 'reset' },
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)

  if (!element) {
    throw new Error(`Expected ${selector} in the document`)
  }

  return element
}

const levelsSection = requireElement<HTMLElement>('#levels')
const levelList = requireElement<HTMLElement>('#level-list')
const levelsReport = requireElement<HTMLElement>('#levels-report')
const gameSection = requireElement<HTMLElement>('#game')
const canvas = requireElement<HTMLCanvasElement>('#board')
const statusLine = requireElement<HTMLElement>('#status')
const backButton = requireElement<HTMLButtonElement>('#back')

type ActiveGame = {
  readonly level: PlayableLevel
  readonly history: History
  readonly render: (levelState: LevelState) => void
}

/**
 * Null while the picker is up, which is also what the keybindings test: the
 * arrow keys belong to a board, and there is no board until a level is picked.
 */
let activeGame: ActiveGame | null = null

/**
 * One per card. A miniature is the game's own renderer drawn small, so the
 * canvas has to be measured while its card is on screen — hence redrawing them
 * on a resize and on coming back from a level, rather than once.
 */
const repaintMiniatures: (() => void)[] = []

function updateGame(): void {
  if (!activeGame) {
    return
  }

  const levelState = activeGame.history.current()
  activeGame.render(levelState)

  const moves = activeGame.history.moveCount()
  statusLine.textContent = isSolved(levelState)
    ? `${activeGame.level.name} — solved in ${moves} moves. R to play again, Esc for levels.`
    : `${activeGame.level.name}   ·   moves: ${moves}   ·   arrows/WASD, Z undo, R reset, Esc levels`
}

function showLevels(): void {
  activeGame = null
  gameSection.hidden = true
  levelsSection.hidden = false

  for (const repaint of repaintMiniatures) {
    repaint()
  }
}

/**
 * A level's skin belongs to that level, so the renderer is built per level
 * rather than once for the canvas — the game draws whatever tiles came in the
 * bundle, and flat colour for a bundle that has none.
 */
function startLevel(level: PlayableLevel): void {
  activeGame = {
    level,
    history: createHistory(level.levelState),
    render: createRenderer(canvas, level.skin, level.customTiles),
  }

  levelsSection.hidden = true
  gameSection.hidden = false
  updateGame()
}

function createLevelCard(level: PlayableLevel): HTMLButtonElement {
  const card = document.createElement('button')
  card.type = 'button'
  card.className = 'level'

  const miniature = document.createElement('canvas')
  const paint = createRenderer(miniature, level.skin, level.customTiles)
  repaintMiniatures.push(() => paint(level.levelState))

  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = level.name

  const tiles = document.createElement('span')
  tiles.className = 'tiles'
  tiles.textContent = level.skin
    ? `${level.skin.sheet.tileWidth}px tiles`
    : 'no tiles'

  card.append(miniature, name, tiles)
  card.addEventListener('click', () => startLevel(level))

  return card
}

window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return
  }

  if (event.key === 'Escape') {
    if (activeGame) {
      event.preventDefault()
      showLevels()
    }

    return
  }

  if (!activeGame) {
    return
  }

  const command = BINDINGS[event.key] ?? BINDINGS[event.key.toLowerCase()]

  if (!command) {
    return
  }

  event.preventDefault()

  if (activeGame.history.run(command)) {
    updateGame()
  }
})

backButton.addEventListener('click', showLevels)

window.addEventListener('resize', () => {
  if (activeGame) {
    updateGame()

    return
  }

  for (const repaint of repaintMiniatures) {
    repaint()
  }
})

async function start(): Promise<void> {
  const catalog = await loadLevelCatalog()

  levelList.replaceChildren(...catalog.levels.map(createLevelCard))
  levelsReport.textContent = catalog.problems.join('\n')
  showLevels()
}

void start()
