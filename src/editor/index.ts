import { createEditorRenderer } from './canvas'
import {
  createEmptyDocument,
  MAX_DOCUMENT_SIZE,
  MIN_DOCUMENT_SIZE,
  type Brush,
} from './document'
import { computeGridLayout, getPositionAtPixel } from './layout'
import { createSession } from './session'
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

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)

  if (!element) {
    throw new Error(`Expected ${selector} in the document`)
  }

  return element
}

const canvas = requireElement<HTMLCanvasElement>('#grid')
const palette = requireElement<HTMLElement>('#palette')
const widthInput = requireElement<HTMLInputElement>('#width')
const heightInput = requireElement<HTMLInputElement>('#height')
const newButton = requireElement<HTMLButtonElement>('#new')
const undoButton = requireElement<HTMLButtonElement>('#undo')
const loadButton = requireElement<HTMLButtonElement>('#load')
const exportButton = requireElement<HTMLButtonElement>('#export')
const xsbText = requireElement<HTMLTextAreaElement>('#xsb')
const report = requireElement<HTMLElement>('#report')

const render = createEditorRenderer(canvas)
const session = createSession(
  createEmptyDocument(DEFAULT_WIDTH, DEFAULT_HEIGHT),
)

let selectedBrush: Brush = 'floor'
let hoverPosition = -1
let isPainting = false

for (const input of [widthInput, heightInput]) {
  input.min = String(MIN_DOCUMENT_SIZE)
  input.max = String(MAX_DOCUMENT_SIZE)
}

function syncSizeInputs(): void {
  widthInput.value = String(session.current().width)
  heightInput.value = String(session.current().height)
}

function update(): void {
  const editorDocument = session.current()
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

  for (const button of palette.querySelectorAll('button[data-brush]')) {
    button.setAttribute(
      'aria-pressed',
      String(button.getAttribute('data-brush') === brush),
    )
  }
}

function showMessage(message: string): void {
  report.replaceChildren()
  const line = document.createElement('p')
  line.className = 'error'
  line.textContent = message
  report.append(line)
}

palette.addEventListener('click', (event) => {
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

window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return
  }

  const target = event.target as Element | null

  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
    return
  }

  const brush = BRUSH_OF_KEY[event.key]

  if (brush) {
    event.preventDefault()
    selectBrush(brush)

    return
  }

  if (event.key.toLowerCase() === 'z' && session.undo()) {
    event.preventDefault()
    syncSizeInputs()
    update()
  }
})

window.addEventListener('resize', update)

selectBrush(selectedBrush)
syncSizeInputs()
update()
