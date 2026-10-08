import { describe, expect, it } from 'vitest'
import { xsb } from '../../core/test-helpers'
import { parseXsbToDocument } from '../xsb'
import { getTopRoleAtCell } from './roles'

const LEVEL = xsb('#####', '#@$.#', '#+* #', '#####')

const roleAt = (x: number, y: number) => {
  const editorDocument = parseXsbToDocument(LEVEL)

  return getTopRoleAtCell(editorDocument.cells[y * editorDocument.width + x])
}

describe('getTopRoleAtCell', () => {
  it('reads the topmost thing drawn, which is what a click means', () => {
    expect(roleAt(0, 0)).toBe('wall')
    expect(roleAt(1, 1)).toBe('player')
    expect(roleAt(2, 1)).toBe('box')
    expect(roleAt(3, 1)).toBe('goal')
    expect(roleAt(3, 2)).toBe('floor')
  })

  it('distinguishes a box on a goal, the one "done" signal on the board', () => {
    expect(roleAt(2, 2)).toBe('boxOnGoal')
  })

  it('reports a player on a goal as the player, since the goal is under it', () => {
    expect(roleAt(1, 2)).toBe('player')
  })
})
