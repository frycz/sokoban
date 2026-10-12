import { describe, expect, it } from 'vitest'
import { createSaveId, readSave } from './saves'

const valid = {
  id: 'save-1',
  name: 'castle',
  savedAt: 1700000000000,
  level: '{"version":1}',
  skin: '{"version":1}',
  publish: { name: 'Castle', slug: 'castle' },
}

describe('readSave', () => {
  it('reads a save back as it was written', () => {
    expect(readSave(valid)).toEqual(valid)
  })

  it('drops a record without its level or skin', () => {
    expect(readSave({ ...valid, level: undefined })).toBeNull()
    expect(readSave({ ...valid, skin: 3 })).toBeNull()
    expect(readSave({ ...valid, id: '' })).toBeNull()
    expect(readSave(null)).toBeNull()
  })

  it('fills in what a hand-edited record is missing', () => {
    expect(
      readSave({ id: 'x', level: 'l', skin: 's', publish: { slug: 4 } }),
    ).toEqual({
      id: 'x',
      name: 'x',
      savedAt: 0,
      level: 'l',
      skin: 's',
      publish: { name: '', slug: null },
    })
  })
})

describe('createSaveId', () => {
  it('does not repeat', () => {
    expect(createSaveId()).not.toBe(createSaveId())
  })
})
