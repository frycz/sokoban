import { createInitialLevelDocument, createLevelAutosave } from './autosave'
import {
  createColorPaletteLibraryStore,
  createInitialColorPaletteLibrary,
} from './color-palette-library'
import { createColorsMode } from './colors-mode'
import { isUndoKey, requireElement, type EditorMode } from './dom'
import { createLevelMode } from './level-mode'
import { createLevelPicker } from './level-picker'
import { openLevelBundle, type LevelBundle } from './open-level'
import { createPublishPanel } from './publish'
import { createSavePanel } from './save-panel'
import { createSaveStore, type EditorSave } from './saves'
import { createSession } from './session'
import { createSkinMode } from './skin-mode'
import { clearStoredEditor, readStoredText, writeStoredText } from './storage'
import {
  decodeStoredLevel,
  decodeStoredSkin,
  encodeStoredLevel,
  encodeStoredSkin,
} from './stored-state'

const MODE_NAMES = ['level', 'skin', 'colors'] as const

type ModeName = (typeof MODE_NAMES)[number]

/**
 * The mode is stored as its bare name: there is nothing else to it, and anything
 * that is not one of the names — an older build, a hand edit — opens on level.
 */
function readStoredMode(): ModeName {
  const stored = readStoredText('mode')

  return MODE_NAMES.find((name) => name === stored) ?? 'level'
}

// The editor opens on whatever was last autosaved. The level is read here
// because the session is built from it; the skin reads its own slice. Each mode
// then writes only its own, which is why there are four keys — see
// `storage.ts`.
const session = createSession(createInitialLevelDocument())

// Both panels edit the level now — level mode paints cells, skin mode places
// custom tiles on them — so the `level` slice's autosave is built once here and
// handed to both rather than owned by either.
const levelAutosave = createLevelAutosave(session)

// The same arrangement for the palettes, for the same reason: colours mode
// edits them and skin mode reads them, so the library belongs to neither.
const colorPalettes = createColorPaletteLibraryStore(
  createInitialColorPaletteLibrary(),
)

// One session, two modes: the skin preview renders the level being drawn, so
// the two panels share the document rather than each holding their own.
const skinMode = createSkinMode(session, levelAutosave, colorPalettes)

const levelMode = createLevelMode(session, levelAutosave)

const modes: Record<ModeName, EditorMode> = {
  level: levelMode,
  skin: skinMode,
  colors: createColorsMode(colorPalettes, () => session.record()),
}

// The skin and the palettes go on the level's undo stack, so Undo steps back
// through any edit in any panel, whichever panel is showing.
session.track(skinMode.undoSlice)
session.track({
  read: colorPalettes.current,
  // Saved here, because Undo redraws only the panel that is showing.
  write: (library) => {
    colorPalettes.replace(library)
    colorPalettes.persist()
  },
})

// Not a mode: a level bundle is the level and the tiles together, so the one
// control that needs both halves sits in the top bar and is owned here, for the
// same reason Clear storage is.
const publishPanel = createPublishPanel(session, skinMode.getSkinExport, () => {
  void levelPicker.refresh()
})

/**
 * Opening a level from `levels/` replaces both halves, like Export writes both,
 * and one Undo brings both back: the skin is swapped before the document, so
 * the document's entry holds the two together.
 */
async function openLevel(bundle: LevelBundle): Promise<void> {
  const opened = openLevelBundle(bundle)

  await skinMode.openSkin(opened.skin)
  session.replace(opened.document)
  levelMode.showReplacedDocument()
  publishPanel.showOpened(bundle.name, bundle.slug, opened.problems)
  modes[activeMode].update()
}

const levelPicker = createLevelPicker(openLevel, publishPanel.showError)

/**
 * A save is the same three slices the autosave keeps — level, skin and the
 * publish name — so opening one is opening a level bundle without the repacking:
 * the skin and then the document, so one Undo brings the previous work back. The
 * palettes are not part of it, because they outlive any
 * one level.
 */
async function openSave(save: EditorSave): Promise<void> {
  const opened = decodeStoredLevel(save.level)

  if (!opened) {
    throw new Error(`“${save.name}” has no level this build can read.`)
  }

  await skinMode.openSkin(decodeStoredSkin(save.skin))
  session.replace(opened)
  levelMode.showReplacedDocument()
  publishPanel.restore(save.publish)
  modes[activeMode].update()
}

