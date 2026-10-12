import { describe, expect, it } from 'vitest'
import { pushRecent } from './recent'

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
