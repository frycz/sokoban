import { readHexColor } from '../render/colors'
import { ROLE_ORDER, type TileRole } from '../render/tile-roles'
import type { ColorPalette, ColorPaletteLibrary } from './color-palettes'
import { isBuiltInLayer } from '../render/layers'
import {
  DEFAULT_LAYERS,
  type CustomTile,
  type CustomTiles,
  type EditorDocument,
  type EditorLayer,
} from './document'
import { clampSheetSettings, type SheetSettings } from '../render/sheet'
import {
  UNBOUND,
  clearBindings,
  createEmptySkinDraft,
  type SkinDraft,
} from './skin/skin'
import { readTint, type Tint } from './tint'
import { formatDocumentAsPublishedXsb, parseXsbToDocument } from './xsb'

/**
 * Bumped when a stored shape changes meaning. A record without the current
 * version is ignored rather than migrated: this is autosave for an internal
 * tool, so reopening to a blank editor is better than guessing at old data.
 */
const STORED_VERSION = 1

/** What a restored skin needs: the draft, and the sheet its indices refer to. */
export type StoredSkin = {
  readonly draft: SkinDraft
  readonly sheetDataUrl: string | null
}

/**
 * The level is stored as XSB, the format the editor already reads and writes, so
 * there is no second level codec to keep in step — with one substitution: floor
 * is written as `-` rather than a space, which is what
 * `formatDocumentAsPublishedXsb` is. `parseXsbToDocument` trims blank lines off
 * the top and bottom, so a document whose first row is all floor would come back
 * a row shorter. `-` is the XSB alphabet's own explicit floor, so no row is ever
 * blank and the round trip is exact.
 *
 * The layers and the ground colour ride alongside rather than inside, because
 * XSB has nowhere to put either: a built-in layer is its id, an art layer its
 * id, name, and a flat position → placement map.
 */
export function encodeStoredLevel(editorDocument: EditorDocument): string {
  return JSON.stringify({
    version: STORED_VERSION,
    xsb: formatDocumentAsPublishedXsb(editorDocument),
    layers: editorDocument.layers.map((layer) =>
      layer.kind === 'builtIn'
        ? { builtIn: layer.id }
        : {
            id: layer.id,
            name: layer.name,
            tiles: Object.fromEntries(layer.tiles),
          },
    ),
    groundColor: editorDocument.groundColor,
  })
}

export function decodeStoredLevel(text: string | null): EditorDocument | null {
  const record = readRecord(text)

  if (!record || typeof record.xsb !== 'string') {
    return null
  }

  let editorDocument: EditorDocument

  try {
    editorDocument = parseXsbToDocument(record.xsb)
  } catch {
    return null
  }

  return {
    ...editorDocument,
    layers: readLayers(record, editorDocument.width * editorDocument.height),
    // A record written before the ground colour existed has none, which is what
    // it was drawn with — so again the stored version did not have to move,
    // because the field's absence already means what the old record meant.
    groundColor: readHexColor(record.groundColor),
  }
}

/**
 * Field by field, and forgiving where the bundle parser is strict: this is the
 * author's own work in progress, so a layer that does not read is dropped
 * rather than the whole record, and a built-in missing from the stack is put
 * back on top of it rather than leaving the level with no walls on screen.
 *
 * A record written before layers existed has `customTiles` instead — one map of
 * placements over the default order. It comes back as the default stack with
 * those placements on its art layer, which is what it drew; a placement's old
 * `overwrite` mode is dropped with the mode itself.
 */
function readLayers(
  record: Record<string, unknown>,
  cellCount: number,
): readonly EditorLayer[] {
  if (!Array.isArray(record.layers)) {
    const tiles = readCustomTiles(record.customTiles, cellCount)

    return DEFAULT_LAYERS.map((layer) =>
      layer.kind === 'art' ? { ...layer, tiles } : layer,
    )
  }

  const layers: EditorLayer[] = []
  const takenIds = new Set<string>()

  for (const entry of record.layers) {
    const stored = readObject(entry)

    if (isBuiltInLayer(stored.builtIn)) {
      if (!takenIds.has(stored.builtIn)) {
        takenIds.add(stored.builtIn)
        layers.push({ kind: 'builtIn', id: stored.builtIn })
      }

      continue
    }

    const id = typeof stored.id === 'string' ? stored.id : ''

    if (!id.startsWith('art-') || takenIds.has(id)) {
      continue
    }

    takenIds.add(id)
    layers.push({
      kind: 'art',
      id,
      name: typeof stored.name === 'string' ? stored.name : id,
      tiles: readCustomTiles(stored.tiles, cellCount),
    })
  }

  for (const layer of DEFAULT_LAYERS) {
    if (layer.kind === 'builtIn' && !takenIds.has(layer.id)) {
      layers.push(layer)
    }
  }

  return layers
}

/**
 * Anything out of the level's bounds or not a placement is dropped, the same
 * way a nonsense binding comes back unbound.
 *
 * A bare number is what the first build of custom tiles wrote, before a
 * placement grew an ink. A record without an ink reads as the identity tint,
 * which is what it was drawn with.
 */
function readCustomTiles(value: unknown, cellCount: number): CustomTiles {
  const stored = readObject(value)
  const customTiles = new Map<number, CustomTile>()

  for (const [key, entry] of Object.entries(stored)) {
    const position = Number(key)

    if (!Number.isInteger(position) || position < 0 || position >= cellCount) {
      continue
    }

    const record = typeof entry === 'number' ? { tileIndex: entry } : entry
    const tileIndex = readTileIndex(readObject(record).tileIndex)

    if (tileIndex === UNBOUND) {
      continue
    }

    customTiles.set(position, {
      tileIndex,
      tint: readTint(readObject(record).tint),
    })
  }

  return customTiles
}

