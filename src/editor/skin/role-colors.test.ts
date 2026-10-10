import { describe, expect, it } from 'vitest'
import { GROUND_KEY, ROLE_COLOR_KEYS, parseRoleColors } from './role-colors'

describe('parseRoleColors', () => {
  it('reads role names and normalises every hex to #rrggbb', () => {
    const result = parseRoleColors(
      '{ "floor": "#1A1C2C", "goal": "fff", "player": "5d275d" }',
    )

    expect(result?.colors).toEqual(
      new Map([
        ['floor', '#1a1c2c'],
        ['goal', '#ffffff'],
        ['player', '#5d275d'],
      ]),
    )
    expect(result?.unknownKeys).toEqual([])
    expect(result?.invalidKeys).toEqual([])
  })

  it('accepts the sidebar label in camel case, so "box placed" is boxPlaced', () => {
    const result = parseRoleColors(
      '{ "boxPlaced": "#00ff00", "wallFill": "#111111", "cornerTopLeft": "#222222" }',
    )

    expect(result?.colors).toEqual(
      new Map([
        ['boxOnGoal', '#00ff00'],
        ['wall', '#111111'],
        ['wallTopLeft', '#222222'],
      ]),
    )
  })

  it("reads ground apart from the roles, since it is the level's colour", () => {
    const result = parseRoleColors('{ "Ground": "#000", "floor": "#111111" }')

    expect(result?.ground).toBe('#000000')
    expect(result?.colors).toEqual(new Map([['floor', '#111111']]))
    expect(parseRoleColors('{ "floor": "#111111" }')?.ground).toBeNull()
    expect(parseRoleColors('{ "ground": "nope" }')?.invalidKeys).toEqual([
      'ground',
    ])
  })

  it('matches keys without regard to case', () => {
    expect(parseRoleColors('{ "BoxOnGoal": "#000000" }')?.colors).toEqual(
      new Map([['boxOnGoal', '#000000']]),
    )
  })

  it('reports unknown keys and unreadable values instead of applying them', () => {
    const result = parseRoleColors(
      '{ "floor": "#ffffffaa", "goal": 12, "lava": "#ff0000", "box": "#123456" }',
    )

    expect(result?.colors).toEqual(new Map([['box', '#123456']]))
    expect(result?.unknownKeys).toEqual(['lava'])
    expect(result?.invalidKeys).toEqual(['floor', 'goal'])
  })

  it('is null for anything that is not a JSON object', () => {
    expect(parseRoleColors('not json')).toBeNull()
    expect(parseRoleColors('["#ffffff"]')).toBeNull()
    expect(parseRoleColors('null')).toBeNull()
  })
})

describe('ROLE_COLOR_KEYS', () => {
  it('gives every key to exactly one role', () => {
    const keys = ROLE_COLOR_KEYS.flatMap((entry) =>
      entry.keys.map((key) => key.toLowerCase()),
    )

    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).not.toContain(GROUND_KEY)
  })
})
