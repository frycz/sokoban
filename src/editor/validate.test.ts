import { describe, expect, it } from 'vitest'
import { parseStringToLevelState } from '../core/level'
import { xsb } from '../core/test-helpers'
import { createEmptyDocument } from './document'
import { validateDocument } from './validate'
import { formatDocumentAsXsb, parseXsbToDocument } from './xsb'

const validate = (...lines: string[]) =>
  validateDocument(parseXsbToDocument(xsb(...lines)))

const messagesOf = (...lines: string[]) =>
  validate(...lines).problems.map((problem) => problem.message)

describe('validateDocument', () => {
  it('passes a playable level with nothing to report', () => {
    const validation = validate('#####', '#@$.#', '#####')

    expect(validation.problems).toEqual([])
    expect(validation.isPlayable).toBe(true)
    expect(validation.boxCount).toBe(1)
    expect(validation.goalCount).toBe(1)
  })

  it('reports a missing player', () => {
    expect(messagesOf('#####', '# $.#', '#####')).toContain(
      'No player. Paint one with the player brush.',
    )
  })

  it('reports more than one player', () => {
    expect(messagesOf('######', '#@@$.#', '######')).toContain(
      '2 players. A level has exactly one.',
    )
  })

  it('reports an empty document as having no boxes', () => {
    const validation = validateDocument(createEmptyDocument(4, 4))

    expect(validation.problems.map((problem) => problem.message)).toContain(
      'No boxes.',
    )
    expect(validation.isPlayable).toBe(false)
  })

  it('counts boxes against goals in the message', () => {
    expect(messagesOf('######', '#@$$.#', '######')).toContain(
      '2 boxes but 1 goal.',
    )
  })

  it('reports a box walled off from the player', () => {
    expect(messagesOf('######', '#@.#$#', '######')).toContain(
      'A box at (4, 1) is walled off from the player.',
    )
  })

  it('warns, but stays playable, when floor touches the outer edge', () => {
    const validation = validate('@$.')

    expect(validation.isPlayable).toBe(true)
    expect(validation.problems).toHaveLength(1)
    expect(validation.problems[0].severity).toBe('warning')
    expect(validation.problems[0].message).toMatch(/no border/)
  })

  it('is the gate it claims to be: no errors means the game loads it', () => {
    const level = xsb(
      '#######',
      '#.@ # #',
      '#$* $ #',
      '#   $ #',
      '# ..  #',
      '#  *  #',
      '#######',
    )
    const editorDocument = parseXsbToDocument(level)

    expect(validateDocument(editorDocument).isPlayable).toBe(true)
    expect(() =>
      parseStringToLevelState(formatDocumentAsXsb(editorDocument)),
    ).not.toThrow()
  })

  it('and the converse: an error means the game refuses it', () => {
    const editorDocument = parseXsbToDocument(xsb('#####', '#@$ #', '#####'))

    expect(validateDocument(editorDocument).isPlayable).toBe(false)
    expect(() =>
      parseStringToLevelState(formatDocumentAsXsb(editorDocument)),
    ).toThrow()
  })
})
