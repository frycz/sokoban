import { describe, expect, it } from 'vitest'
import { xsb } from '../core/test-helpers'
import { createEmptyDocument } from './document'
import { createSession, UNDO_LIMIT } from './session'
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

  it(`reaches back ${UNDO_LIMIT} edits and no further`, () => {
    const session = createSession(createEmptyDocument(3, 3))

    for (let width = 4; width < 4 + UNDO_LIMIT + 5; width++) {
      session.beginStroke()
      session.resize(width, 3)
    }

    let undone = 0

    while (session.undo()) {
      undone += 1
    }

    expect(undone).toBe(UNDO_LIMIT)
  })

  it('undoes an edit to a tracked slice and writes it back', () => {
    const session = createSession(createEmptyDocument(3, 3))
    let value = { name: 'a' }
    session.track({
      read: () => value,
      write: (restored) => {
        value = restored
      },
    })
    const original = value

    session.beginStroke()
    value = { name: 'b' }

    expect(session.record()).toBe(true)
    expect(session.record()).toBe(false)

    session.undo()

    expect(value).toBe(original)
    expect(session.canUndo()).toBe(false)
  })

  it('folds slice edits made in one stroke into one entry', () => {
    const session = createSession(createEmptyDocument(3, 3))
    let value = 0
    session.track({
      read: () => value,
      write: (restored) => {
        value = restored
      },
    })

    session.beginStroke()
    value = 1
    session.record()
    value = 2
    session.record()
    session.undo()

    expect(value).toBe(0)
    expect(session.canUndo()).toBe(false)
  })

  it('undoes a document edit and a slice edit from one gesture together', () => {
    const session = createSession(createEmptyDocument(3, 3))
    let value = 0
    session.track({
      read: () => value,
      write: (restored) => {
        value = restored
      },
    })

    session.beginStroke()
    value = 1
    session.resize(5, 5)
    value = 2
    session.record()
    session.undo()

    expect(value).toBe(0)
    expect(session.current().width).toBe(3)
    expect(session.canUndo()).toBe(false)
  })
})
