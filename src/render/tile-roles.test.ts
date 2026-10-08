import { describe, expect, it } from 'vitest'
import {
  REQUIRED_ROLES,
  ROLE_ORDER,
  WALL_VARIANT_ROLES,
  getBaseRole,
  getWallRole,
  isWallVariantRole,
  type WallNeighbourhood,
} from './tile-roles'

const BURIED: WallNeighbourhood = {
  north: false,
  east: false,
  south: false,
  west: false,
  northEast: false,
  southEast: false,
  southWest: false,
  northWest: false,
}

const openOn = (...sides: (keyof WallNeighbourhood)[]): WallNeighbourhood => ({
  ...BURIED,
  ...Object.fromEntries(sides.map((side) => [side, true])),
})

describe('ROLE_ORDER', () => {
  it('lists every required role and every wall piece, once each', () => {
    expect(new Set(ROLE_ORDER).size).toBe(ROLE_ORDER.length)

    for (const role of [...REQUIRED_ROLES, ...WALL_VARIANT_ROLES]) {
      expect(ROLE_ORDER).toContain(role)
    }
  })

  it('is nine wall pieces — one fill, four sides, four corners', () => {
    expect(WALL_VARIANT_ROLES).toHaveLength(8)
    expect(ROLE_ORDER.filter((role) => role.startsWith('wall'))).toHaveLength(9)
  })
})

describe('getWallRole', () => {
  it('names the piece for its place in the frame, not its exposed face', () => {
    // Floor to the south means this cell caps the wall above that floor, so it
    // is the frame's top edge. Returning `wallBottom` here would render every
    // room inside out.
    expect(getWallRole(openOn('south'))).toBe('wallTop')
    expect(getWallRole(openOn('north'))).toBe('wallBottom')
    expect(getWallRole(openOn('east'))).toBe('wallLeft')
    expect(getWallRole(openOn('west'))).toBe('wallRight')
  })

  it('reads a corner from a diagonal, which is all a 1-thick border gives it', () => {
    expect(getWallRole(openOn('southEast'))).toBe('wallTopLeft')
    expect(getWallRole(openOn('southWest'))).toBe('wallTopRight')
    expect(getWallRole(openOn('northEast'))).toBe('wallBottomLeft')
    expect(getWallRole(openOn('northWest'))).toBe('wallBottomRight')
  })

  it('prefers an open side over an open diagonal', () => {
    // A top edge usually has the floor below it diagonally too; that must not
    // turn it into a corner.
    expect(getWallRole(openOn('south', 'southEast', 'southWest'))).toBe(
      'wallTop',
    )
  })

  it('is the fill when nothing at all is open', () => {
    expect(getWallRole(BURIED)).toBe('wall')
  })

  it('degrades a one-cell-thick wall to the priority edge', () => {
    expect(getWallRole(openOn('north', 'south'))).toBe('wallTop')
    expect(getWallRole(openOn('east', 'west'))).toBe('wallLeft')
  })

  it('degrades an inner corner, which a nine-piece set has no tile for', () => {
    expect(getWallRole(openOn('south', 'east'))).toBe('wallTop')
  })

  it('returns a wall role for all 256 neighbourhoods', () => {
    const sides = [
      'north',
      'east',
      'south',
      'west',
      'northEast',
      'southEast',
      'southWest',
      'northWest',
    ] as const

    for (let mask = 0; mask < 256; mask++) {
      const role = getWallRole(
        openOn(...sides.filter((_, bit) => (mask & (1 << bit)) !== 0)),
      )

      expect(role.startsWith('wall')).toBe(true)
      expect(ROLE_ORDER).toContain(role)
    }
  })
})

describe('getBaseRole', () => {
  it('sends every wall piece to the base wall tile', () => {
    for (const role of WALL_VARIANT_ROLES) {
      expect(getBaseRole(role)).toBe('wall')
      expect(isWallVariantRole(role)).toBe(true)
    }
  })

  it('leaves a required role alone, so there is nothing to fall back to', () => {
    for (const role of REQUIRED_ROLES) {
      expect(getBaseRole(role)).toBe(role)
      expect(isWallVariantRole(role)).toBe(false)
    }
  })
})
