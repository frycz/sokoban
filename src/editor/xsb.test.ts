import { describe, expect, it } from 'vitest'
import { parseStringToLevelState } from '../core/level'
import { toXsb, xsb } from '../core/test-helpers'
import { formatDocumentAsXsb, parseXsbToDocument } from './xsb'

const LEVEL = xsb(
  '#######',
  '#.@ # #',
  '#$* $ #',
  '#   $ #',
  '# ..  #',
  '#  *  #',
  '#######',
)

describe('parseXsbToDocument', () => {
  it('round-trips a level unchanged', () => {
    expect(formatDocumentAsXsb(parseXsbToDocument(LEVEL))).toBe(LEVEL)
  })

  it('agrees with the game parser on a playable level', () => {
    expect(formatDocumentAsXsb(parseXsbToDocument(LEVEL))).toBe(
      toXsb(parseStringToLevelState(LEVEL)),
    )
  })

  it('accepts a level the game parser rejects, because it is half drawn', () => {
    expect(() => parseStringToLevelState(xsb('###', '# #', '###'))).toThrow()
    expect(
      formatDocumentAsXsb(parseXsbToDocument(xsb('###', '# #', '###'))),
    ).toBe(xsb('###', '# #', '###'))
  })

  it('pads a short line with wall, not floor', () => {
    expect(formatDocumentAsXsb(parseXsbToDocument(xsb('#####', '#@#')))).toBe(
      xsb('#####', '#@###'),
    )
  })

  it('reads - and _ as floor', () => {
    expect(
      formatDocumentAsXsb(parseXsbToDocument(xsb('###', '#-#', '#_#'))),
    ).toBe(xsb('###', '# #', '# #'))
  })

  it('trims blank lines around the level', () => {
    expect(
      formatDocumentAsXsb(parseXsbToDocument(`\n\n###\n#@#\n###\n\n`)),
    ).toBe(xsb('###', '#@#', '###'))
  })

  it('rejects an unknown character with its location', () => {
    expect(() => parseXsbToDocument(xsb('###', '#x#', '###'))).toThrow(
      /line 2, column 2/,
    )
  })

  it('rejects empty text', () => {
    expect(() => parseXsbToDocument('   \n  \n')).toThrow(/Nothing to load/)
  })
})
