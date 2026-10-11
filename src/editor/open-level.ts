import { parseLayerStack } from '../render/layers'
import { parseSkinManifest } from '../render/skin'
import { ROLE_ORDER, type TileRole } from '../render/tile-roles'
import type { EditorDocument, EditorLayer } from './document'
import type { SkinExport } from './publish'
import { bindRole, createEmptySkinDraft, type SkinDraft } from './skin/skin'
import { NO_TINT } from './tint'
import { parseXsbToDocument } from './xsb'

/** One entry of the Open level picker. */
export type LevelListing = {
  readonly slug: string
  readonly name: string
}

/** A bundle from `levels/`, in the shape the export posts it. */
export type LevelBundle = {
  readonly slug: string
  readonly name: string
  readonly xsb: string
  readonly groundColor: string | null
  readonly skin: SkinExport | null
}

/**
 * What the editor holds once a bundle is opened: the document for the session,
 * the skin for skin mode, and whatever could not be carried over.
 */
export type OpenedLevel = {
  readonly document: EditorDocument
  readonly skin: {
    readonly draft: SkinDraft
    readonly sheetDataUrl: string
  } | null
  readonly problems: readonly string[]
}

/**
 * The game never sees the sheet a skin was cut from, only the packed atlas — so
 * that is what comes back as the sheet. An atlas is already described as one:
 * the manifest's tile size, margin and spacing slice it into exactly one tile
 * per column, so role `n` is bound to tile `n` and an art tile's column is its
 * tile index, unchanged.
 *
 * The inks are already pixels in the atlas, so every binding and every placed
 * tile comes back untinted. Exporting again repacks the same pixels.
 */
export function openLevelBundle(bundle: LevelBundle): OpenedLevel {
  const problems: string[] = []
  const parsed = parseXsbToDocument(bundle.xsb)
  let editorDocument: EditorDocument = {
    ...parsed,
    groundColor: bundle.groundColor,
  }

  if (!bundle.skin) {
    return { document: editorDocument, skin: null, problems }
  }

  const manifest = parseSkinManifest(readJson(bundle.skin.manifest))

  if (!manifest) {
    problems.push('skin.json is unreadable, so the level opened without tiles.')

    return { document: editorDocument, skin: null, problems }
  }

  let draft: SkinDraft = {
    ...createEmptySkinDraft(),
    name: manifest.name,
    sheet: manifest.sheet,
    isPixelated: manifest.isPixelated,
  }

  for (const [column, role] of manifest.roles.entries()) {
    // An unknown role still took its column, so the ones after it keep theirs.
    if (isTileRole(role)) {
      draft = bindRole(draft, role, column)
    }
  }

  if (bundle.skin.layers !== null) {
    const layers = readLayers(
      readJson(bundle.skin.layers),
      editorDocument.width,
      editorDocument.height,
    )

    if (layers) {
      editorDocument = { ...editorDocument, layers }
    } else {
      problems.push(
        'tiles.json does not fit the level, so its art layers were left out.',
      )
    }
  }

  return {
    document: editorDocument,
    skin: { draft, sheetDataUrl: bundle.skin.atlasDataUrl },
    problems,
  }
}

/**
 * The game's own reader, so a file the game would refuse opens the way the game
 * plays it — without art. Art layers get fresh ids, in stack order, because the
 * file has only names.
 */
function readLayers(
  value: unknown,
  width: number,
  height: number,
): EditorLayer[] | null {
  const stack = parseLayerStack(value, width, height)

  if (!stack) {
    return null
  }

  let artCount = 0

  return stack.map((layer): EditorLayer => {
    if (layer.kind === 'builtIn') {
      return layer
    }

    artCount += 1

    return {
      kind: 'art',
      id: `art-${artCount}`,
      name: layer.name,
      tiles: new Map(
        [...layer.tiles].map(([position, column]) => [
          position,
          { tileIndex: column, tint: NO_TINT },
        ]),
      ),
    }
  })
}

function isTileRole(value: string): value is TileRole {
  return (ROLE_ORDER as readonly string[]).includes(value)
}

function readJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
