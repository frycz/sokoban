import { parseStringToLevelState } from '../core/level'
import { isSolved } from '../core/rules'
import { step } from '../core/step'
import type { LevelState, PlayerMoveDirection } from '../core/types'
import { createRenderer } from '../render/canvas'
import { LEVEL } from './level-data'

type Command =
  | { type: 'move'; playerMoveDirection: PlayerMoveDirection }
  | { type: 'undo' }
  | { type: 'reset' }

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
const initial = parseStringToLevelState(LEVEL)

const history: LevelState[] = [initial]
const current = () => history[history.length - 1]

function run(command: Command): void {
  switch (command.type) {
    case 'move': {
      const next = step(current(), command.playerMoveDirection)

      if (next === current()) {
        return
      }

      history.push(next)
      break
    }
    case 'undo': {
      if (history.length === 1) {
        return
      }

      history.pop()
      break
    }
    case 'reset': {
      if (history.length === 1) {
        return
      }

      history.length = 1
      break
    }
  }

  update()
}

function update(): void {
  const levelState = current()
  render(levelState)
  const moves = history.length - 1
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
  run(command)
})

window.addEventListener('resize', update)
update()
