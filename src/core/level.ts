import type { Level, State } from './types'

export type ParsedLevel = { level: Level; initial: State }

/**
 * Parses one level in XSB notation:
 *
 *   #  wall        $  box          .  goal
 *   @  player      *  box on goal  +  player on goal
 *
 * Space is floor. `-` and `_` are accepted as floor too, since some level
 * sets use them to keep leading whitespace from being stripped.
 */
export function parse(text: string): ParsedLevel {
  const lines = trimBlankEdges(text.replace(/\r\n?/g, '\n').split('\n'))
  if (lines.length === 0) throw new Error('Level is empty')

  const height = lines.length
  const width = Math.max(...lines.map((line) => line.length))
  const size = width * height

  // "open" means the character is not a wall. Which of those cells are actually
  // playable is decided by the flood fill below.
  const open = new Array<boolean>(size).fill(false)
  const goals = new Set<number>()
  const boxes = new Set<number>()
  let player = -1

  for (let y = 0; y < height; y++) {
    const line = lines[y]
    for (let x = 0; x < width; x++) {
      const char = x < line.length ? line[x] : ' '
      const i = y * width + x
      switch (char) {
        case '#':
          break
        case ' ':
        case '-':
        case '_':
          open[i] = true
          break
        case '$':
          open[i] = true
          boxes.add(i)
          break
        case '*':
          open[i] = true
          boxes.add(i)
          goals.add(i)
          break
        case '.':
          open[i] = true
          goals.add(i)
          break
        case '@':
          open[i] = true
          player = i
          break
        case '+':
          open[i] = true
          goals.add(i)
          player = i
          break
        default:
          throw new Error(
            `Unexpected character ${JSON.stringify(char)} at line ${y + 1}, column ${x + 1}`
          )
      }
    }
  }

  if (player < 0) throw new Error('Level has no player (@ or +)')
  if (boxes.size === 0) throw new Error('Level has no boxes')
  if (boxes.size !== goals.size) {
    throw new Error(`Level has ${boxes.size} boxes but ${goals.size} goals`)
  }

  const interior = reachableFrom(open, width, height, player)
  for (const box of boxes) {
    if (!interior[box]) throw new Error(`Box at ${describe(width, box)} is outside the walls`)
  }
  for (const goal of goals) {
    if (!interior[goal]) throw new Error(`Goal at ${describe(width, goal)} is outside the walls`)
  }

  // Anything the player cannot reach is a wall. That makes the playfield
  // self-enclosing, so levels whose text has no outer border still behave.
  const walls = interior.map((reached) => !reached)

  const level: Level = { width, height, walls, goals }
  return { level, initial: { level, player, boxes } }
}

/** Flood fill across open cells, four-connected, without wrapping rows. */
function reachableFrom(
  open: readonly boolean[],
  width: number,
  height: number,
  from: number
): boolean[] {
  const reached = new Array<boolean>(width * height).fill(false)
  reached[from] = true
  const stack = [from]

  while (stack.length > 0) {
    const i = stack.pop()!
    const x = i % width
    const y = (i - x) / width

    if (y > 0) visit(i - width)
    if (y < height - 1) visit(i + width)
    if (x > 0) visit(i - 1)
    if (x < width - 1) visit(i + 1)

    function visit(n: number) {
      if (reached[n] || !open[n]) return
      reached[n] = true
      stack.push(n)
    }
  }

  return reached
}

function trimBlankEdges(lines: string[]): string[] {
  const out = [...lines]
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
  while (out.length > 0 && out[0].trim() === '') out.shift()
  return out
}

function describe(width: number, i: number): string {
  return `(${i % width}, ${Math.floor(i / width)})`
}
