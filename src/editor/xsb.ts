import {
  FLOOR_CELL,
  WALL_CELL,
  getCellX,
  getCellY,
  type Cell,
  type EditorDocument,
} from './document'

const BOX_CELL: Cell = { isWall: false, isGoal: false, content: 'box' }
const BOX_ON_GOAL_CELL: Cell = { isWall: false, isGoal: true, content: 'box' }
const GOAL_CELL: Cell = { isWall: false, isGoal: true, content: 'empty' }
const PLAYER_CELL: Cell = { isWall: false, isGoal: false, content: 'player' }

const PLAYER_ON_GOAL_CELL: Cell = {
  isWall: false,
  isGoal: true,
  content: 'player',
}

const CELL_OF_CHARACTER: Record<string, Cell | undefined> = {
  '#': WALL_CELL,
  ' ': FLOOR_CELL,
  '-': FLOOR_CELL,
  _: FLOOR_CELL,
  $: BOX_CELL,
  '*': BOX_ON_GOAL_CELL,
  '.': GOAL_CELL,
  '@': PLAYER_CELL,
  '+': PLAYER_ON_GOAL_CELL,
}

/**
 * Parses XSB without judging it. The game's `parseStringToLevelState` rejects a
 * level with no player or mismatched counts, which is exactly the level someone
 * is in the middle of editing, so this accepts anything spelled with the XSB
 * alphabet and leaves the verdict to `validateDocument`.
 *
 * Real level text is ragged, and a short line means "outside the puzzle", so
 * the missing columns become wall rather than floor.
 */
export function parseXsbToDocument(text: string): EditorDocument {
  const lines = trimBlankEdges(text.replace(/\r\n?/g, '\n').split('\n'))

  if (lines.length === 0) {
    throw new Error('Nothing to load — the text is empty')
  }

  const height = lines.length
  const width = Math.max(...lines.map((line) => line.length))

  if (width === 0) {
    throw new Error('Nothing to load — every line is empty')
  }

  const cells = new Array<Cell>(width * height).fill(WALL_CELL)

  for (let y = 0; y < height; y++) {
    const line = lines[y]

    for (let x = 0; x < line.length; x++) {
      const character = line[x]
      const cell = CELL_OF_CHARACTER[character]

      if (!cell) {
        throw new Error(
          `Unexpected character ${JSON.stringify(character)} at line ${y + 1}, column ${x + 1}`,
        )
      }

      cells[y * width + x] = cell
    }
  }

  return { width, height, cells }
}

export function formatDocumentAsXsb(editorDocument: EditorDocument): string {
  const lines: string[] = []

  for (let y = 0; y < editorDocument.height; y++) {
    let line = ''

    for (let x = 0; x < editorDocument.width; x++) {
      line += characterOfCell(
        editorDocument.cells[y * editorDocument.width + x],
      )
    }

    lines.push(line)
  }

  return lines.join('\n')
}

export function describePosition(
  editorDocument: EditorDocument,
  position: number,
): string {
  return `(${getCellX(editorDocument, position)}, ${getCellY(editorDocument, position)})`
}

function characterOfCell(cell: Cell): string {
  if (cell.isWall) {
    return '#'
  }

  switch (cell.content) {
    case 'box':
      return cell.isGoal ? '*' : '$'
    case 'player':
      return cell.isGoal ? '+' : '@'
    case 'empty':
      return cell.isGoal ? '.' : ' '
  }
}

function trimBlankEdges(lines: readonly string[]): string[] {
  const trimmed = [...lines]

  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === '') {
    trimmed.pop()
  }

  while (trimmed.length > 0 && trimmed[0].trim() === '') {
    trimmed.shift()
  }

  return trimmed
}
