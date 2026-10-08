import { getPositionsReachableFrom } from '../core/level'
import {
  countCells,
  getCellX,
  getCellY,
  type Cell,
  type EditorDocument,
} from './document'
import { describePosition } from './xsb'

/**
 * `error` means the game's parser will refuse the level, so it is not playable.
 * `warning` means it loads but is probably not what was intended.
 */
type Problem = {
  readonly severity: 'error' | 'warning'
  readonly message: string
}

export type Validation = {
  readonly problems: readonly Problem[]
  readonly boxCount: number
  readonly goalCount: number
  /** No errors, so `parseStringToLevelState` will accept the exported text. */
  readonly isPlayable: boolean
}

/**
 * The gate between the editor and the game. The checks here are the parser's
 * rejections restated as a list, so an empty error list is a promise that the
 * XSB this document exports will load.
 */
export function validateDocument(editorDocument: EditorDocument): Validation {
  const problems: Problem[] = []

  const boxCount = countCells(editorDocument, (cell) => cell.content === 'box')
  const goalCount = countCells(editorDocument, (cell) => cell.isGoal)
  const playerPositions = findPositions(
    editorDocument,
    (cell) => cell.content === 'player',
  )

  if (playerPositions.length === 0) {
    problems.push({
      severity: 'error',
      message: 'No player. Paint one with the player brush.',
    })
  }

  // Painting keeps the player unique, so this only fires on loaded text.
  if (playerPositions.length > 1) {
    problems.push({
      severity: 'error',
      message: `${playerPositions.length} players. A level has exactly one.`,
    })
  }

  if (boxCount === 0) {
    problems.push({ severity: 'error', message: 'No boxes.' })
  }

  if (boxCount !== goalCount) {
    problems.push({
      severity: 'error',
      message: `${boxCount} ${boxCount === 1 ? 'box' : 'boxes'} but ${goalCount} ${goalCount === 1 ? 'goal' : 'goals'}.`,
    })
  }

  problems.push(...findUnreachable(editorDocument, playerPositions))
  problems.push(...findUnsealedEdges(editorDocument))

  return {
    problems,
    boxCount,
    goalCount,
    isPlayable: !problems.some((problem) => problem.severity === 'error'),
  }
}

/**
 * A box or goal walled off from the player makes the level unwinnable, and the
 * parser's flood fill treats it as being outside the level entirely.
 */
function findUnreachable(
  editorDocument: EditorDocument,
  playerPositions: readonly number[],
): Problem[] {
  if (playerPositions.length !== 1) {
    return []
  }

  const open = editorDocument.cells.map((cell) => !cell.isWall)
  const reached = getPositionsReachableFrom(
    open,
    editorDocument.width,
    editorDocument.height,
    playerPositions[0],
  )

  const problems: Problem[] = []

  for (let position = 0; position < editorDocument.cells.length; position++) {
    if (reached[position]) {
      continue
    }

    const cell = editorDocument.cells[position]
    const name = cell.content === 'box' ? 'box' : cell.isGoal ? 'goal' : null

    if (!name) {
      continue
    }

    problems.push({
      severity: 'error',
      message: `A ${name} at ${describePosition(editorDocument, position)} is walled off from the player.`,
    })
  }

  return problems
}

/**
 * Floor on the outermost row or column plays fine but has no wall to draw
 * against, so the board renders with an open edge.
 */
function findUnsealedEdges(editorDocument: EditorDocument): Problem[] {
  const openEdges = findPositions(
    editorDocument,
    (cell) => !cell.isWall,
  ).filter((position) => {
    const x = getCellX(editorDocument, position)
    const y = getCellY(editorDocument, position)

    return (
      x === 0 ||
      y === 0 ||
      x === editorDocument.width - 1 ||
      y === editorDocument.height - 1
    )
  })

  if (openEdges.length === 0) {
    return []
  }

  return [
    {
      severity: 'warning',
      message: `Floor touches the outer edge at ${describePosition(editorDocument, openEdges[0])}${openEdges.length > 1 ? ` and ${openEdges.length - 1} more` : ''}. The level has no border there.`,
    },
  ]
}

function findPositions(
  editorDocument: EditorDocument,
  predicate: (cell: Cell) => boolean,
): number[] {
  const positions: number[] = []

  for (let position = 0; position < editorDocument.cells.length; position++) {
    if (predicate(editorDocument.cells[position])) {
      positions.push(position)
    }
  }

  return positions
}
