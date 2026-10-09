import { describe, expect, it } from 'vitest'
import { formatHexColors, parseHexColor, parseHexColors } from './hex'

describe('parseHexColor', () => {
  it('takes hex the way an author types it', () => {
    expect(parseHexColor('#1a1c2c')).toBe('#1a1c2c')
    expect(parseHexColor('1a1c2c')).toBe('#1a1c2c')
    expect(parseHexColor('  #1A1C2C  ')).toBe('#1a1c2c')
  })

  it('expands the shorthand', () => {
    expect(parseHexColor('#fff')).toBe('#ffffff')
    expect(parseHexColor('f0a')).toBe('#ff00aa')
  })

  it('refuses anything that is not a whole colour', () => {
    expect(parseHexColor('')).toBeNull()
    expect(parseHexColor('#1a1c2')).toBeNull()
    expect(parseHexColor('#1a1c2cff')).toBeNull()
    expect(parseHexColor('rebeccapurple')).toBeNull()
  })
})

describe('parseHexColors', () => {
  it('reads the shapes a palette is pasted in', () => {
    expect(parseHexColors('#1a1c2c, #5d275d')).toEqual(['#1a1c2c', '#5d275d'])
    expect(parseHexColors('1a1c2c\n5d275d\n')).toEqual(['#1a1c2c', '#5d275d'])
    expect(parseHexColors('["#1a1c2c","#fff"]')).toEqual(['#1a1c2c', '#ffffff'])
  })

  it('splits colours that run together with no separator', () => {
    expect(parseHexColors('#1a1c2c#5d275d')).toEqual(['#1a1c2c', '#5d275d'])
  })

  it('keeps duplicates and order, because the palette decides about those', () => {
    expect(parseHexColors('#fff #000 #fff')).toEqual([
      '#ffffff',
      '#000000',
      '#ffffff',
    ])
  })

  /**
   * The point of tokenising rather than scanning for hex-looking windows: a
   * format this program does not have is unreadable, not six of its digits.
   */
  it('reads nothing out of a token that is not a colour whole', () => {
    expect(parseHexColors('#1a1c2cff')).toEqual([])
    expect(parseHexColors('rgb(26, 28, 44)')).toEqual([])
  })

  it('round trips through the box it is pasted into', () => {
    const colors = ['#1a1c2c', '#5d275d', '#b13e53']

    expect(parseHexColors(formatHexColors(colors))).toEqual(colors)
  })
})
