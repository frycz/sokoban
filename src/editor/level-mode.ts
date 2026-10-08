import { createEditorRenderer } from './canvas'
import {
  createEmptyDocument,
  MAX_DOCUMENT_SIZE,
  MIN_DOCUMENT_SIZE,
  type Brush,
  type EditorDocument,
} from './document'
import { requireElement, type EditorMode } from './dom'
import { computeGridLayout, getPositionAtPixel } from './layout'
import type { Session } from './session'
import { readStoredText, writeStoredText } from './storage'
import { decodeStoredLevel, encodeStoredLevel } from './stored-state'
import { validateDocument } from './validate'
import { formatDocumentAsXsb, parseXsbToDocument } from './xsb'

const DEFAULT_WIDTH = 16
const DEFAULT_HEIGHT = 12

const BRUSH_OF_KEY: Record<string, Brush | undefined> = {
  '1': 'wall',
  '2': 'floor',
  '3': 'goal',
  '4': 'box',
  '5': 'player',
}

function createEmptyLevelDocument(): EditorDocument {
  return createEmptyDocument(DEFAULT_WIDTH, DEFAULT_HEIGHT)
}

/**
 * What the editor opens on: whatever was last autosaved, or a blank level. The
 * undo stack deliberately does not persist — a reload is a new session, and the
 * document is the work.
 */
export function createInitialLevelDocument(): EditorDocument {
  return (
    decodeStoredLevel(readStoredText('level')) ?? createEmptyLevelDocument()
  )
}

