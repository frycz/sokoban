import { isSolved } from '../core/rules'
import type { LevelState } from '../core/types'
import { createRenderer } from '../render/canvas'
import {
  createHistory,
  restoreHistory,
  type Command,
  type History,
} from './history'
import { loadLevelCatalog, type PlayableLevel } from './levels'
import type { DevTools } from './dev-tools'
import { createMenu, type Menu, type MenuItem } from './menu'
import {
  formatDuration,
  readStoredSave,
  resolveResume,
  writeStoredSave,
  type LevelResult,
  type Save,
} from './save'

/**
 * `npm run dev` is the game plus the dev tools; `npm run game` and the built
 * site are the game alone. The mode is replaced at build time, so in a build
 * this is the constant `false` and the dev tools' import is dropped with it.
 */
const IS_DEV_BUILD = import.meta.env.MODE === 'devtools'

/**
 * Separate keys as well as separate ports, so jumping between levels in the
 * dev build can never touch a player's save.
 */
const SAVE_KEY = IS_DEV_BUILD ? 'sokoban:save:dev' : 'sokoban:save'

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

/** How often the clock on screen ticks, and the save catches up with it. */
const TICK_MS = 1000

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)

  if (!element) {
    throw new Error(`Expected ${selector} in the document`)
  }

  return element
}

const titleSection = requireElement<HTMLElement>('#title')
const titlePrompt = requireElement<HTMLElement>('#title-prompt')
const titleMenuSlot = requireElement<HTMLElement>('#title-menu')
const gameSection = requireElement<HTMLElement>('#game')
const hudLevel = requireElement<HTMLElement>('#hud-level')
const hudStats = requireElement<HTMLElement>('#hud-stats')
const canvas = requireElement<HTMLCanvasElement>('#board')
const gameFooter = requireElement<HTMLElement>('#game-footer')
const overlay = requireElement<HTMLElement>('#overlay')
const overlayEyebrow = requireElement<HTMLElement>('#overlay-eyebrow')
const overlayTitle = requireElement<HTMLElement>('#overlay-title')
const overlayBody = requireElement<HTMLElement>('#overlay-body')
const overlayMenuSlot = requireElement<HTMLElement>('#overlay-menu')
const finishedSection = requireElement<HTMLElement>('#finished')
const finishedSummary = requireElement<HTMLElement>('#finished-summary')
const finishedResults = requireElement<HTMLTableElement>('#finished-results')
const finishedMenuSlot = requireElement<HTMLElement>('#finished-menu')

/** Every screen; showing one hides the rest. The dev build adds its own. */
const screens: HTMLElement[] = [titleSection, gameSection, finishedSection]

type Play = {
  readonly index: number
  readonly level: PlayableLevel
  readonly history: History
  readonly render: (levelState: LevelState) => void
  /** Time banked on this level, not counting the stretch now running. */
  timeMs: number
  /** When the running stretch began, or null while the clock is stopped. */
  runningSince: number | null
  solved: boolean
}

/** The campaign, in `levels/order.json` order. */
let levels: readonly PlayableLevel[] = []
let save: Save = { current: null, completed: [] }

/** The level on the board, or null when there is none. */
let play: Play | null = null

/**
 * The menu the arrow keys drive, or null while they drive the board. Exactly
 * one thing on screen takes the keys at a time.
 */
let activeMenu: Menu | null = null

function showScreen(screen: HTMLElement): void {
  for (const each of screens) {
    each.hidden = each !== screen
  }

  syncClock()
}

function setMenu(slot: HTMLElement, menu: Menu): void {
  slot.replaceChildren(menu.element)
  activeMenu = menu
}

// --- The clock --------------------------------------------------------------

function getPlayTime(current: Play): number {
  return (
    current.timeMs +
    (current.runningSince === null
      ? 0
      : performance.now() - current.runningSince)
  )
}

/**
 * The clock runs only while someone could be playing: the board on screen,
 * nothing over it, the tab visible and the level not yet solved. Called
 * whenever any of those might have changed.
 */
function syncClock(): void {
  if (!play) {
    return
  }

  const shouldRun =
    !gameSection.hidden &&
    overlay.hidden &&
    document.visibilityState === 'visible' &&
    !play.solved

  if (shouldRun && play.runningSince === null) {
    play.runningSince = performance.now()
  } else if (!shouldRun && play.runningSince !== null) {
    play.timeMs = getPlayTime(play)
    play.runningSince = null
  }
}

// --- Saving -----------------------------------------------------------------

function persist(): void {
  writeStoredSave(SAVE_KEY, save)
}

/** The level in progress into the save, moves and clock included. */
function persistProgress(): void {
  if (!play || play.solved) {
    return
  }

  save = {
    current: {
      slug: play.level.slug,
      lurd: play.history.lurd(),
      timeMs: Math.round(getPlayTime(play)),
    },
    completed: save.completed,
  }
  persist()
}

