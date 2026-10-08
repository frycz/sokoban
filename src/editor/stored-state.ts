import { ROLE_ORDER, type TileRole } from '../render/tile-roles'
import type { EditorDocument } from './document'
import { clampSheetSettings, type SheetSettings } from './skin/sheet'
import {
  UNBOUND,
  clearBindings,
  createEmptySkinDraft,
  type SkinDraft,
} from './skin/skin'
import { formatDocumentAsXsb, parseXsbToDocument } from './xsb'

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
 * is written as `-` rather than a space. `parseXsbToDocument` trims blank lines
 * off the top and bottom, so a document whose first row is all floor would come
 * back a row shorter. `-` is the XSB alphabet's own explicit floor, so no row is
 * ever blank and the round trip is exact.
 */
export function encodeStoredLevel(editorDocument: EditorDocument): string {
  return JSON.stringify({
    version: STORED_VERSION,
    xsb: formatDocumentAsXsb(editorDocument).replaceAll(' ', '-'),
  })
}

export function decodeStoredLevel(text: string | null): EditorDocument | null {
  const record = readRecord(text)

  if (!record || typeof record.xsb !== 'string') {
    return null
  }

  try {
    return parseXsbToDocument(record.xsb)
  } catch {
    return null
  }
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
 * sheet, and keeping indices that point at nothing is silently wrong.
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
  }

  return {
    draft: sheetDataUrl === null ? clearBindings(draft) : draft,
    sheetDataUrl,
  }
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
