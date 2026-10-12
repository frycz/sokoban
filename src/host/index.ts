import { isSolved } from '../core/rules'
import type { LevelState } from '../core/types'
import { createRenderer, type Motion } from '../render/canvas'
import { getSkinTileRect } from '../render/skin'
import type { TileRole } from '../render/tile-roles'
import {
  createHistory,
  restoreHistory,
  type Command,
  type History,
} from './history'
import { loadLevelCatalog, type PlayableLevel } from './levels'
import { createLevelGrid, type LevelCard, type LevelGrid } from './level-select'
import type { DevTools } from './dev-tools'
import { createMenu, type Menu, type MenuItem } from './menu'
import {
  countUnlocked,
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

/**
 * How long the player and a pushed box take to slide to their next cell. A key
 * pressed mid-slide snaps the pieces to where they were going and starts the
 * next one, so input never waits on the animation.
 */
const MOVE_ANIMATION_MS = 75

/**
 * How long a solved board stays on screen before the level-complete panel, so
 * the last box is seen landing. The board takes no moves in the meantime.
 */
const COMPLETE_DELAY_MS = 100

/** The panel's fade in, slower than other changes of view so it arrives gently. */
const COMPLETE_FADE_IN_MS = 300

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

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
const titleMotif = requireElement<HTMLElement>('#title .motif')
const levelsSection = requireElement<HTMLElement>('#levels')
const levelsGridSlot = requireElement<HTMLElement>('#levels-grid')
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
const screens: HTMLElement[] = [
  titleSection,
  levelsSection,
  gameSection,
  finishedSection,
]

type Play = {
  readonly index: number
  readonly level: PlayableLevel
  readonly history: History
  readonly render: (levelState: LevelState, motion?: Motion) => void
  /** Time banked on this level, not counting the stretch now running. */
  timeMs: number
  /** When the running stretch began, or null while the clock is stopped. */
  runningSince: number | null
  solved: boolean
  /**
   * A level already solved, picked again from Select Level. It leaves the
   * campaign where it was: Continue still goes to the level in progress.
   */
  readonly replay: boolean
}

/** Every level in `levels/`, disabled ones included, in `order.json` order. */
let allLevels: readonly PlayableLevel[] = []
/** The slugs `levels/disabled.json` leaves out of the campaign. */
let disabledSlugs: ReadonlySet<string> = new Set()
/** The campaign: every level that is not disabled, in `order.json` order. */
let levels: readonly PlayableLevel[] = []
/** The level `levels/default-skin.json` lends a skin from, or null for none. */
let defaultSkinSlug: string | null = null
let save: Save = { current: null, completed: [] }

/** The level on the board, or null when there is none. */
let play: Play | null = null

/** The slide in progress on the board, or null while the pieces are at rest. */
let slide: { readonly from: LevelState; readonly startedAt: number } | null =
  null
let slideFrame = 0

/**
 * The menu the arrow keys drive, or null while they drive the board. Exactly
 * one thing on screen takes the keys at a time.
 */
let activeMenu: Menu | null = null

// --- View transitions -------------------------------------------------------

/** True while a view change runs inside a transition's update. */
let inViewUpdate = false

/**
 * True from asking for a transition until its update runs — a frame, while
 * the browser snapshots the old view. Keys are ignored meanwhile, so a second
 * Enter cannot act on the menu that is about to go.
 */
let viewUpdatePending = false

/**
 * Runs a change to what is on screen as a crossfade from the old view — the
 * timing is in the stylesheet. Directly when the browser has no view
 * transitions, the player prefers reduced motion, or a transition is already
 * running this update, so a change made inside another is part of it.
 *
 * The update must be the whole change, not just its first step: it runs a
 * frame later, and anything after this call would see the old view.
 *
 * `durationMs` overrides the stylesheet's timing for this one transition. Every
 * call sets or clears it, so a slower one never leaks into the next.
 */
function transitionView(update: () => void, durationMs?: number): void {
  if (
    inViewUpdate ||
    !('startViewTransition' in document) ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    update()

    return
  }

  const rootStyle = document.documentElement.style

  if (durationMs === undefined) {
    rootStyle.removeProperty('--view-transition-duration')
  } else {
    rootStyle.setProperty('--view-transition-duration', `${durationMs}ms`)
  }

  viewUpdatePending = true
  document.startViewTransition(() => {
    viewUpdatePending = false
    inViewUpdate = true

    try {
      update()
    } finally {
      inViewUpdate = false
    }
  })
}

/**
 * For a function that changes the view: hands it over to a transition and
 * says so, or says it should go ahead now — it is already inside one.
 */
function deferToTransition(change: () => void): boolean {
  if (inViewUpdate) {
    return false
  }

  transitionView(change)

  return true
}

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
  if (!play || play.solved || play.replay) {
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
  if (deferToTransition(showTitle)) {
    return
  }

  persistProgress()
  play = null
  hideOverlay()

  const resume = resolveResume(save, getSlugs())
  const items: MenuItem[] = []

  if (resume) {
    items.push({
      label: 'Continue',
      action: () => startLevel(resume.index, resume.lurd, resume.timeMs),
    })
  }

  if (countUnlocked(save, getSlugs()) > 0) {
    items.push({ label: 'Select Level', action: showLevelSelect })
  }

  items.push({
    label: 'New Game',
    action: resume ? confirmNewGame : startNewGame,
  })
  items.push(...(devTools?.titleItems ?? []))

  titlePrompt.style.visibility = 'hidden'
  setMenu(titleMenuSlot, createMenu(items))
  showScreen(titleSection)
}

function getSlugs(): string[] {
  return levels.map((level) => level.slug)
}

// --- Level select -----------------------------------------------------------

/** The level select on screen, kept so a resize can redraw its miniatures. */
let levelGrid: LevelGrid | null = null

/**
 * Every level, with the solved ones and the one after the furthest open to
 * pick. Opens on the level Continue would play, or the furthest open one once
 * the campaign is over.
 */
function showLevelSelect(): void {
  if (deferToTransition(showLevelSelect)) {
    return
  }

  const unlocked = countUnlocked(save, getSlugs())
  const resume = resolveResume(save, getSlugs())
  const results = new Map(save.completed.map((result) => [result.slug, result]))

  const cards: LevelCard[] = levels.map((level, index) => {
    const result = results.get(level.slug)
    const locked = index >= unlocked
    const status = result
      ? `✓ ${result.moves} moves · ${formatDuration(result.timeMs)}`
      : locked
        ? 'locked'
        : save.current?.slug === level.slug && save.current.lurd !== ''
          ? 'in progress'
          : 'next'

    return { level, status, locked }
  })

  levelGrid = createLevelGrid(cards, {
    onPick: playLevel,
    onEscape: showTitle,
    initial: Math.min(resume?.index ?? unlocked - 1, unlocked - 1),
  })

  setMenu(levelsGridSlot, levelGrid)
  showScreen(levelsSection)
  // Only now that the cards have their size.
  levelGrid.repaint()
  levelGrid.reveal()
}

/**
 * A level picked by the player rather than reached by the campaign: the one
 * in progress picks up where it was left, one already solved is a replay, and
 * any other joins the campaign from its start.
 */
function playLevel(index: number): void {
  const { slug } = levels[index]

  if (save.current?.slug === slug) {
    startLevel(index, save.current.lurd, save.current.timeMs)

    return
  }

  const replay = save.completed.some((result) => result.slug === slug)
  startLevel(index, '', 0, replay)
}

function confirmNewGame(): void {
  if (deferToTransition(confirmNewGame)) {
    return
  }

  titlePrompt.style.visibility = 'visible'
  setMenu(
    titleMenuSlot,
    createMenu(
      [
        { label: 'Cancel', action: showTitle },
        { label: 'Yes', action: startNewGame },
      ],
      { onEscape: showTitle, initial: 1 },
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

// --- The title motif ------------------------------------------------------

/** How big the motif's cells are when drawn in CSS alone. */
const MOTIF_CELL_PX = 28

/**
 * The title's player, crate and goal, drawn with the default skin's tiles so
 * the first screen looks like the game that follows — or left to the CSS
 * shapes when there is no default skin. A pixelated skin scales by a whole
 * number, so its pixels stay square.
 */
function paintMotif(): void {
  const skin =
    allLevels.find((level) => level.slug === defaultSkinSlug)?.ownSkin ?? null
  const cells: [string, TileRole][] = [
    ['.player', 'player'],
    ['.crate', 'box'],
    ['.goal', 'goal'],
  ]
  const tiles = cells.map(([selector, role]) => ({
    cell: requireElement<HTMLElement>(`#title .motif ${selector}`),
    rect: skin && getSkinTileRect(skin, role),
  }))
  const isSkinned = skin !== null && tiles.every(({ rect }) => rect)

  titleMotif.classList.toggle('skinned', isSkinned)

  for (const { cell, rect } of tiles) {
    if (!isSkinned || !skin || !rect) {
      cell.replaceChildren()
      continue
    }

    const tile = document.createElement('canvas')
    const scale = skin.isPixelated
      ? Math.max(1, Math.round(MOTIF_CELL_PX / rect.height))
      : MOTIF_CELL_PX / rect.height
    tile.width = rect.width
    tile.height = rect.height
    tile.style.width = `${rect.width * scale}px`
    tile.style.height = `${rect.height * scale}px`
    tile.style.imageRendering = skin.isPixelated ? 'pixelated' : 'auto'
    tile
      .getContext('2d')
      ?.drawImage(
        skin.image,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        rect.width,
        rect.height,
      )
    cell.replaceChildren(tile)
  }
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
function startLevel(
  index: number,
  lurd = '',
  timeMs = 0,
  replay = false,
): void {
  if (deferToTransition(() => startLevel(index, lurd, timeMs, replay))) {
    return
  }

  stopSlide()

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
    replay,
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

  // The HUD first, so the board measures itself against its final layout.
  updateHud()
  drawBoard()
}

/**
 * Draws the board, part way through the slide if one is running, and asks for
 * the next frame until it lands. Safe to call at any time — a resize mid-slide
 * just draws the same frame at the new size.
 */
function drawBoard(): void {
  cancelAnimationFrame(slideFrame)

  if (!play) {
    return
  }

  const current = play.history.current()

  if (!slide) {
    play.render(current)

    return
  }

  const elapsed = (performance.now() - slide.startedAt) / MOVE_ANIMATION_MS
  const progress = Math.min(1, elapsed)
  play.render(current, { from: slide.from, progress })

  if (progress >= 1) {
    slide = null

    return
  }

  slideFrame = requestAnimationFrame(drawBoard)
}

function startSlide(from: LevelState): void {
  slide = reducedMotion.matches ? null : { from, startedAt: performance.now() }
}

function stopSlide(): void {
  cancelAnimationFrame(slideFrame)
  slide = null
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
  if (!play) {
    return
  }

  const previous = play.history.current()

  if (!play.history.run(command)) {
    return
  }

  // A move or an undo is one step either way; a reset jumps, so it does not slide.
  if (command.type === 'reset') {
    stopSlide()
  } else {
    startSlide(previous)
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
  // A level solved again — replayed, or won again in the dev build — replaces
  // its earlier result.
  const completed = [
    ...save.completed.filter((each) => each.slug !== result.slug),
    result,
  ]
  const nextIndex = current.index + 1
  const isLast = nextIndex >= levels.length

  save = {
    current: current.replay
      ? save.current
      : isLast
        ? null
        : { slug: levels[nextIndex].slug, lurd: '', timeMs: 0 },
    completed,
  }
  persist()
  updateHud()

  window.setTimeout(() => {
    // Left for the title or another level while the board was showing.
    if (play !== current || gameSection.hidden) {
      return
    }

    transitionView(
      () => showCompleteOverlay(current, result, nextIndex, isLast),
      COMPLETE_FADE_IN_MS,
    )
  }, COMPLETE_DELAY_MS)
}

function showCompleteOverlay(
  current: Play,
  result: LevelResult,
  nextIndex: number,
  isLast: boolean,
): void {
  showOverlay({
    eyebrow: `Level ${current.index + 1} of ${levels.length}`,
    title: isLast ? 'Final level solved' : 'Level complete',
    body: [createStats(result)],
    menu: createMenu(
      isLast
        ? current.replay
          ? [{ label: 'Main menu', action: showTitle }]
          : [{ label: 'See results', action: showFinished }]
        : [
            { label: 'Next level', action: () => playLevel(nextIndex) },
            { label: 'Main menu', action: showTitle },
          ],
      { onEscape: showTitle },
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

// --- The overlay: level complete and restart --------------------------------

type OverlayContent = {
  readonly eyebrow: string
  readonly title: string
  readonly body: readonly Node[]
  readonly menu: Menu
}

function showOverlay(content: OverlayContent): void {
  if (deferToTransition(() => showOverlay(content))) {
    return
  }

  const { eyebrow, title, body, menu } = content
  overlayEyebrow.textContent = eyebrow
  overlayEyebrow.hidden = eyebrow === ''
  overlayTitle.textContent = title
  overlayBody.replaceChildren(...body)
  setMenu(overlayMenuSlot, menu)
  overlay.hidden = false
  syncClock()
}

function hideOverlay(): void {
  if (deferToTransition(hideOverlay)) {
    return
  }

  overlay.hidden = true
  overlayMenuSlot.replaceChildren()
  activeMenu = null
  syncClock()
}

/** Restarting throws away every move, so it asks first — unless there are none. */
function confirmRestart(): void {
  if (!play || play.history.moveCount() === 0) {
    return
  }

  const prompt = document.createElement('p')
  prompt.className = 'prompt'
  prompt.textContent = 'Your moves on this level will be lost.'

  showOverlay({
    eyebrow: '',
    title: 'Restart level?',
    body: [prompt],
    menu: createMenu(
      [
        { label: 'Cancel', action: hideOverlay },
        {
          label: 'Yes',
          action: () =>
            transitionView(() => {
              hideOverlay()
              runCommand({ type: 'reset' })
            }),
        },
      ],
      { onEscape: hideOverlay, initial: 1 },
    ),
  })
}

// --- The finale -------------------------------------------------------------

function showFinished(): void {
  if (deferToTransition(showFinished)) {
    return
  }

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
  if (event.metaKey || event.ctrlKey || event.altKey || viewUpdatePending) {
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
    showTitle()

    return
  }

  if (devTools?.handleGameKey(event)) {
    event.preventDefault()

    return
  }

  // Solved, and waiting out the pause before the panel.
  if (play.solved) {
    return
  }

  const command = BINDINGS[event.key] ?? BINDINGS[event.key.toLowerCase()]

  if (!command) {
    return
  }

  event.preventDefault()

  if (command.type === 'reset') {
    confirmRestart()

    return
  }

  runCommand(command)
})

window.addEventListener('resize', () => {
  updateGame()

  if (!levelsSection.hidden) {
    levelGrid?.repaint()
  }
})

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

function setLevels(
  ordered: readonly PlayableLevel[],
  disabled: Iterable<string>,
): void {
  allLevels = ordered
  disabledSlugs = new Set(disabled)
  levels = ordered.filter((level) => !disabledSlugs.has(level.slug))
  paintMotif()
}

function setDefaultSkin(from: string | null): void {
  defaultSkinSlug = from
  paintMotif()
}

async function start(): Promise<void> {
  const catalog = await loadLevelCatalog()
  defaultSkinSlug = catalog.defaultSkin
  setLevels(catalog.levels, catalog.disabled)
  save = readStoredSave(SAVE_KEY) ?? save

  if (IS_DEV_BUILD) {
    const { createDevTools } = await import('./dev-tools')

    devTools = createDevTools({
      levels: () => allLevels,
      disabled: () => disabledSlugs,
      setLevels,
      defaultSkin: catalog.defaultSkin,
      setDefaultSkin,
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
      startCampaignAt: (slug) => {
        const index = levels.findIndex((level) => level.slug === slug)

        if (index !== -1) {
          startCampaignAt(index)
        }
      },
      winLevel: completeLevel,
      gameFooter,
    })
  } else {
    for (const problem of catalog.problems) {
      console.warn(problem)
    }
  }

  transitionView(() => {
    if (devTools?.resume()) {
      return
    }

    showTitle()
    // Only this first time: the menu's items rise in where the loader was.
    titleMenuSlot.querySelector('.menu')?.classList.add('entering')
  })
}

void start()
