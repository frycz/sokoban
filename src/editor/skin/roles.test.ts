import { describe, expect, it } from 'vitest'
import { xsb } from '../../core/test-helpers'
import { parseXsbToDocument } from '../xsb'
import { getTopRoleAtPosition, getWallRoleAt } from './roles'

const LEVEL = xsb('#####', '#@$.#', '#+* #', '#####')

const roleAt = (level: string, x: number, y: number) => {
  const editorDocument = parseXsbToDocument(level)

  return getTopRoleAtPosition(editorDocument, y * editorDocument.width + x)
}

describe('getTopRoleAtPosition', () => {
  it('reads the topmost thing drawn, which is what a click means', () => {
    expect(roleAt(LEVEL, 1, 1)).toBe('player')
    expect(roleAt(LEVEL, 2, 1)).toBe('box')
    expect(roleAt(LEVEL, 3, 1)).toBe('goal')
    expect(roleAt(LEVEL, 3, 2)).toBe('floor')
  })

  it('distinguishes a box on a goal, the one "done" signal on the board', () => {
    expect(roleAt(LEVEL, 2, 2)).toBe('boxOnGoal')
  })

  it('reports a player on a goal as the player, since the goal is under it', () => {
    expect(roleAt(LEVEL, 1, 2)).toBe('player')
  })

  it('resolves a wall to its piece, so clicking a corner binds the corner', () => {
    expect(roleAt(LEVEL, 0, 0)).toBe('wallTopLeft')
    expect(roleAt(LEVEL, 4, 3)).toBe('wallBottomRight')
  })
})

describe('getWallRoleAt', () => {
  // A room with a one-cell-thick border, which is the shape every one of these
  // pieces exists for.
  const ROOM = xsb('#####', '#   #', '#   #', '#####')
  const wallAt = (x: number, y: number) => {
    const editorDocument = parseXsbToDocument(ROOM)

    return getWallRoleAt(editorDocument, y * editorDocument.width + x)
  }

  it('reads the four corners of the border', () => {
    // These also prove off-grid counts as wall. If the edge of the document
    // read as open, (0,0) would have two open sides and degrade to an edge
    // piece instead of resolving as a corner.
    expect(wallAt(0, 0)).toBe('wallTopLeft')
    expect(wallAt(4, 0)).toBe('wallTopRight')
    expect(wallAt(0, 3)).toBe('wallBottomLeft')
    expect(wallAt(4, 3)).toBe('wallBottomRight')
  })

  it('reads the four sides the way round a player would expect', () => {
    expect(wallAt(2, 0)).toBe('wallTop')
    expect(wallAt(2, 3)).toBe('wallBottom')
    expect(wallAt(0, 1)).toBe('wallLeft')
    expect(wallAt(4, 1)).toBe('wallRight')
  })

  it('is the fill for a wall buried in other walls', () => {
    const editorDocument = parseXsbToDocument(
      xsb('#####', '#####', '## ##', '#####'),
    )

    expect(getWallRoleAt(editorDocument, 1)).toBe('wall')
  })

  it('pieces a thicker border by its inner face', () => {
    // Two rings of wall: the outer ring is buried, the inner ring frames the
    // floor, so only the inner ring takes edge and corner pieces.
    const editorDocument = parseXsbToDocument(
      xsb('#######', '#######', '##   ##', '##   ##', '#######', '#######'),
    )
    const pieceAt = (x: number, y: number) =>
      getWallRoleAt(editorDocument, y * 7 + x)

    expect(pieceAt(1, 1)).toBe('wallTopLeft')
    expect(pieceAt(3, 1)).toBe('wallTop')
    expect(pieceAt(0, 0)).toBe('wall')
    expect(pieceAt(3, 0)).toBe('wall')
  })
})
