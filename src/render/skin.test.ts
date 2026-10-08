import { describe, expect, it } from 'vitest'
import { createSkin, getSkinTileRect, parseSkinManifest } from './skin'

/**
 * The only thing a skin reads off the atlas is its size, so a stand-in with
 * two fields is the whole image as far as these tests are concerned.
 */
const atlas = (width: number, height: number) =>
  ({ naturalWidth: width, naturalHeight: height }) as HTMLImageElement

/** What the editor writes for a six-tile skin cut at 16 px. */
const sixTileManifest = {
  name: 'quarry',
  tileWidth: 16,
  tileHeight: 16,
  margin: 1,
  spacing: 2,
  pixelated: true,
  roles: ['floor', 'goal', 'wall', 'box', 'boxOnGoal', 'player'],
}

function createSixTileSkin() {
  const manifest = parseSkinManifest(sixTileManifest)

  if (!manifest) {
    throw new Error('The fixture manifest should parse')
  }

  return createSkin(manifest, atlas(108, 18))
}

describe('parseSkinManifest', () => {
  it('regroups the four slicing numbers into sheet settings', () => {
    expect(parseSkinManifest(sixTileManifest)?.sheet).toEqual({
      tileWidth: 16,
      tileHeight: 16,
      margin: 1,
      spacing: 2,
    })
  })

  it('refuses anything that is not a manifest', () => {
    expect(parseSkinManifest(null)).toBeNull()
    expect(parseSkinManifest('skin')).toBeNull()
    expect(parseSkinManifest({ ...sixTileManifest, roles: [] })).toBeNull()
    expect(parseSkinManifest({ ...sixTileManifest, roles: [1, 2] })).toBeNull()
  })

  it('defaults pixel art to on, since that is what most tilesets are', () => {
    expect(parseSkinManifest({ roles: ['floor'] })?.isPixelated).toBe(true)
    expect(
      parseSkinManifest({ roles: ['floor'], pixelated: false })?.isPixelated,
    ).toBe(false)
  })
})

describe('getSkinTileRect', () => {
  it('cuts the column the manifest lists the role in', () => {
    const skin = createSixTileSkin()

    expect(getSkinTileRect(skin, 'floor')).toEqual({
      x: 1,
      y: 1,
      width: 16,
      height: 16,
    })
    // Column 5, so one margin plus five tiles and their gutters.
    expect(getSkinTileRect(skin, 'player')?.x).toBe(1 + 5 * 18)
  })

  it('sends an unbound wall piece to the wall fill', () => {
    const skin = createSixTileSkin()

    expect(getSkinTileRect(skin, 'wallTopLeft')).toEqual(
      getSkinTileRect(skin, 'wall'),
    )
  })

  it('returns null when the skin has no tile at all for a role', () => {
    const manifest = parseSkinManifest({ ...sixTileManifest, roles: ['floor'] })

    expect(manifest).not.toBeNull()
    expect(
      getSkinTileRect(createSkin(manifest!, atlas(18, 18)), 'box'),
    ).toBeNull()
  })

  /**
   * A role name this build has never heard of still takes up its column, so
   * skipping it rather than dropping it is what keeps the columns after it
   * pointing at the right art.
   */
  it('keeps the columns of roles it does not recognise', () => {
    const manifest = parseSkinManifest({
      ...sixTileManifest,
      roles: ['floor', 'conveyor', 'player'],
    })

    expect(manifest).not.toBeNull()
    expect(
      getSkinTileRect(createSkin(manifest!, atlas(54, 18)), 'player')?.x,
    ).toBe(1 + 2 * 18)
  })
})
