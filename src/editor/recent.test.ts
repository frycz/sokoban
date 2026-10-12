import { describe, expect, it } from 'vitest'
import { decodeStoredRecent, encodeStoredRecent, pushRecent } from './recent'

describe('pushRecent', () => {
  it('puts a new item first', () => {
    expect(pushRecent(['#111111'], '#222222')).toEqual(['#222222', '#111111'])
  })

  it('moves an item already in the list to the front instead of repeating it', () => {
    expect(pushRecent([1, 2, 3], 3)).toEqual([3, 1, 2])
  })

  it('returns the same list when the item is already first', () => {
    const list = [1, 2]

    expect(pushRecent(list, 1)).toBe(list)
  })

  it('drops the oldest past the limit', () => {
    expect(pushRecent([1, 2, 3], 4, 3)).toEqual([4, 1, 2])
  })
})

const SHEET = { tileWidth: 16, tileHeight: 16, margin: 1, spacing: 2 }

describe('stored recent', () => {
  it('reads back what it wrote', () => {
    const recent = { colors: ['#112233'], tiles: [4, 0], sheet: SHEET }

    expect(decodeStoredRecent(encodeStoredRecent(recent))).toEqual(recent)
  })

  it('is null for nothing stored or a record that is not one', () => {
    expect(decodeStoredRecent(null)).toBeNull()
    expect(decodeStoredRecent('not json')).toBeNull()
    expect(decodeStoredRecent('{"colors":[]}')).toBeNull()
  })

  it('drops entries that do not read and keeps the rest', () => {
    const text = JSON.stringify({
      colors: ['#112233', 'red', '#112233', 7],
      tiles: [3, -1, 1.5, '2', 3, 5],
      sheet: SHEET,
    })

    expect(decodeStoredRecent(text)).toEqual({
      colors: ['#112233'],
      tiles: [3, 5],
      sheet: SHEET,
    })
  })
})