// --- The title screen -------------------------------------------------------

function showTitle(): void {
  persistProgress()
  play = null
  hideOverlay()

  const resume = resolveResume(
    save,
    levels.map((level) => level.slug),
  )
  const items: MenuItem[] = []

  if (resume) {
    items.push({
      label: 'Continue',
      action: () => startLevel(resume.index, resume.lurd, resume.timeMs),
    })
  }

  items.push({
    label: 'New Game',
    action: resume ? confirmNewGame : startNewGame,
  })
  items.push(...(devTools?.titleItems ?? []))

  titlePrompt.hidden = true
  setMenu(titleMenuSlot, createMenu(items))
  showScreen(titleSection)
}

function confirmNewGame(): void {
  titlePrompt.textContent = 'Start over? Your current progress will be lost.'
  titlePrompt.hidden = false
  setMenu(
    titleMenuSlot,
    createMenu(
      [
        { label: 'Cancel', action: showTitle },
        { label: 'Start new game', action: startNewGame },
      ],
      { onEscape: showTitle },
    ),
  )
}

function startNewGame(): void {
  startCampaignAt(0)
}

/** A fresh campaign from the given level — level 1, or any in the dev build. */
function startCampaignAt(index: number): void {
  save = { current: null, completed: [] }
  startLevel(index)
}

// --- The board --------------------------------------------------------------

/**
 * A level's skin belongs to that level, so the renderer is built per level
 * rather than once for the canvas — the game draws whatever tiles came in the
 * bundle, and flat colour for a bundle that has none.
 *
 * A saved path that no longer replays — the level was re-exported since —
 * starts the level over, clock included, rather than guessing.
 */
function startLevel(index: number, lurd = '', timeMs = 0): void {
  const level = levels[index]
  const restored = restoreHistory(level.levelState, lurd)

  play = {
    index,
    level,
    history: restored ?? createHistory(level.levelState),
    render: createRenderer(canvas, level.skin, level.layers, level.groundColor),
    timeMs: restored ? timeMs : 0,
    runningSince: null,
    solved: false,
  }

  hideOverlay()
  showScreen(gameSection)
  updateGame()
  persistProgress()
}

function updateGame(): void {
  if (!play) {
    return
  }

  play.render(play.history.current())
  updateHud()
}

function updateHud(): void {
  if (!play) {
    return
  }

  const count = document.createElement('span')
  count.className = 'count'
  count.textContent = `Level ${play.index + 1}/${levels.length}  `
  hudLevel.replaceChildren(count, play.level.name)

  hudStats.replaceChildren(
    ...statPair('moves', play.history.moveCount()),
    '  ·  ',
    ...statPair('pushes', play.history.pushCount()),
    '  ·  ',
    ...statPair('time', formatDuration(getPlayTime(play))),
  )
}

function statPair(label: string, value: number | string): (Node | string)[] {
  const strong = document.createElement('b')
  strong.textContent = String(value)

  return [`${label} `, strong]
}

function runCommand(command: Command): void {
  if (!play?.history.run(command)) {
    return
  }

  updateGame()

  if (isSolved(play.history.current())) {
    completeLevel()

    return
  }

  persistProgress()
}

/**
 * Solved — by the player, or by the dev build's Win level. The save moves on
 * to the next level at once, so a reload from the level-complete panel lands
 * on the next level rather than replaying the one just solved.
 */
function completeLevel(): void {
  if (!play || play.solved) {
    return
  }

  play.solved = true
  syncClock()

  const current = play
  const result: LevelResult = {
    slug: current.level.slug,
    name: current.level.name,
    moves: current.history.moveCount(),
    pushes: current.history.pushCount(),
    timeMs: Math.round(current.timeMs),
  }
  // A level solved again in the dev build replaces its earlier result.
  const completed = [
    ...save.completed.filter((each) => each.slug !== result.slug),
    result,
  ]
  const nextIndex = current.index + 1
  const isLast = nextIndex >= levels.length

  save = {
    current: isLast
      ? null
      : { slug: levels[nextIndex].slug, lurd: '', timeMs: 0 },
    completed,
  }
  persist()
  updateHud()

  showOverlay({
    eyebrow: `Level ${current.index + 1} of ${levels.length}`,
    title: isLast ? 'Final level solved' : 'Level complete',
    body: [createStats(result)],
    menu: createMenu(
      isLast
        ? [{ label: 'See results', action: showFinished }]
        : [
            { label: 'Next level', action: () => startLevel(nextIndex) },
            { label: 'Main menu', action: showTitle },
          ],
    ),
  })
}

