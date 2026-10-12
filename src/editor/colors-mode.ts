import type { ColorPaletteLibraryStore } from './color-palette-library'
import {
  addColorPalette,
  addColorsToPalette,
  EMPTY_COLOR_PALETTE_LIBRARY,
  getNextColorPaletteId,
  removeColorFromPalette,
  removeColorPalette,
  renameColorPalette,
  replaceColorInPalette,
  resolveColorPalette,
  type ColorPalette,
} from './color-palettes'
import {
  commitFieldOnEnter,
  copyTextToClipboard,
  requireElement,
  type EditorMode,
} from './dom'
import { formatHexColors, parseHexColor, parseHexColors } from './hex'
import {
  readSwatchClick,
  renderSwatches,
  SELECT_ACTION,
  type SwatchAction,
} from './swatches'

const COPY_ACTION = 'copy'
const REMOVE_ACTION = 'remove'

const SWATCH_ACTIONS: readonly SwatchAction[] = [
  { action: COPY_ACTION, glyph: '⧉', title: 'Copy the hex' },
  { action: REMOVE_ACTION, glyph: '×', title: 'Remove from the palette' },
]

/** What the colour picker opens on, and what a palette's first colour tends to be. */
const INITIAL_PICKED_COLOR = '#ffffff'

/**
 * The third mode: palettes of colours, kept beside the level rather than in it.
 * It owns no canvas and no document — the whole panel is the library and one
 * picker — which is why it is the shortest of the three.
 *
 * The level and the skin are each one thing being made. A palette library is a
 * list of lists, so this panel has two selections to keep: which palette, and
 * which colour inside it. Both are view state, both are resolved against the
 * library on every redraw rather than kept in step with it by hand, so an edit
 * that removes what was selected cannot leave a selection pointing at nothing.
 */
/**
 * `record` puts the palettes' edits on the editor's undo stack; the session is
 * the level's, so this panel is handed only the one call it needs.
 */