export function createLevelMode(session: Session): EditorMode {
  const canvas = requireElement<HTMLCanvasElement>('#grid')
  const brushes = requireElement<HTMLElement>('#brushes')
  const widthInput = requireElement<HTMLInputElement>('#width')
  const heightInput = requireElement<HTMLInputElement>('#height')
  const newButton = requireElement<HTMLButtonElement>('#new')
  const undoButton = requireElement<HTMLButtonElement>('#undo')
  const loadButton = requireElement<HTMLButtonElement>('#load')
  const exportButton = requireElement<HTMLButtonElement>('#export')
  const xsbText = requireElement<HTMLTextAreaElement>('#xsb')
  const report = requireElement<HTMLElement>('#report')

  const render = createEditorRenderer(canvas)

  let selectedBrush: Brush = 'floor'
  let hoverPosition = -1
  let isPainting = false
  // What storage already holds. The session was seeded from it, so the editor
  // starts in step and writes nothing until the document actually differs —
  // which is also what keeps hovering a cell, or a reset, from rewriting it.
  let savedLevel = encodeStoredLevel(session.current())
  let hasStorageFailed = false

  for (const input of [widthInput, heightInput]) {
    input.min = String(MIN_DOCUMENT_SIZE)
    input.max = String(MAX_DOCUMENT_SIZE)
  }

  function syncSizeInputs(): void {
    widthInput.value = String(session.current().width)
    heightInput.value = String(session.current().height)
  }

  /**
   * Every edit lands here, so autosave rides along with the redraw rather than
   * being remembered at each of the places that change the document. Writing a
   * few kilobytes of XSB is cheap enough to do per painted cell, and the
   * comparison above means an unchanged document costs one string compare.
   */
  function persist(): void {
    const text = encodeStoredLevel(session.current())

    if (text === savedLevel) {
      return
    }

    savedLevel = text
    hasStorageFailed = !writeStoredText('level', text)
  }

  function update(): void {
    const editorDocument = session.current()
    persist()
    render(editorDocument, hoverPosition)

    const validation = validateDocument(editorDocument)
    undoButton.disabled = !session.canUndo()
    report.replaceChildren()

    const summary = document.createElement('p')
    summary.className = validation.isPlayable ? 'ok' : 'error'
    summary.textContent = validation.isPlayable
      ? `Playable · ${validation.boxCount} boxes on ${validation.goalCount} goals`
      : `Not playable yet · ${validation.boxCount} boxes, ${validation.goalCount} goals`
    report.append(summary)

    for (const problem of validation.problems) {
      const line = document.createElement('p')
      line.className = problem.severity
      line.textContent = problem.message
      report.append(line)
    }

    if (hasStorageFailed) {
      const line = document.createElement('p')
      line.className = 'warning'
      line.textContent = 'Not being saved — browser storage is unavailable.'
      report.append(line)
    }
  }

  function showMessage(message: string): void {
    report.replaceChildren()
    const line = document.createElement('p')
    line.className = 'error'
    line.textContent = message
    report.append(line)
  }

  function getPositionFromPointer(event: PointerEvent): number {
    const editorDocument = session.current()
    const bounds = canvas.getBoundingClientRect()
    const layout = computeGridLayout(
      editorDocument,
      canvas.clientWidth,
      canvas.clientHeight,
    )

    return getPositionAtPixel(
      editorDocument,
      layout,
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    )
  }

  function selectBrush(brush: Brush): void {
    selectedBrush = brush

    for (const button of brushes.querySelectorAll('button[data-brush]')) {
      button.setAttribute(
        'aria-pressed',
        String(button.getAttribute('data-brush') === brush),
      )
    }
  }

  brushes.addEventListener('click', (event) => {
    const button = (event.target as Element).closest('button[data-brush]')
    const brush = button?.getAttribute('data-brush')

    if (brush) {
      selectBrush(brush as Brush)
    }
  })

  canvas.addEventListener('pointerdown', (event) => {
    const position = getPositionFromPointer(event)

    if (position < 0) {
      return
    }

    event.preventDefault()
    isPainting = true
    canvas.setPointerCapture(event.pointerId)
    hoverPosition = position
    session.beginStroke()
    session.paint(position, selectedBrush)
    update()
  })

  canvas.addEventListener('pointermove', (event) => {
    const position = getPositionFromPointer(event)
    let hasChanged = position !== hoverPosition
    hoverPosition = position

    if (isPainting && session.paint(position, selectedBrush)) {
      hasChanged = true
    }

    if (hasChanged) {
      update()
    }
  })

  canvas.addEventListener('pointerup', () => {
    isPainting = false
  })

  canvas.addEventListener('pointerleave', () => {
    isPainting = false
    hoverPosition = -1
    update()
  })

  newButton.addEventListener('click', () => {
    session.replace(
      createEmptyDocument(
        Number(widthInput.value) || DEFAULT_WIDTH,
        Number(heightInput.value) || DEFAULT_HEIGHT,
      ),
    )
    syncSizeInputs()
    update()
  })

  undoButton.addEventListener('click', () => {
    if (session.undo()) {
      syncSizeInputs()
      update()
    }
  })

  loadButton.addEventListener('click', () => {
    try {
      session.replace(parseXsbToDocument(xsbText.value))
      syncSizeInputs()
      update()
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error))
    }
  })

  exportButton.addEventListener('click', () => {
    xsbText.value = formatDocumentAsXsb(session.current())
    update()
  })

  for (const input of [widthInput, heightInput]) {
    input.addEventListener('change', () => {
      session.resize(Number(widthInput.value), Number(heightInput.value))
      syncSizeInputs()
      update()
    })
  }

  /**
   * Called after storage has been cleared, so the fresh document is already
   * what is stored: `savedLevel` is moved along with it rather than written, and
   * storage stays empty until the next real edit.
   *
   * The reset goes through `replace`, so it lands on the undo stack like any
   * other edit and Undo brings the level back.
   */
  function reset(): void {
    session.replace(createEmptyLevelDocument())
    savedLevel = encodeStoredLevel(session.current())
    hasStorageFailed = false
    xsbText.value = ''
    syncSizeInputs()
  }

  function handleKey(event: KeyboardEvent): boolean {
    const brush = BRUSH_OF_KEY[event.key]

    if (brush) {
      selectBrush(brush)

      return true
    }

    if (event.key.toLowerCase() === 'z' && session.undo()) {
      syncSizeInputs()
      update()

      return true
    }

    return false
  }

  selectBrush(selectedBrush)
  syncSizeInputs()

  return { update, handleKey, reset }
}
