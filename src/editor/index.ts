import { requireElement, type EditorMode } from './dom'
import { createEmptyLevelDocument, createLevelMode } from './level-mode'
import { createSession } from './session'
import { createSkinMode } from './skin-mode'

type ModeName = 'level' | 'skin'

const session = createSession(createEmptyLevelDocument())

// One session, two modes: the skin preview renders the level being drawn, so
// the two panels share the document rather than each holding their own.
const modes: Record<ModeName, EditorMode> = {
  level: createLevelMode(session),
  skin: createSkinMode(session),
}

const sections: Record<ModeName, HTMLElement> = {
  level: requireElement<HTMLElement>('#level-mode'),
  skin: requireElement<HTMLElement>('#skin-mode'),
}

const buttons: Record<ModeName, HTMLButtonElement> = {
  level: requireElement<HTMLButtonElement>('#mode-level'),
  skin: requireElement<HTMLButtonElement>('#mode-skin'),
}

let activeMode: ModeName = 'level'

function activate(mode: ModeName): void {
  activeMode = mode

  for (const name of ['level', 'skin'] as const) {
    sections[name].hidden = name !== mode
    buttons[name].setAttribute('aria-pressed', String(name === mode))
  }

  // Canvases size themselves from their element, which reads as zero while the
  // section is hidden, so the incoming mode always redraws on arrival.
  modes[mode].update()
}

for (const name of ['level', 'skin'] as const) {
  buttons[name].addEventListener('click', () => activate(name))
}

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
