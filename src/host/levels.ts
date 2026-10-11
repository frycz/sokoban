import { parseStringToLevelState } from '../core/level'
import type { Level, LevelState } from '../core/types'
import { readHexColor } from '../render/colors'
import {
  DEFAULT_LAYER_STACK,
  parseLayerStack,
  type LayerStack,
} from '../render/layers'
import { createSkin, parseSkinManifest, type Skin } from '../render/skin'
import { LEVEL } from './level-data'

/** A level the picker can offer: parsed, so it is known to be playable. */
export type PlayableLevel = {
  readonly name: string
  readonly levelState: LevelState
  /** Null for a level that shipped without tiles; it plays in flat colour. */
  readonly skin: Skin | null
  /**
   * The draw order, bottom first, with the art layers the author painted. The
   * default order for a level that shipped none.
   */
  readonly layers: LayerStack
  /** The colour under the whole board. Null for a level that named none. */
  readonly groundColor: string | null
}

export type LevelCatalog = {
  readonly levels: readonly PlayableLevel[]
  /** Bundles that could not be loaded, said out loud rather than hidden. */
  readonly problems: readonly string[]
}

/**
 * The editor writes one directory per level into `levels/`, and these globs are
 * how the game finds them — resolved by the bundler against the project root, so
 * the same code serves the dev server and the built site, with no index file to
 * keep in step and no directory listing to fetch.
 *
 * Eager, because the whole point is to show every level at once.
 */
