import { parse } from '../core/level'
import { isSolved } from '../core/rules'
import { step } from '../core/step'
import type { Direction, State } from '../core/types'
import { createRenderer } from '../render/canvas'
import { LEVEL } from './level-data'

/** The host has three commands, so the tag belongs here rather than in core. */
type Command = { type: 'move'; direction: Direction } | { type: 'undo' } | { type: 'reset' }

const BINDINGS: Record<string, Command> = {
  ArrowUp: { type: 'move', direction: 'up' },
  ArrowDown: { type: 'move', direction: 'down' },
  ArrowLeft: { type: 'move', direction: 'left' },
  ArrowRight: { type: 'move', direction: 'right' },
  w: { type: 'move', direction: 'up' },
  s: { type: 'move', direction: 'down' },
  a: { type: 'move', direction: 'left' },
  d: { type: 'move', direction: 'right' },
  z: { type: 'undo' },
  u: { type: 'undo' },
  r: { type: 'reset' },
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Expected ${selector} in the document`)
  return element
}

const canvas = requireElement<HTMLCanvasElement>('#board')
const statusLine = requireElement<HTMLElement>('#status')

const render = createRenderer(canvas)
const { initial } = parse(LEVEL)

// The one piece of mutable state in the program. Undo and reset are history
// operations, which is why the engine does not know about them.
const history: State[] = [initial]
const current = () => history[history.length - 1]

function run(command: Command): void {
  switch (command.type) {
    case 'move': {
      const next = step(current(), command.direction)
      if (next === current()) return // illegal move, nothing to record
      history.push(next)
      break
    }
    case 'undo': {
      if (history.length === 1) return
      history.pop()
      break
    }
    case 'reset': {
      if (history.length === 1) return
      history.length = 1
      break
    }
  }
  update()
}

function update(): void {
  const state = current()
  render(state)
  const moves = history.length - 1
  statusLine.textContent = isSolved(state)
    ? `Solved in ${moves} moves. Press R to play again.`
    : `Moves: ${moves}   ·   arrows/WASD to move, Z to undo, R to reset`
}

window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const command = BINDINGS[event.key] ?? BINDINGS[event.key.toLowerCase()]
  if (!command) return
  event.preventDefault()
  run(command)
})

window.addEventListener('resize', update)
update()
