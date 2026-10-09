import { describe, expect, it } from 'vitest'
import { xsb } from '../core/test-helpers'
import { createEmptyDocument } from './document'
import { createSession } from './session'
import { formatDocumentAsXsb, parseXsbToDocument } from './xsb'

const positionOf = (width: number, x: number, y: number) => y * width + x

describe('createSession', () => {
  it('starts with nothing to undo', () => {
    const session = createSession(createEmptyDocument(3, 3))

    expect(session.canUndo()).toBe(false)
    expect(session.undo()).toBe(false)
  })

  it('folds one stroke into a single undo entry', () => {
    const session = createSession(createEmptyDocument(4, 3))

    session.beginStroke()
    session.paint(positionOf(4, 1, 1), 'floor')
    session.paint(positionOf(4, 2, 1), 'floor')

    expect(formatDocumentAsXsb(session.current())).toBe(
      xsb('####', '#  #', '####'),
    )

    session.undo()

    expect(formatDocumentAsXsb(session.current())).toBe(
      xsb('####', '####', '####'),
    )
  })

  it('keeps separate strokes separately undoable', () => {
    const session = createSession(createEmptyDocument(4, 3))

    session.beginStroke()
    session.paint(positionOf(4, 1, 1), 'floor')
    session.beginStroke()
    session.paint(positionOf(4, 2, 1), 'floor')
    session.undo()

    expect(formatDocumentAsXsb(session.current())).toBe(
      xsb('####', '# ##', '####'),
    )
  })

  it('records nothing for a stroke that changed nothing', () => {
    const session = createSession(parseXsbToDocument(xsb('###', '# #', '###')))

    session.beginStroke()

    expect(session.paint(positionOf(3, 1, 1), 'floor')).toBe(false)
    expect(session.canUndo()).toBe(false)
  })

  it('undoes a resize', () => {
    const session = createSession(createEmptyDocument(3, 3))

    expect(session.resize(5, 5)).toBe(true)
    expect(session.current().width).toBe(5)

    session.undo()

    expect(session.current().width).toBe(3)
  })

  it('undoes a load back to the previous document', () => {
    const session = createSession(createEmptyDocument(3, 3))

    session.replace(parseXsbToDocument(xsb('#####', '#@$.#', '#####')))

    expect(session.current().width).toBe(5)

    session.undo()

    expect(formatDocumentAsXsb(session.current())).toBe(
      xsb('###', '###', '###'),
    )
  })

  /**
   * One visit to the colour picker is one undo entry: the input fires for every
   * shade dragged through, and undoing back through each of them would be
   * unusable.
   */
  it('folds a drag through the ground colours into a single undo entry', () => {
    const session = createSession(createEmptyDocument(3, 3))

    session.beginStroke()

    expect(session.setGroundColor('#112233')).toBe(true)
    expect(session.setGroundColor('#223344')).toBe(true)
    expect(session.setGroundColor('#223344')).toBe(false)
    expect(session.current().groundColor).toBe('#223344')

    session.undo()

    expect(session.current().groundColor).toBeNull()
    expect(session.canUndo()).toBe(false)
  })

  it('does not fold a paint into a stroke that undo has already closed', () => {
    const session = createSession(createEmptyDocument(4, 3))

    session.beginStroke()
    session.paint(positionOf(4, 1, 1), 'floor')
    session.undo()
    session.paint(positionOf(4, 2, 1), 'floor')

    expect(session.canUndo()).toBe(true)

    session.undo()

    expect(formatDocumentAsXsb(session.current())).toBe(
      xsb('####', '####', '####'),
    )
  })
})