function createStats(result: LevelResult): HTMLElement {
  const list = document.createElement('dl')
  list.className = 'stats'

  for (const [label, value] of [
    ['moves', String(result.moves)],
    ['pushes', String(result.pushes)],
    ['time', formatDuration(result.timeMs)],
  ]) {
    const pair = document.createElement('div')
    const term = document.createElement('dt')
    const definition = document.createElement('dd')
    term.textContent = label
    definition.textContent = value
    pair.append(term, definition)
    list.append(pair)
  }

  return list
}

// --- The overlay: pause and level complete ----------------------------------

function showOverlay({
  eyebrow,
  title,
  body,
  menu,
}: {
  readonly eyebrow: string
  readonly title: string
  readonly body: readonly Node[]
  readonly menu: Menu
}): void {
  overlayEyebrow.textContent = eyebrow
  overlayEyebrow.hidden = eyebrow === ''
  overlayTitle.textContent = title
  overlayBody.replaceChildren(...body)
  setMenu(overlayMenuSlot, menu)
  overlay.hidden = false
  syncClock()
}

function hideOverlay(): void {
  overlay.hidden = true
  overlayMenuSlot.replaceChildren()
  activeMenu = null
  syncClock()
}

function pause(): void {
  if (!play) {
    return
  }

  persistProgress()
  showOverlay({
    eyebrow: '',
    title: 'Paused',
    body: [],
    menu: createMenu(
      [
        { label: 'Resume', action: hideOverlay },
        {
          label: 'Restart level',
          action: () => {
            hideOverlay()
            runCommand({ type: 'reset' })
          },
        },
        { label: 'Main menu', action: showTitle },
      ],
      { onEscape: hideOverlay },
    ),
  })
}

// --- The finale -------------------------------------------------------------

function showFinished(): void {
  play = null
  hideOverlay()

  const results = save.completed
  const total = {
    moves: sum(results.map((result) => result.moves)),
    pushes: sum(results.map((result) => result.pushes)),
    timeMs: sum(results.map((result) => result.timeMs)),
  }

  finishedSummary.textContent = `${results.length} ${results.length === 1 ? 'level' : 'levels'} solved in ${formatDuration(total.timeMs)}.`

  finishedResults.replaceChildren()

  const head = finishedResults.createTHead().insertRow()

  for (const label of ['#', 'level', 'moves', 'pushes', 'time']) {
    const cell = document.createElement('th')
    cell.textContent = label
    head.append(cell)
  }

  const body = finishedResults.createTBody()
  results.forEach((result, index) => {
    addRow(body, [
      String(index + 1),
      result.name,
      String(result.moves),
      String(result.pushes),
      formatDuration(result.timeMs),
    ])
  })
  addRow(finishedResults.createTFoot(), [
    '',
    'total',
    String(total.moves),
    String(total.pushes),
    formatDuration(total.timeMs),
  ])

  setMenu(
    finishedMenuSlot,
    createMenu([{ label: 'Back to title', action: showTitle }]),
  )
  showScreen(finishedSection)
}

function addRow(section: HTMLTableSectionElement, cells: string[]): void {
  const row = section.insertRow()

  for (const text of cells) {
    row.insertCell().textContent = text
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

// --- Input and lifecycle ----------------------------------------------------

window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return
  }

  if (activeMenu) {
    if (activeMenu.handleKey(event)) {
      event.preventDefault()
    }

    return
  }

  if (!play || gameSection.hidden) {
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    pause()

    return
  }

  if (devTools?.handleGameKey(event)) {
    event.preventDefault()

    return
  }

  const command = BINDINGS[event.key] ?? BINDINGS[event.key.toLowerCase()]

  if (!command) {
    return
  }

  event.preventDefault()
  runCommand(command)
})

window.addEventListener('resize', updateGame)

document.addEventListener('visibilitychange', () => {
  syncClock()
  persistProgress()
})

window.addEventListener('pagehide', persistProgress)

window.setInterval(() => {
  if (play && play.runningSince !== null) {
    updateHud()
    persistProgress()
  }
}, TICK_MS)

// --- The dev build ----------------------------------------------------------

let devTools: DevTools | null = null

async function start(): Promise<void> {
  const catalog = await loadLevelCatalog()
  levels = catalog.levels
  save = readStoredSave(SAVE_KEY) ?? save

  if (IS_DEV_BUILD) {
    const { createDevTools } = await import('./dev-tools')

    devTools = createDevTools({
      levels: () => levels,
      setLevels: (ordered) => {
        levels = ordered
      },
      defaultSkin: catalog.defaultSkin,
      problems: catalog.problems,
      addScreen: (screen) => {
        screens.push(screen)
      },
      showScreen: (screen) => {
        persistProgress()
        play = null
        activeMenu = null
        showScreen(screen)
      },
      showTitle,
      startCampaignAt,
      winLevel: completeLevel,
      gameFooter,
    })
  } else {
    for (const problem of catalog.problems) {
      console.warn(problem)
    }
  }

  showTitle()
}

void start()
