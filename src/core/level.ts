import type { Level, LevelState } from './types'

export type ParsedLevel = { level: Level; initial: LevelState }

export function parse(text: string): ParsedLevel {
  const lines = trimBlankEdges(text.replace(/\r\n?/g, '\n').split('\n'))
  if (lines.length === 0) throw new Error('Level is empty')

  const height = lines.length
  const width = Math.max(...lines.map((line) => line.length))
  const cellCount = width * height

  const open = new Array<boolean>(cellCount).fill(false)
  const goalPositions = new Set<number>()
  const boxPositions = new Set<number>()
  let playerCurrentPosition = -1

  for (let y = 0; y < height; y++) {
    const line = lines[y]
    for (let x = 0; x < width; x++) {
      const character = x < line.length ? line[x] : ' '
      const index = y * width + x
      switch (character) {
        case '#':
          break
        case ' ':
        case '-':
        case '_':
          open[index] = true
          break
        case '$':
          open[index] = true
          boxPositions.add(index)
          break
        case '*':
          open[index] = true
          boxPositions.add(index)
          goalPositions.add(index)
          break
        case '.':
          open[index] = true
          goalPositions.add(index)
          break
        case '@':
          open[index] = true
          playerCurrentPosition = index
          break
        case '+':
          open[index] = true
          goalPositions.add(index)
          playerCurrentPosition = index
          break
        default:
          throw new Error(
            `Unexpected character ${JSON.stringify(character)} at line ${y + 1}, column ${x + 1}`,
          )
      }
    }
  }

  if (playerCurrentPosition < 0) throw new Error('Level has no player (@ or +)')
  if (boxPositions.size === 0) throw new Error('Level has no boxes')
  if (boxPositions.size !== goalPositions.size) {
    throw new Error(`Level has ${boxPositions.size} boxes but ${goalPositions.size} goals`)
  }

  const interior = reachableFrom(open, width, height, playerCurrentPosition)
  for (const box of boxPositions) {
    if (!interior[box]) throw new Error(`Box at ${describe(width, box)} is outside the walls`)
  }
  for (const goal of goalPositions) {
    if (!interior[goal]) throw new Error(`Goal at ${describe(width, goal)} is outside the walls`)
  }

  const wallMap = interior.map((reached) => !reached)

  const level: Level = { width, height, wallMap, goalPositions }
  return { level, initial: { level, playerCurrentPosition, boxPositions } }
}

function reachableFrom(
  open: readonly boolean[],
  width: number,
  height: number,
  start: number,
): boolean[] {
  const reached = new Array<boolean>(width * height).fill(false)
  reached[start] = true
  const pending = [start]

  const visit = (neighbourPosition: number) => {
    if (reached[neighbourPosition] || !open[neighbourPosition]) return
    reached[neighbourPosition] = true
    pending.push(neighbourPosition)
  }

  while (pending.length > 0) {
    const position = pending.pop()!
    const x = position % width
    const y = (position - x) / width

    if (y > 0) visit(position - width)
    if (y < height - 1) visit(position + width)
    if (x > 0) visit(position - 1)
    if (x < width - 1) visit(position + 1)
  }

  return reached
}

function trimBlankEdges(lines: string[]): string[] {
  const trimmed = [...lines]
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === '') trimmed.pop()
  while (trimmed.length > 0 && trimmed[0].trim() === '') trimmed.shift()
  return trimmed
}

function describe(width: number, position: number): string {
  return `(${position % width}, ${Math.floor(position / width)})`
}