const savePanel = createSavePanel({
  store: createSaveStore(),
  getSnapshot: () => {
    const skin = skinMode.getStoredSkin()

    return {
      level: encodeStoredLevel(session.current()),
      skin: encodeStoredSkin(skin.draft, skin.sheetDataUrl),
      publish: publishPanel.getHome(),
    }
  },
  onOpen: openSave,
  showMessage: publishPanel.showMessage,
  showError: publishPanel.showError,
})

const sections: Record<ModeName, HTMLElement> = {
  level: requireElement<HTMLElement>('#level-mode'),
  skin: requireElement<HTMLElement>('#skin-mode'),
  colors: requireElement<HTMLElement>('#colors-mode'),
}

const buttons: Record<ModeName, HTMLButtonElement> = {
  level: requireElement<HTMLButtonElement>('#mode-level'),
  skin: requireElement<HTMLButtonElement>('#mode-skin'),
  colors: requireElement<HTMLButtonElement>('#mode-colors'),
}

let activeMode: ModeName = 'level'

function activate(mode: ModeName): void {
  activeMode = mode

  for (const name of MODE_NAMES) {
    sections[name].hidden = name !== mode
    buttons[name].setAttribute('aria-pressed', String(name === mode))
  }

  // Canvases size themselves from their element, which reads as zero while the
  // section is hidden, so the incoming mode always redraws on arrival. That is
  // also how skin mode picks up a palette made in colours mode: it reads the
  // library on every redraw, and a mode switch is one.
  modes[mode].update()
}

// Written from the click rather than from `activate`, so opening the editor on
// the stored mode does not write it straight back. A refused write costs only
// the selection on the next reload, so it is not reported.
for (const name of MODE_NAMES) {
  buttons[name].addEventListener('click', () => {
    activate(name)
    writeStoredText('mode', name)
  })
}

// Clearing storage without resetting the editor would be a lie: the next edit
// autosaves and the state is back. So it does both, and asks first — the work
// in the three panels is the only copy there is. The mode is the exception: it
// stays where it is, because the view is not the work, and the next switch
// stores it again.
requireElement<HTMLButtonElement>('#clear-storage').addEventListener(
  'click',
  () => {
    if (
      !window.confirm(
        'Clear the autosaved state and start over? Named saves are kept.',
      )
    ) {
      return
    }

    clearStoredEditor()

    for (const name of MODE_NAMES) {
      modes[name].reset()
    }

    publishPanel.reset()
    savePanel.reset()
    modes[activeMode].update()
  },
)

const undoButton = requireElement<HTMLButtonElement>('#undo')

function undo(): void {
  if (!session.undo()) {
    return
  }

  // Undo can reach any of the three, so the size fields are squared up and the
  // showing panel redrawn, whichever panel the edit was made in.
  levelMode.showReplacedDocument()
  modes[activeMode].update()
}

undoButton.addEventListener('click', undo)
session.onChange(() => {
  undoButton.disabled = !session.canUndo()
})
undoButton.disabled = true

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT')
  )
}

// One gesture, one undo entry. Every pointer press and key press opens a new
// entry, and so does the first `input` from a control; the rest of its `input`
// events fold into it — a drag through a colour picker, a name typed — until
// its `change` closes the visit. Capturing, so the entry is open before any
// handler edits.
let inputTarget: EventTarget | null = null

window.addEventListener('pointerdown', () => session.beginStroke(), true)
window.addEventListener(
  'keydown',
  (event) => {
    if (!isTextField(event.target)) {
      session.beginStroke()
    }
  },
  true,
)
window.addEventListener(
  'input',
  (event) => {
    if (event.target !== inputTarget) {
      inputTarget = event.target
      session.beginStroke()
    }
  },
  true,
)
window.addEventListener(
  'change',
  () => {
    inputTarget = null
    session.beginStroke()
  },
  true,
)

// Not every edit redraws — a name being typed does not — so whatever a control
// changed is recorded once its own handlers are done with it.
window.addEventListener('input', () => session.record())
window.addEventListener('change', () => session.record())

window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return
  }

  // Buttons are deliberately not excluded: clicking a brush leaves it focused,
  // and the number keys have to keep working afterwards.
  if (isTextField(event.target)) {
    return
  }

  if (isUndoKey(event)) {
    undo()
    event.preventDefault()

    return
  }

  if (modes[activeMode].handleKey?.(event)) {
    event.preventDefault()
  }
})

window.addEventListener('resize', () => modes[activeMode].update())

activate(readStoredMode())
