import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getBoundRoles } from './skin/skin'
import { openLevelBundle, type LevelBundle } from './open-level'
import { formatDocumentAsPublishedXsb } from './xsb'

function readBundle(slug: string): LevelBundle {
  const read = (file: string) =>
    readFileSync(`levels/${slug}/${file}`, 'utf8').trimEnd()

  return {
    slug,
    name: slug,
    xsb: read('level.xsb'),
    groundColor: '#0a1f2c',
    skin: {
      manifest: read('skin.json'),
      atlasDataUrl: 'data:image/png;base64,',
      layers: read('tiles.json'),
    },
  }
}

describe('openLevelBundle', () => {
  const bundle = readBundle('adamlevel')

  it('opens the level exactly as it was published', () => {
    const opened = openLevelBundle(bundle)

    expect(formatDocumentAsPublishedXsb(opened.document)).toBe(bundle.xsb)
    expect(opened.document.groundColor).toBe('#0a1f2c')
    expect(opened.problems).toEqual([])
  })

  it('binds each role in the manifest to its own atlas column', () => {
    const draft = openLevelBundle(bundle).skin?.draft

    expect(draft && getBoundRoles(draft)).toEqual([
      'floor',
      'goal',
      'wall',
      'box',
      'boxOnGoal',
      'player',
    ])
    expect(draft?.bindings.player).toBe(5)
    expect(draft?.sheet).toMatchObject({ tileWidth: 16, margin: 1, spacing: 2 })
  })

  it('brings the art layers back with columns as tile indices', () => {
    const layers = openLevelBundle(bundle).document.layers
    const art = layers.find((layer) => layer.kind === 'art')

    expect(layers.map((layer) => layer.kind)).toEqual([
      'builtIn',
      'art',
      'builtIn',
      'builtIn',
      'builtIn',
      'builtIn',
    ])
    expect(art?.kind === 'art' && art.tiles.get(83)?.tileIndex).toBe(9)
  })

  it('leaves out a tiles.json that does not fit the level, and says so', () => {
    const opened = openLevelBundle({
      ...bundle,
      skin: bundle.skin && { ...bundle.skin, layers: '{"width":3}' },
    })

    expect(
      opened.document.layers.every(
        (layer) => layer.kind !== 'art' || layer.tiles.size === 0,
      ),
    ).toBe(true)
    expect(opened.problems).toHaveLength(1)
  })

  it('opens a level without tiles with no skin', () => {
    expect(openLevelBundle({ ...bundle, skin: null }).skin).toBeNull()
  })
})
