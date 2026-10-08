import { parseStringToLevelState } from '../core/level'
import { isSolved } from '../core/rules'
import { createRenderer } from '../render/canvas'
import { createHistory, type Command } from './history'
import { LEVEL } from './level-data'

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

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)

  if (!element) {
    throw new Error(`Expected ${selector} in the document`)
  }

  return element
}

const canvas = requireElement<HTMLCanvasElement>('#board')
const statusLine = requireElement<HTMLElement>('#status')

const render = createRenderer(canvas)
const history = createHistory(parseStringToLevelState(LEVEL))

function update(): void {
  const levelState = history.current()
  render(levelState)
  const moves = history.moveCount()
  statusLine.textContent = isSolved(levelState)
    ? `Solved in ${moves} moves. Press R to play again.`
    : `Moves: ${moves}   ·   arrows/WASD to move, Z to undo, R to reset`
}

window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return
  }

  const command = BINDINGS[event.key] ?? BINDINGS[event.key.toLowerCase()]

  if (!command) {
    return
  }

  event.preventDefault()

  if (history.run(command)) {
    update()
  }
})

window.addEventListener('resize', update)
update()
