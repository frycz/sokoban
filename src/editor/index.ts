import { createInitialLevelDocument, createLevelAutosave } from './autosave'
import {
  createColorPaletteLibraryStore,
  createInitialColorPaletteLibrary,
} from './color-palette-library'
import { createColorsMode } from './colors-mode'
import { requireElement, type EditorMode } from './dom'
import { createLevelMode } from './level-mode'
import { createPublishPanel } from './publish'
import { createSession } from './session'
import { createSkinMode } from './skin-mode'
import { clearStoredEditor } from './storage'

const MODE_NAMES = ['level', 'skin', 'colors'] as const

type ModeName = (typeof MODE_NAMES)[number]

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

const modes: Record<ModeName, EditorMode> = {
  level: createLevelMode(session, levelAutosave),
  skin: skinMode,
  colors: createColorsMode(colorPalettes),
}

// Not a mode: a level bundle is the level and the tiles together, so the one
// control that needs both halves sits in the top bar and is owned here, for the
// same reason Clear storage is.
const publishPanel = createPublishPanel(session, skinMode.getSkinExport)

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

for (const name of MODE_NAMES) {
  buttons[name].addEventListener('click', () => activate(name))
}

// Clearing storage without resetting the editor would be a lie: the next edit
// autosaves and the state is back. So it does both, and asks first — the work
// in the three panels is the only copy there is.
requireElement<HTMLButtonElement>('#clear-storage').addEventListener(
  'click',
  () => {
    if (!window.confirm('Clear saved state and start over?')) {
      return
    }

    clearStoredEditor()

    for (const name of MODE_NAMES) {
      modes[name].reset()
    }

    publishPanel.reset()
    modes[activeMode].update()
  },
)

window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return
  }

  const target = event.target as Element | null

  // Buttons are deliberately not excluded: clicking a brush leaves it focused,
  // and the number keys have to keep working afterwards.
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
    return
  }

  if (modes[activeMode].handleKey?.(event)) {
    event.preventDefault()
  }
})

window.addEventListener('resize', () => modes[activeMode].update())

activate('level')