export function createColorsMode(
  store: ColorPaletteLibraryStore,
  record: () => void,
): EditorMode {
  const paletteList = requireElement<HTMLElement>('#palette-list')
  const newNameInput = requireElement<HTMLInputElement>('#new-palette-name')
  const newButton = requireElement<HTMLButtonElement>('#palette-new')
  const nameInput = requireElement<HTMLInputElement>('#palette-name')
  const deleteButton = requireElement<HTMLButtonElement>('#palette-delete')
  const swatchList = requireElement<HTMLElement>('#palette-swatches')
  const pickerInput = requireElement<HTMLInputElement>('#color-picker')
  const hexInput = requireElement<HTMLInputElement>('#color-hex')
  const addButton = requireElement<HTMLButtonElement>('#color-add')
  const replaceButton = requireElement<HTMLButtonElement>('#color-replace')
  const copyAllButton = requireElement<HTMLButtonElement>('#colors-copy')
  const pasteText = requireElement<HTMLTextAreaElement>('#palette-paste')
  const pasteButton = requireElement<HTMLButtonElement>('#palette-paste-add')
  const dumpButton = requireElement<HTMLButtonElement>('#palette-paste-fill')
  const report = requireElement<HTMLElement>('#colors-report')

  let selectedPaletteId: string | null = null
  let selectedColorIndex = -1
  // The last thing said, kept rather than appended, because the report is
  // rebuilt on every redraw: a message that is not held here would be wiped by
  // the next one. Cleared by the next action that has something else to say.
  let note: { readonly message: string; readonly className: string } | null =
    null

  function setNote(message: string, className: string): void {
    note = { message, className }
  }

  function addMessage(message: string, className: string): void {
    const line = document.createElement('p')
    line.className = className
    line.textContent = message
    report.append(line)
  }

  /**
   * The selection follows the library: the chosen palette, or the first one
   * when the chosen one has been deleted, or none when there are none. Writing
   * the resolved id back is the point — every later edit names a palette that
   * is still there.
   */
  function resolveSelection(): ColorPalette | null {
    const palette = resolveColorPalette(store.current(), selectedPaletteId)
    selectedPaletteId = palette?.id ?? null

    if (palette === null || selectedColorIndex >= palette.colors.length) {
      selectedColorIndex = -1
    }

    return palette
  }

  function renderPaletteList(palette: ColorPalette | null): void {
    paletteList.replaceChildren()

    for (const entry of store.current().palettes) {
      const row = document.createElement('div')
      row.className = 'palette-row'

      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.palette = entry.id
      button.setAttribute('aria-pressed', String(entry.id === palette?.id))

      const label = document.createElement('span')
      label.className = 'name'
      label.textContent = entry.name

      // The first few colours, so a palette is recognisable in the list before
      // it is opened — which is what a name alone never manages.
      const strip = document.createElement('span')
      strip.className = 'strip'

      for (const color of entry.colors.slice(0, 8)) {
        const chip = document.createElement('span')
        chip.className = 'chip'
        chip.style.background = color
        strip.append(chip)
      }

      const count = document.createElement('span')
      count.className = 'count'
      count.textContent = String(entry.colors.length)

      button.append(label, strip, count)
      row.append(button)
      paletteList.append(row)
    }
  }

  function renderReport(palette: ColorPalette | null): void {
    report.replaceChildren()

    if (store.current().palettes.length === 0) {
      addMessage('No palettes yet — name one and press New.', 'warning')
    } else if (palette !== null && palette.colors.length === 0) {
      addMessage('No colours yet — pick one and press add.', 'warning')
    }

    if (note !== null) {
      addMessage(note.message, note.className)
    }

    if (store.hasFailed()) {
      addMessage(
        'Palettes are not being saved — browser storage is unavailable.',
        'warning',
      )
    }
  }

  function update(): void {
    store.persist()
    record()

    const palette = resolveSelection()

    // Never while it is being typed in: the field is what is editing the name,
    // so writing to it would move the caret out from under the author.
    if (
      document.activeElement !== nameInput &&
      nameInput.value !== (palette?.name ?? '')
    ) {
      nameInput.value = palette?.name ?? ''
    }

    nameInput.disabled = palette === null
    deleteButton.disabled = palette === null
    addButton.disabled = palette === null
    pasteButton.disabled = palette === null
    dumpButton.disabled = palette === null
    replaceButton.disabled = palette === null || selectedColorIndex < 0
    copyAllButton.disabled = palette === null || palette.colors.length === 0

    renderSwatches(swatchList, palette?.colors ?? [], SWATCH_ACTIONS, {
      selectedIndex: selectedColorIndex,
      emptyMessage:
        palette === null
          ? 'Make a palette to put colours in.'
          : 'Nothing in this palette yet.',
    })
    renderPaletteList(palette)
    renderReport(palette)
  }

  /** The picker and the field are two views of one colour; this is the colour. */
  function getPickedColor(): string {
    return parseHexColor(hexInput.value) ?? pickerInput.value
  }

  function setPickedColor(color: string): void {
    pickerInput.value = color

    if (document.activeElement !== hexInput) {
      hexInput.value = color
    }
  }

  function copyHex(color: string): void {
    void copyTextToClipboard(color).then((copied) => {
      setNote(
        copied
          ? `Copied ${color}.`
          : `Could not reach the clipboard — ${color}`,
        copied ? 'ok' : 'error',
      )
      update()
    })
  }

  newButton.addEventListener('click', () => {
    const library = store.current()
    const id = getNextColorPaletteId(library)

    store.replace(addColorPalette(library, id, newNameInput.value))
    selectedPaletteId = id
    selectedColorIndex = -1
    newNameInput.value = ''
    setNote('Palette added.', 'ok')
    update()
  })

  // Enter in the name box is what a text field next to a New button means.
  newNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      newButton.click()
    }
  })

  /**
   * Deleting asks first, the same way clearing storage does: it is undoable, but
   * only while it is still among the last few edits.
   */
  deleteButton.addEventListener('click', () => {
    const palette = resolveSelection()

    if (
      palette === null ||
      !window.confirm(`Delete the palette "${palette.name}"?`)
    ) {
      return
    }

    store.replace(removeColorPalette(store.current(), palette.id))
    selectedColorIndex = -1
    setNote(`Deleted "${palette.name}".`, 'warning')
    update()
  })

  nameInput.addEventListener('input', () => {
    if (selectedPaletteId === null) {
      return
    }

    if (
      store.replace(
        renameColorPalette(store.current(), selectedPaletteId, nameInput.value),
      )
    ) {
      // The list shows the name, so it has to follow the keystroke — but the
      // rest of the panel does not, and a full redraw would write to the field
      // being typed in. Autosave waits for `change`, as the skin's name does.
      renderPaletteList(resolveSelection())
    }
  })

  nameInput.addEventListener('change', () => store.persist())

  paletteList.addEventListener('click', (event) => {
    const id = (event.target as Element)
      .closest('button[data-palette]')
      ?.getAttribute('data-palette')

    if (id !== null && id !== undefined) {
      selectedPaletteId = id
      selectedColorIndex = -1
      note = null
      update()
    }
  })

  pickerInput.addEventListener('input', () => setPickedColor(pickerInput.value))

  /**
   * Typed or pasted hex. Only the picker is moved while it parses — the field
   * keeps whatever is in it, because half a hex is a legitimate thing to be
   * looking at mid-keystroke and correcting it under the caret is not help.
   */
  hexInput.addEventListener('input', () => {
    const color = parseHexColor(hexInput.value)

    if (color !== null) {
      pickerInput.value = color
    }
  })

  // On the way out, the field becomes what the picker holds, so an abandoned
  // half-hex does not sit there looking like the colour that would be added.
  hexInput.addEventListener('change', () => {
    hexInput.value = pickerInput.value
  })

  hexInput.addEventListener('keydown', commitFieldOnEnter)

  addButton.addEventListener('click', () => {
    if (selectedPaletteId === null) {
      return
    }

    const color = getPickedColor()

    setNote(
      store.replace(
        addColorsToPalette(store.current(), selectedPaletteId, [color]),
      )
        ? `Added ${color}.`
        : `${color} is already in this palette.`,
      'ok',
    )
    setPickedColor(color)
    update()
  })

  replaceButton.addEventListener('click', () => {
    if (selectedPaletteId === null || selectedColorIndex < 0) {
      return
    }

    const color = getPickedColor()

    setNote(
      store.replace(
        replaceColorInPalette(
          store.current(),
          selectedPaletteId,
          selectedColorIndex,
          color,
        ),
      )
        ? `Replaced with ${color}.`
        : `${color} is already in this palette.`,
      'ok',
    )
    setPickedColor(color)
    update()
  })

  copyAllButton.addEventListener('click', () => {
    const palette = resolveSelection()

    if (palette !== null) {
      copyHex(formatHexColors(palette.colors))
    }
  })

  /**
   * A click on the chip selects — which is what the replace button acts on, and
   * what loads the colour into the picker so an edit starts from it rather than
   * from white.
   */
  swatchList.addEventListener('click', (event) => {
    const click = readSwatchClick(event.target as Element)
    const palette = resolveSelection()

    if (click === null || palette === null) {
      return
    }

    const color = palette.colors[click.index]

    if (click.action === SELECT_ACTION) {
      selectedColorIndex = click.index
      setPickedColor(color)
      note = null
      update()

      return
    }

    if (click.action === COPY_ACTION) {
      copyHex(color)

      return
    }

    if (click.action === REMOVE_ACTION) {
      store.replace(
        removeColorFromPalette(store.current(), palette.id, click.index),
      )
      selectedColorIndex = -1
      setNote(`Removed ${color}.`, 'warning')
      update()
    }
  })

  pasteButton.addEventListener('click', () => {
    if (selectedPaletteId === null) {
      return
    }

    const palette = resolveSelection()
    const found = parseHexColors(pasteText.value)

    if (palette === null || found.length === 0) {
      setNote('No hex colours found in that text.', 'error')
      update()

      return
    }

    const before = palette.colors.length

    store.replace(addColorsToPalette(store.current(), palette.id, found))

    const added = (resolveSelection()?.colors.length ?? before) - before

    setNote(
      `Read ${found.length} ${found.length === 1 ? 'colour' : 'colours'}, added ${added}.`,
      added === 0 ? 'warning' : 'ok',
    )
    update()
  })

  // The other direction through the same box, which is the fallback for every
  // browser that refuses the clipboard: the hexes are there to select by hand.
  dumpButton.addEventListener('click', () => {
    const palette = resolveSelection()

    if (palette !== null) {
      pasteText.value = formatHexColors(palette.colors)
      setNote(`${palette.colors.length} hexes written below.`, 'ok')
      update()
    }
  })

  /** Called after storage has been cleared; see level mode's `reset`. */
  function reset(): void {
    store.replace(EMPTY_COLOR_PALETTE_LIBRARY)
    store.markSaved()
    selectedPaletteId = null
    selectedColorIndex = -1
    note = null
    newNameInput.value = ''
    pasteText.value = ''
    setPickedColor(INITIAL_PICKED_COLOR)
  }

  setPickedColor(INITIAL_PICKED_COLOR)

  return { update, reset }
}