const levelTexts = import.meta.glob<string>('/levels/*/level.xsb', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const levelRecords = import.meta.glob<unknown>('/levels/*/level.json', {
  import: 'default',
  eager: true,
})

const skinRecords = import.meta.glob<unknown>('/levels/*/skin.json', {
  import: 'default',
  eager: true,
})

const atlasUrls = import.meta.glob<string>('/levels/*/skin.png', {
  query: '?url',
  import: 'default',
  eager: true,
})

const layerRecords = import.meta.glob<unknown>('/levels/*/tiles.json', {
  import: 'default',
  eager: true,
})

/**
 * Everything in `levels/`, plus the built-in level so the picker is never empty
 * — a fresh checkout has nothing exported yet, and the game should still be
 * playable.
 *
 * Async only because the atlases are images. A level whose text the parser
 * refuses is left out and reported: the export endpoint will not write one, so
 * it means a file was hand-edited, and a card that cannot be played is worse
 * than a line saying why.
 */
export async function loadLevelCatalog(): Promise<LevelCatalog> {
  const problems: string[] = []
  const levels: PlayableLevel[] = []

  const builtIn = readLevel('Built-in', LEVEL)

  if (builtIn.kind === 'level') {
    levels.push({
      ...builtIn.level,
      skin: null,
      layers: DEFAULT_LAYER_STACK,
      groundColor: null,
    })
  } else {
    problems.push(builtIn.message)
  }

  const slugs = Object.keys(levelTexts)
    .map(getSlug)
    .sort((one, other) => one.localeCompare(other))

  for (const slug of slugs) {
    const record = readLevelRecord(slug)
    const read = readLevel(
      readName(record, slug),
      levelTexts[`/levels/${slug}/level.xsb`],
    )

    if (read.kind === 'problem') {
      problems.push(read.message)
      continue
    }

    const skin = await loadSkin(slug)

    if (skin.kind === 'problem') {
      problems.push(skin.message)
    }

    const layers = loadLayers(
      slug,
      read.level.levelState.level,
      skin.kind === 'skin',
    )

    if (layers.kind === 'problem') {
      problems.push(layers.message)
    }

    levels.push({
      ...read.level,
      skin: skin.kind === 'skin' ? skin.skin : null,
      layers: layers.kind === 'layers' ? layers.layers : DEFAULT_LAYER_STACK,
      groundColor: readHexColor(record?.groundColor),
    })
  }

  return { levels, problems }
}

type LayerResult =
  | { readonly kind: 'layers'; readonly layers: LayerStack }
  | { readonly kind: 'none' }
  | { readonly kind: 'problem'; readonly message: string }

/**
 * `tiles.json` names atlas columns, so it is meaningless without the skin — and
 * it names cells by flat position, so it is meaningless unless its grid is the
 * level's. Both are checked here rather than assumed, because a hand-edited
 * bundle drawing every tile one cell off would be worse than one drawing none.
 */
function loadLayers(slug: string, level: Level, hasSkin: boolean): LayerResult {
  const record = layerRecords[`/levels/${slug}/tiles.json`]

  if (record === undefined) {
    return { kind: 'none' }
  }

  if (!hasSkin) {
    return {
      kind: 'problem',
      message: `${slug}: has tiles.json but no usable skin to cut them from, so its layers are ignored.`,
    }
  }

  const layers = parseLayerStack(record, level.width, level.height)

  if (!layers) {
    return {
      kind: 'problem',
      message: `${slug}: tiles.json is not a layer stack for this level's ${level.width}×${level.height} grid, so its layers are ignored.`,
    }
  }

  return { kind: 'layers', layers }
}

type LevelResult =
  | {
      readonly kind: 'level'
      readonly level: Omit<PlayableLevel, 'skin' | 'layers' | 'groundColor'>
    }
  | { readonly kind: 'problem'; readonly message: string }

function readLevel(name: string, xsb: string): LevelResult {
  try {
    return {
      kind: 'level',
      level: { name, levelState: parseStringToLevelState(xsb) },
    }
  } catch (error) {
    return {
      kind: 'problem',
      message: `${name}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

type SkinResult =
  | { readonly kind: 'skin'; readonly skin: Skin }
  | { readonly kind: 'none' }
  | { readonly kind: 'problem'; readonly message: string }

/**
 * A skin is its manifest and its atlas together: a role is a column index,
 * which means nothing without the image it indexes. Either file alone is a
 * broken bundle rather than half a skin, so it is reported and the level plays
 * in flat colour.
 */
async function loadSkin(slug: string): Promise<SkinResult> {
  const record = skinRecords[`/levels/${slug}/skin.json`]
  const atlasUrl = atlasUrls[`/levels/${slug}/skin.png`]

  if (record === undefined && atlasUrl === undefined) {
    return { kind: 'none' }
  }

  if (record === undefined || atlasUrl === undefined) {
    return {
      kind: 'problem',
      message: `${slug}: has ${record === undefined ? 'skin.png' : 'skin.json'} but not the other, so it plays without tiles.`,
    }
  }

  const manifest = parseSkinManifest(record)

  if (!manifest) {
    return {
      kind: 'problem',
      message: `${slug}: skin.json is not a skin manifest, so it plays without tiles.`,
    }
  }

  try {
    return {
      kind: 'skin',
      skin: createSkin(manifest, await loadImage(atlasUrl)),
    }
  } catch (error) {
    return {
      kind: 'problem',
      message: `${slug}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()

    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', () =>
      reject(new Error(`skin.png could not be read as an image`)),
    )
    image.src = url
  })
}

/** `/levels/<slug>/level.xsb` — the directory is the level's identity. */
function getSlug(path: string): string {
  return path.split('/')[2]
}

/**
 * Everything about a level that is not its cells: the name XSB has no room for,
 * and the ground colour, which is not a tile for the skin to carry. Read once
 * and handed to both readers rather than fetched per field.
 */
function readLevelRecord(slug: string): Record<string, unknown> | null {
  const record = levelRecords[`/levels/${slug}/level.json`]

  if (typeof record !== 'object' || record === null) {
    return null
  }

  return record as Record<string, unknown>
}

/**
 * The display name, which is what `level.json` exists for: XSB has no room for a
 * title, and the slug is a file name rather than something anyone chose to
 * read. Missing or malformed, the slug will do.
 */
function readName(
  record: Record<string, unknown> | null,
  slug: string,
): string {
  const name = record?.name

  return typeof name === 'string' && name.trim() !== '' ? name : slug
}