export function encodeStoredSkin(
  draft: SkinDraft,
  sheetDataUrl: string | null,
): string {
  return JSON.stringify({
    version: STORED_VERSION,
    name: draft.name,
    sheet: draft.sheet,
    isPixelated: draft.isPixelated,
    bindings: draft.bindings,
    tints: draft.tints,
    background: draft.background,
    sheetDataUrl,
  })
}

/**
 * Field by field rather than a cast, because storage holds whatever was last
 * written there — an older build, or a hand edit in devtools — and a draft built
 * from nonsense would break the preview rather than the parse.
 *
 * A draft restored without its sheet comes back unbound, for the same reason
 * re-slicing drops every binding: a tile index only means something against one
 * sheet, and keeping indices that point at nothing is silently wrong. The
 * palette survives that, as it survives a re-slice — a colour was never about
 * the sheet.
 */
export function decodeStoredSkin(text: string | null): StoredSkin | null {
  const record = readRecord(text)

  if (!record) {
    return null
  }

  const empty = createEmptySkinDraft()
  const sheetDataUrl =
    typeof record.sheetDataUrl === 'string' &&
    record.sheetDataUrl.startsWith('data:')
      ? record.sheetDataUrl
      : null

  const draft: SkinDraft = {
    name: typeof record.name === 'string' ? record.name : empty.name,
    sheet: readSheetSettings(record.sheet, empty.sheet),
    isPixelated:
      typeof record.isPixelated === 'boolean'
        ? record.isPixelated
        : empty.isPixelated,
    bindings: readBindings(record.bindings),
    tints: readTints(record.tints),
    background: readHexColor(record.background),
  }

  return {
    draft: sheetDataUrl === null ? clearBindings(draft) : draft,
    sheetDataUrl,
  }
}

/**
 * The colour palettes, which are the one slice that is neither a level nor a
 * skin: they outlive both, because a ramp is kept to draw the next level with.
 */
export function encodeStoredColorPalettes(
  library: ColorPaletteLibrary,
): string {
  return JSON.stringify({
    version: STORED_VERSION,
    palettes: library.palettes,
  })
}

/**
 * Field by field like the skin is, and for the same reason. A palette with no
 * usable id is dropped rather than given one, because an id is what two panels
 * remember a choice by: inventing one here would hand back a palette that is
 * not the palette that was stored.
 */
export function decodeStoredColorPalettes(
  text: string | null,
): ColorPaletteLibrary | null {
  const record = readRecord(text)

  if (!record || !Array.isArray(record.palettes)) {
    return null
  }

  const palettes: ColorPalette[] = []
  const takenIds = new Set<string>()

  for (const entry of record.palettes) {
    const stored = readObject(entry)
    const id = typeof stored.id === 'string' ? stored.id : ''

    if (id === '' || takenIds.has(id)) {
      continue
    }

    takenIds.add(id)
    palettes.push({
      id,
      name: typeof stored.name === 'string' ? stored.name : `palette ${id}`,
      colors: readPaletteColors(stored.colors),
    })
  }

  return { palettes }
}

/**
 * Through `readHexColor`, so a colour the canvas would reject never comes back
 * in — and deduplicated, because the edits above promise a palette holds each
 * colour once and a hand edit in devtools is not held to that.
 */
function readPaletteColors(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const colors: string[] = []

  for (const entry of value) {
    const color = readHexColor(entry)

    if (color !== null && !colors.includes(color)) {
      colors.push(color)
    }
  }

  return colors
}

function readRecord(text: string | null): Record<string, unknown> | null {
  if (text === null || text === '') {
    return null
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }

  const record = parsed as Record<string, unknown>

  return record.version === STORED_VERSION ? record : null
}

function readSheetSettings(
  value: unknown,
  fallback: SheetSettings,
): SheetSettings {
  const stored = readObject(value)

  return clampSheetSettings({
    tileWidth: readNumber(stored.tileWidth, fallback.tileWidth),
    tileHeight: readNumber(stored.tileHeight, fallback.tileHeight),
    margin: readNumber(stored.margin, fallback.margin),
    spacing: readNumber(stored.spacing, fallback.spacing),
  })
}

/**
 * Built from `ROLE_ORDER`, like `EMPTY_BINDINGS` is, so a role added since the
 * state was written comes back unbound instead of missing, and a role that no
 * longer exists is dropped rather than carried along.
 */
function readBindings(value: unknown): Record<TileRole, number> {
  const stored = readObject(value)

  return Object.fromEntries(
    ROLE_ORDER.map((role) => [role, readTileIndex(stored[role])]),
  ) as Record<TileRole, number>
}

/**
 * Built from `ROLE_ORDER` like `readBindings` is, and for the same reasons. A
 * record written before the tints existed has none, and every role comes back
 * at the identity tint — which is what it was being drawn with.
 */
function readTints(value: unknown): Record<TileRole, Tint> {
  const stored = readObject(value)

  return Object.fromEntries(
    ROLE_ORDER.map((role) => [role, readTint(stored[role])]),
  ) as Record<TileRole, Tint>
}

function readTileIndex(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return UNBOUND
  }

  return value
}

function readNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return value
}

function readObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return {}
  }

  return value as Record<string, unknown>
}
