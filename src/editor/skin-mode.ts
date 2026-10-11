import { readHexColor } from '../render/colors'
import type { BuiltInLayer } from '../render/layers'
import type { LevelAutosave } from './autosave'
import type { ColorPaletteLibraryStore } from './color-palette-library'
import { resolveColorPalette } from './color-palettes'
import {
  NO_GROUND_COLOR,
  getArtLayer,
  getNextArtLayerId,
  type EditorLayer,
} from './document'
import {
  commitFieldOnEnter,
  copyTextToClipboard,
  requireElement,
  downloadBlob,
  readDataUrlAsImageBitmap,
  readFileAsDataUrl,
  type EditorMode,
} from './dom'
import { parseHexColor } from './hex'
import { readSwatchClick, renderSwatches, type SwatchAction } from './swatches'
import { computeGridLayout, getPositionAtPixel } from './layout'
import type { SkinExport } from './publish'
import type { Session } from './session'
import { readStoredText, writeStoredText } from './storage'
import { createZoomControl } from './zoom'
import { decodeStoredSkin, encodeStoredSkin } from './stored-state'
import { getAtlasSize, packSkinAtlas } from './skin/atlas'
import {
  countPlacedTiles,
  countTinted,
  formatLayersFile,
  hasLayersFile,
  packLayers,
  type LayerPacking,
} from './skin/layers'
import { createPalettePainter } from './skin/palette'
import { createSkinPreviewPainter } from './skin/preview'
import { ROLE_LABELS, getTopRoleAtPosition, type TileRole } from './skin/roles'
import {
  GROUND_KEY,
  ROLE_COLOR_KEYS,
  parseRoleColors,
} from './skin/role-colors'
import { getSheetGrid, getSourceTileRect } from '../render/sheet'
import { computeSheetLayout, getTileIndexAtPixel } from './skin/palette-layout'
import {
  UNBOUND,
  bindRole,
  clearBindings,
  createEmptySkinDraft,
  formatSkinManifest,
  getBoundRoles,
  getMissingRequiredRoles,
  getRoleTint,
  isRoleBound,
  isSkinComplete,
  setRoleTint,
  setSheetSettings,
  setSkinBackground,
  toSkinFileName,
  unbindRole,
  type SkinDraft,
} from './skin/skin'
import { NO_TINT, readTint, type Tint } from './tint'
import { createTintedTileCache } from './skin/tinted-tiles'

const THUMBNAIL_SIZE = 24

/**
 * One action, because copying a hex is the whole of what this panel does with a
 * palette: the two colours it has — the ink and the ground — are hex fields, so
 * a copied colour is pasted into whichever of them it was wanted for. A pair of
 * apply buttons per swatch would have to guess which, and guess wrong half the
 * time.
 */
const PALETTE_SWATCH_ACTIONS: readonly SwatchAction[] = [
  { action: 'copy', glyph: '⧉', title: 'Copy the hex' },
]

/**
 * The sidebar groups roles rather than listing fourteen flat, because the two
 * halves are gated differently: the first six block an export, the wall pieces
 * are optional refinements that fall back to `wall`.
 */
const ROLE_GROUPS: readonly {
  readonly heading: string
  readonly roles: readonly TileRole[]
}[] = [
  {
    heading: 'required',
    roles: ['floor', 'goal', 'wall', 'box', 'boxOnGoal', 'player'],
  },
  {
    heading: 'wall edges — optional, fall back to wall fill',
    roles: [
      'wallTop',
      'wallRight',
      'wallBottom',
      'wallLeft',
      'wallTopLeft',
      'wallTopRight',
      'wallBottomRight',
      'wallBottomLeft',
    ],
  },
]

/**
 * What a click on the preview means. Binding a role is the skin's own gesture —
 * every wall changes at once — and the other three are the escape hatch from
 * it: one cell of one art layer, one tile, over or under whatever the skin
 * draws there depending on where that layer sits in the stack.
 *
 * `recolor` is how the ink is changed after the fact. It is its own tool rather
 * than being folded into `place` because re-stamping a cell to change the ink
 * would need the original tile still selected, and would quietly replace the
 * art if it were not.
 */
type PreviewTool = 'bind' | 'place' | 'erase' | 'recolor'

const TOOL_OF_KEY: Record<string, PreviewTool | undefined> = {
  '1': 'bind',
  '2': 'place',
  '3': 'erase',
  '4': 'recolor',
}

/** What a built-in layer is called in the layer list. */
const BUILT_IN_LAYER_LABELS: Record<BuiltInLayer, string> = {
  floor: 'floor',
  walls: 'walls',
  goals: 'goals',
  boxes: 'boxes',
  player: 'player',
}

/**
 * Skin mode plus the one thing outside it that needs the skin: publishing a
 * level bundle, which is both halves of the editor at once. The draft and the
 * loaded sheet stay in this closure — `getSkinExport` hands out the packed
 * result, not the state.
 */
export type SkinMode = EditorMode & {
  readonly getSkinExport: () => SkinExport | null
}

/**
 * The custom tiles live on the document rather than in the draft, so skin mode
 * takes the level autosave too: placing a tile is an edit to the level, and the
 * `level` slice has to be written whichever panel made it.
 *
 * The palette library it only reads — colours mode owns the edits — so it takes
 * the store rather than a library, and sees whatever was made in the other
 * panel on arrival: `index.ts` redraws the incoming mode on every switch.
 */
export function createSkinMode(
  session: Session,
  levelAutosave: LevelAutosave,
  colorPalettes: ColorPaletteLibraryStore,
): SkinMode {
  const fileInput = requireElement<HTMLInputElement>('#sheet-file')
  const tileWidthInput = requireElement<HTMLInputElement>('#tile-width')
  const tileHeightInput = requireElement<HTMLInputElement>('#tile-height')
  const marginInput = requireElement<HTMLInputElement>('#sheet-margin')
  const spacingInput = requireElement<HTMLInputElement>('#sheet-spacing')
  const pixelatedInput = requireElement<HTMLInputElement>('#pixelated')
  const nameInput = requireElement<HTMLInputElement>('#skin-name')
  const paletteView = requireElement<HTMLElement>('#palette-view')
  const paletteCanvas = requireElement<HTMLCanvasElement>('#sheet-palette')
  const previewView = requireElement<HTMLElement>('#skin-preview-view')
  const previewCanvas = requireElement<HTMLCanvasElement>('#skin-preview')
  const previewTools = requireElement<HTMLElement>('#preview-tools')
  const showSkinTilesInput =
    requireElement<HTMLInputElement>('#show-skin-tiles')
  const layerList = requireElement<HTMLElement>('#layer-list')
  const layerAddButton = requireElement<HTMLButtonElement>('#layer-add')
  const layerShowAllButton =
    requireElement<HTMLButtonElement>('#layer-show-all')
  const report = requireElement<HTMLElement>('#skin-report')
  const roleList = requireElement<HTMLElement>('#role-list')
  const inkControls = requireElement<HTMLElement>('#ink')
  const inkColorInput = requireElement<HTMLInputElement>('#ink-color')
  const inkHexInput = requireElement<HTMLInputElement>('#ink-hex')
  const inkCopyButton = requireElement<HTMLButtonElement>('#ink-copy')
  const groundColorInput = requireElement<HTMLInputElement>('#ground-color')
  const groundHexInput = requireElement<HTMLInputElement>('#ground-hex')
  const groundCopyButton = requireElement<HTMLButtonElement>('#ground-copy')
  const groundClearButton = requireElement<HTMLButtonElement>('#ground-clear')
  const tileBackgroundSwatch = requireElement<HTMLElement>(
    '#tile-background-swatch',
  )
  const tileBackgroundHexInput = requireElement<HTMLInputElement>(
    '#tile-background-hex',
  )
  const tileBackgroundClearButton = requireElement<HTMLButtonElement>(
    '#tile-background-clear',
  )
  const paletteSelect = requireElement<HTMLSelectElement>('#skin-palette')
  const paletteSwatches = requireElement<HTMLElement>('#skin-palette-swatches')
  const paletteReport = requireElement<HTMLElement>('#skin-palette-report')
  const atlasButton = requireElement<HTMLButtonElement>('#export-atlas')
  const manifestButton = requireElement<HTMLButtonElement>('#export-manifest')
  const roleColorsImportButton = requireElement<HTMLButtonElement>(
    '#role-colors-import',
  )
  const roleColorsHelpButton =
    requireElement<HTMLButtonElement>('#role-colors-help')
  const roleColorsDialog = requireElement<HTMLDialogElement>(
    '#role-colors-dialog',
  )
  const roleColorsText =
    requireElement<HTMLTextAreaElement>('#role-colors-text')
  const roleColorsReport = requireElement<HTMLElement>('#role-colors-report')
  const roleColorsApplyButton =
    requireElement<HTMLButtonElement>('#role-colors-apply')
  const roleColorsHelpDialog = requireElement<HTMLDialogElement>(
    '#role-colors-help-dialog',
  )
  const roleColorsKeys = requireElement<HTMLTableElement>('#role-colors-keys')

  const getTintedTile = createTintedTileCache()
  const paintPalette = createPalettePainter(paletteView, paletteCanvas)
  const paintPreview = createSkinPreviewPainter(previewView, previewCanvas)

  const stored = decodeStoredSkin(readStoredText('skin'))

  let draft: SkinDraft = stored?.draft ?? createEmptySkinDraft()
  let sheetImage: ImageBitmap | null = null
  let sheetDataUrl: string | null = stored?.sheetDataUrl ?? null
  let selectedTileIndex = UNBOUND
  // View settings, not part of the skin, so none of them is stored with the
  // draft — the same deal the level panel's selected brush gets.
  let previewTool: PreviewTool = 'bind'
  // The layer the place, erase and recolor tools work on, and the one a new
  // layer goes above. Any layer can be selected, so a new layer can be put
  // anywhere in the stack; only an art layer can be painted. Resolved against
  // the document on every redraw, because an undo can take the layer away.
  let selectedLayerId: string | null = null
  // The editor's way of looking at the stack, never the level's: a hidden layer
  // is still exported, and the game still draws it.
  let hiddenLayerIds = new Set<string>()
  let soloLayerId: string | null = null
  // The ink the next bind or placement is made with. View state like the brush
  // and the place mode: what it writes is kept — on the draft for a role, on the
  // cell for a placement — so the picker itself has nothing to remember.
  let ink: Tint = NO_TINT
  let showSkinTiles = true
  let hoverPosition = -1
  let isPlacing = false
  // Whether the ground picker is mid-visit. A colour input fires `input` for
  // every shade dragged through and `change` when the picker closes, so this is
  // what folds one visit into one undo entry — the stroke a drag across cells
  // gets, with the picker's own gesture for the boundary.
  // Whether the ground is mid-edit, from either control: the picker fires for
  // every shade dragged through, and the hex field for every character typed.
  // One undo entry per visit to either, which is what this folds them into.
  let isEditingGround = false
  // Which palette this panel is looking at, and the last thing the colour
  // controls had to say. Both view state: a palette is chosen to copy out of,
  // which is nothing the skin remembers.
  let selectedPaletteId: string | null = null
  let paletteNote: {
    readonly message: string
    readonly className: string
  } | null = null
  // What storage already holds, as the two values it is made of rather than as
  // the text. The draft came out of storage, so the two start in step and
  // nothing is written back until the skin actually differs — and the test for
  // that is identity, not a string compare, because the sheet's data url
  // dominates the record and a redraw must not rebuild it. Every edit replaces
  // `draft` wholesale and the pure edits return the same object when nothing
  // changed, so identity is exact.
  let savedDraft: SkinDraft = draft
  let savedSheetDataUrl: string | null = sheetDataUrl
  let storageNote: string | null = null

  // Two of them, because the panel has two things to look closely at: the sheet
  // the tiles are picked from, and the level they are being put on.
  const paletteZoom = createZoomControl({
    view: paletteView,
    content: paletteCanvas,
    outButton: requireElement<HTMLButtonElement>('#zoom-out'),
    inButton: requireElement<HTMLButtonElement>('#zoom-in'),
    readout: requireElement<HTMLElement>('#zoom-level'),
    isEnabled: () => sheetImage !== null,
    repaint: () => update(),
  })

  const previewZoom = createZoomControl({
    view: previewView,
    content: previewCanvas,
    outButton: requireElement<HTMLButtonElement>('#preview-zoom-out'),
    inButton: requireElement<HTMLButtonElement>('#preview-zoom-in'),
    readout: requireElement<HTMLElement>('#preview-zoom-level'),
    repaint: () => update(),
  })

  syncSheetInputs()

  if (sheetDataUrl !== null) {
    void restoreSheet(sheetDataUrl)
  }

  function syncSheetInputs(): void {
    tileWidthInput.value = String(draft.sheet.tileWidth)
    tileHeightInput.value = String(draft.sheet.tileHeight)
    marginInput.value = String(draft.sheet.margin)
    spacingInput.value = String(draft.sheet.spacing)
    pixelatedInput.checked = draft.isPixelated
    nameInput.value = draft.name
  }

  function setMessage(message: string, className: string): void {
    const line = document.createElement('p')
    line.className = className
    line.textContent = message
    report.append(line)
  }

  function renderReport(): void {
    report.replaceChildren()

    if (!sheetImage) {
      setMessage('Load a tile sheet to begin.', 'warning')

      return
    }

    const grid = getSheetGrid(draft.sheet, sheetImage.width, sheetImage.height)

    if (grid.tileCount === 0) {
      setMessage(
        `No tiles fit: the sheet is ${sheetImage.width}×${sheetImage.height}.`,
        'error',
      )

      return
    }

    setMessage(
      `${grid.columns}×${grid.rows} tiles (${grid.tileCount}) in the sheet.`,
      'warning',
    )

    const missing = getMissingRequiredRoles(draft)

    if (missing.length > 0) {
      setMessage(
        `${missing.length} required unbound: ${missing.map((role) => ROLE_LABELS[role]).join(', ')}.`,
        'error',
      )
      setMessage(
        'Pick a tile, then click a role below or a cell in the preview.',
        'warning',
      )

      return
    }

    const wallPieces = getBoundRoles(draft).filter((role) =>
      role.startsWith('wall'),
    ).length

    setMessage(
      `Ready to export — ${getBoundRoles(draft).length} tiles, ${wallPieces} of 9 wall pieces.`,
      'ok',
    )
  }

  /**
   * A canvas rather than the sheet behind a `background-position`, because a
   * thumbnail now has to show the role's ink and the one honest way to do that
   * is the same `tintSheetTile` the preview and the export go through. Fitted
   * rather than stretched, so a non-square tile keeps its shape.
   */
  function drawThumbnail(
    canvas: HTMLCanvasElement,
    tile: HTMLCanvasElement,
  ): void {
    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    const scale = Math.min(
      THUMBNAIL_SIZE / tile.width,
      THUMBNAIL_SIZE / tile.height,
    )
    const width = Math.max(1, Math.round(tile.width * scale))
    const height = Math.max(1, Math.round(tile.height * scale))

    context.imageSmoothingEnabled = !draft.isPixelated
    context.drawImage(
      tile,
      Math.round((THUMBNAIL_SIZE - width) / 2),
      Math.round((THUMBNAIL_SIZE - height) / 2),
      width,
      height,
    )
  }

  /**
   * The ink line a bound role gets under its tile: the current ink as a stamp,
   * the role's own colour as a hex to paste into, and that hex to copy out.
   *
   * A second line rather than three more things on the first, because the first
   * is already a thumbnail, a label as long as "corner bottom-right" and a tile
   * index inside 320 pixels. What it buys is the short way round from a palette
   * — copy there, paste here — without a trip through the ink picker and a
   * second click to stamp it.
   */
  function createRoleInkLine(role: TileRole): HTMLElement {
    const roleTint = draft.tints[role]
    const line = document.createElement('div')
    line.className = 'role-line ink-line'

    // The glyph says the mode and its colour says the colour, so the row reads
    // its own ink at a glance — white and round is no ink, which is what most
    // rows are.
    const applyInk = document.createElement('button')
    applyInk.type = 'button'
    applyInk.className = 'ink'
    applyInk.dataset.ink = role
    applyInk.title = `Paint ${ROLE_LABELS[role]} with the current ink, mode and all`
    applyInk.style.color = roleTint.color
    applyInk.textContent = roleTint.mode === 'flat' ? '◆' : '●'

    const hex = document.createElement('input')
    hex.type = 'text'
    hex.className = 'hex'
    hex.spellcheck = false
    hex.dataset.roleHex = role
    hex.value = roleTint.color
    // Deliberately not inked: half a palette is darker than this background, and
    // a hex spelled in its own colour is a hex that cannot be read. The glyph
    // beside it carries the colour, where being dark costs nothing.
    hex.setAttribute('aria-label', `${ROLE_LABELS[role]} hex`)
    hex.title = `Paste or type a hex to colour ${ROLE_LABELS[role]}`

    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'swatch-action'
    copy.dataset.roleCopy = role
    copy.title = `Copy ${ROLE_LABELS[role]}'s hex`
    copy.textContent = '⧉'

    // The fill behind the tile's transparent pixels. The square shows it, or
    // is hollow when there is none; the field is empty for none, which is also
    // how one is taken away.
    const backgroundSwatch = document.createElement('span')
    backgroundSwatch.className = 'background-swatch'
    backgroundSwatch.textContent = roleTint.background === null ? '□' : '■'
    backgroundSwatch.style.color = roleTint.background ?? ''
    backgroundSwatch.title =
      roleTint.background === null ? 'No background' : 'Background'

    const background = document.createElement('input')
    background.type = 'text'
    background.className = 'hex background'
    background.spellcheck = false
    // Empty inherits the skin-wide background, so the placeholder says which.
    background.placeholder = draft.background ?? 'no bg'
    background.dataset.roleBackground = role
    background.value = roleTint.background ?? ''
    background.setAttribute('aria-label', `${ROLE_LABELS[role]} background hex`)
    background.title = `A hex to fill ${ROLE_LABELS[role]}'s transparent pixels with, or empty for the tile bg`

    line.append(applyInk, hex, copy, backgroundSwatch, background)

    return line
  }

  /**
   * Rebuilt from scratch on every redraw, which would take the caret out of a
   * hex field mid-paste — so the field being typed in is put back as it was.
   * That is cheaper than reconciling fourteen rows, and a hex field is the only
   * thing in the list that can hold a caret.
   *
   * Its text is carried across rather than redrawn from the role, because the
   * two legitimately disagree while it is being typed: `#b13` is a valid
   * shorthand, so it commits `#bb1133` on the way past, and redrawing the field
   * from the role would replace the three characters typed so far with seven.
   * The field squares up with the role when the author leaves it.
   */
  function renderRoleList(): void {
    const grid = sheetImage
      ? getSheetGrid(draft.sheet, sheetImage.width, sheetImage.height)
      : null
    const focused = document.activeElement
    const typingSelector =
      focused instanceof HTMLInputElement
        ? focused.dataset.roleHex
          ? `input[data-role-hex="${focused.dataset.roleHex}"]`
          : focused.dataset.roleBackground
            ? `input[data-role-background="${focused.dataset.roleBackground}"]`
            : null
        : null
    const typing =
      focused instanceof HTMLInputElement && typingSelector !== null
        ? {
            selector: typingSelector,
            text: focused.value,
            caret: focused.selectionStart,
          }
        : null

    roleList.replaceChildren()

    for (const group of ROLE_GROUPS) {
      const heading = document.createElement('p')
      heading.className = 'role-heading'
      heading.textContent = group.heading
      roleList.append(heading)

      for (const role of group.roles) {
        const tileIndex = draft.bindings[role]
        const row = document.createElement('div')
        row.className = 'role-row'

        const tileLine = document.createElement('div')
        tileLine.className = 'role-line'

        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.role = role

        const thumbnail = document.createElement('canvas')
        thumbnail.className = 'tile'
        thumbnail.width = THUMBNAIL_SIZE
        thumbnail.height = THUMBNAIL_SIZE

        if (sheetImage && grid && tileIndex !== UNBOUND) {
          const rect = getSourceTileRect(draft.sheet, grid, tileIndex)

          if (rect.width > 0) {
            drawThumbnail(
              thumbnail,
              getTintedTile(sheetImage, rect, getRoleTint(draft, role)),
            )
          }
        }

        const label = document.createElement('span')
        label.textContent = ROLE_LABELS[role]

        const bound = document.createElement('span')
        bound.className = 'bound'
        bound.textContent = tileIndex === UNBOUND ? 'unbound' : `#${tileIndex}`

        button.append(thumbnail, label, bound)
        tileLine.append(button)

        // Only on a bound role, both of them: an ink with no tile to paint is
        // nothing to click, and there is nothing to unbind either.
        if (isRoleBound(draft, role)) {
          const clear = document.createElement('button')
          clear.type = 'button'
          clear.className = 'clear'
          clear.dataset.clear = role
          clear.title = `Unbind ${ROLE_LABELS[role]}`
          clear.textContent = '×'
          tileLine.append(clear)
        }

        row.append(tileLine)

        if (isRoleBound(draft, role)) {
          row.append(createRoleInkLine(role))
        }

        roleList.append(row)
      }
    }

    if (typing === null) {
      return
    }

    const restored = roleList.querySelector<HTMLInputElement>(typing.selector)

    if (!restored) {
      return
    }

    restored.value = typing.text
    restored.focus()

    if (typing.caret !== null) {
      restored.setSelectionRange(typing.caret, typing.caret)
    }
  }

  /**
   * Autosave rides along with the redraw, as it does in level mode. The sheet
   * is stored with the draft because a binding is a tile index, which means
   * nothing without the exact image it was cut from.
   */
  function persist(): void {
    if (draft === savedDraft && sheetDataUrl === savedSheetDataUrl) {
      return
    }

    savedDraft = draft
    savedSheetDataUrl = sheetDataUrl

    if (writeStoredText('skin', encodeStoredSkin(draft, sheetDataUrl))) {
      storageNote = null

      return
    }

    // The sheet is what makes the record big, and bindings mean nothing without
    // it, so fall back to storing the settings alone rather than nothing. The
    // baseline moves either way, so a sheet too large to store is not retried
    // on every redraw — only when the skin changes again.
    storageNote = writeStoredText(
      'skin',
      encodeStoredSkin(clearBindings(draft), null),
    )
      ? 'Sheet too large for storage — settings are saved, bindings are not.'
      : 'Not being saved — browser storage is unavailable.'
  }

  /**
   * The selected layer, or the topmost art layer when nothing valid is — which
   * is what a fresh level and an undone "add layer" both need: the tools should
   * paint somewhere sensible without the author picking first.
   */
  function resolveSelectedLayer(): EditorLayer | null {
    const { layers } = session.current()
    const selected = layers.find((layer) => layer.id === selectedLayerId)

    if (selected) {
      return selected
    }

    const fallback =
      [...layers].reverse().find((layer) => layer.kind === 'art') ??
      layers[layers.length - 1] ??
      null
    selectedLayerId = fallback?.id ?? null

    return fallback
  }

  function isLayerVisible(layerId: string): boolean {
    return soloLayerId === null
      ? !hiddenLayerIds.has(layerId)
      : layerId === soloLayerId
  }

  /**
   * The hand-placed tiles, said in the sidebar rather than only drawn, because
   * the layer switches mean the preview can be showing none of them — and what
   * the tools are about to paint on, because a built-in or hidden layer is a
   * stroke that does nothing visible.
   */
  function renderCustomTileReport(): void {
    const { layers } = session.current()
    const placed = countPlacedTiles(layers)
    const isPainting = previewTool !== 'bind'
    const selected = resolveSelectedLayer()

    if (previewTool === 'place' && selectedTileIndex === UNBOUND) {
      setMessage('Pick a tile from the sheet to place.', 'error')
    }

    if (isPainting && selected?.kind === 'builtIn') {
      setMessage(
        `${BUILT_IN_LAYER_LABELS[selected.id]} is drawn from the level — select an art layer to paint on.`,
        'error',
      )
    } else if (
      isPainting &&
      selected?.kind === 'art' &&
      !isLayerVisible(selected.id)
    ) {
      setMessage(
        `${selected.name} is hidden — strokes will not show.`,
        'warning',
      )
    }

    if (placed === 0) {
      if (previewTool === 'recolor') {
        setMessage('No custom tiles to change yet.', 'warning')
      }

      return
    }

    const artLayers = layers.filter((layer) => layer.kind === 'art').length
    const tinted = countTinted(layers)

    setMessage(
      `${placed} custom ${placed === 1 ? 'tile' : 'tiles'} on ${artLayers} art ${artLayers === 1 ? 'layer' : 'layers'}${tinted > 0 ? `, ${tinted} inked` : ''}.`,
      'ok',
    )
  }

  /**
   * Top of the stack first, as every layer panel lists them: the row above is
   * drawn over the row below. Rebuilt from scratch on every redraw like the
   * role list, and for the same reason the name field being typed in is put
   * back as it was.
   */
  function renderLayerList(): void {
    const { layers } = session.current()
    const selected = resolveSelectedLayer()
    const focused = document.activeElement
    const typing =
      focused instanceof HTMLInputElement && focused.dataset.layerName
        ? {
            layerId: focused.dataset.layerName,
            text: focused.value,
            caret: focused.selectionStart,
          }
        : null

    layerList.replaceChildren()

    const button = (
      text: string,
      title: string,
      data: Record<string, string>,
      isPressed?: boolean,
      isDisabled?: boolean,
    ): HTMLButtonElement => {
      const element = document.createElement('button')
      element.type = 'button'
      element.textContent = text
      element.title = title
      Object.assign(element.dataset, data)

      if (isPressed !== undefined) {
        element.setAttribute('aria-pressed', String(isPressed))
      }

      element.disabled = isDisabled ?? false

      return element
    }

    for (let index = layers.length - 1; index >= 0; index--) {
      const layer = layers[index]
      const row = document.createElement('div')
      row.className = 'layer-row'
      row.dataset.layerSelect = layer.id
      row.classList.toggle('selected', layer.id === selected?.id)
      row.classList.toggle('hidden', !isLayerVisible(layer.id))

      const label =
        layer.kind === 'builtIn' ? BUILT_IN_LAYER_LABELS[layer.id] : layer.name

      row.append(
        button(
          hiddenLayerIds.has(layer.id) ? '○' : '●',
          `${hiddenLayerIds.has(layer.id) ? 'Show' : 'Hide'} ${label} in the preview`,
          { layerVisible: layer.id },
        ),
        button(
          'S',
          `Show ${label} alone`,
          { layerSolo: layer.id },
          soloLayerId === layer.id,
        ),
      )

      if (layer.kind === 'builtIn') {
        const name = document.createElement('span')
        name.className = 'layer-name'
        name.textContent = label
        name.title =
          'Built in — drawn from the level, so it can be moved but not painted'
        row.append(name)
      } else {
        const name = document.createElement('input')
        name.type = 'text'
        name.spellcheck = false
        name.value = layer.name
        name.dataset.layerName = layer.id
        name.setAttribute('aria-label', 'layer name')
        row.append(name)

        const count = document.createElement('span')
        count.className = 'layer-count'
        count.textContent = String(layer.tiles.size)
        count.title = 'Tiles placed on this layer'
        row.append(count)
      }

      row.append(
        button(
          '▲',
          `Move ${label} up`,
          { layerUp: layer.id },
          undefined,
          index === layers.length - 1,
        ),
        button(
          '▼',
          `Move ${label} down`,
          { layerDown: layer.id },
          undefined,
          index === 0,
        ),
      )

      if (layer.kind === 'art') {
        row.append(
          button('×', `Delete ${label} and its tiles`, {
            layerRemove: layer.id,
          }),
        )
      }

      layerList.append(row)
    }

    layerShowAllButton.disabled =
      soloLayerId === null && hiddenLayerIds.size === 0

    if (typing === null) {
      return
    }

    const restored = layerList.querySelector<HTMLInputElement>(
      `input[data-layer-name="${typing.layerId}"]`,
    )

    if (!restored) {
      return
    }

    restored.value = typing.text
    restored.focus()

    if (typing.caret !== null) {
      restored.setSelectionRange(typing.caret, typing.caret)
    }
  }

  function renderToolControls(): void {
    for (const button of previewTools.querySelectorAll('button[data-tool]')) {
      button.setAttribute(
        'aria-pressed',
        String(button.getAttribute('data-tool') === previewTool),
      )
    }

    for (const button of inkControls.querySelectorAll(
      'button[data-ink-mode]',
    )) {
      button.setAttribute(
        'aria-pressed',
        String(button.getAttribute('data-ink-mode') === ink.mode),
      )
    }
  }

  /**
   * The ground is the document's, so the controls are drawn from it rather than
   * from a copy kept here — which is also how they come back in step after an
   * undo, a reset, or a level loaded from XSB.
   *
   * The picker keeps its own colour when there is no ground, so clearing one and
   * picking again starts from the colour last chosen rather than from black. The
   * hex field is the one that says `none`, because it is the one that can be
   * empty — which is also why it is never written to while it has focus: half a
   * hex is a legitimate thing to be mid-way through typing.
   */
  function renderGroundControls(): void {
    const { groundColor } = session.current()

    groundClearButton.disabled = groundColor === null
    groundCopyButton.disabled = groundColor === null

    if (groundColor !== null) {
      groundColorInput.value = groundColor
    }

    if (document.activeElement !== groundHexInput) {
      groundHexInput.value = groundColor ?? ''
    }
  }

  /**
   * The ink has no `none`, so its field is simply the colour — but it is the
   * same deal otherwise: written from the ink unless the ink is what is being
   * typed into it.
   */
  function renderInkControls(): void {
    inkColorInput.value = ink.color

    if (document.activeElement !== inkHexInput) {
      inkHexInput.value = ink.color
    }
  }

  /**
   * The palettes made in colours mode, to copy a hex out of. Read on every
   * redraw rather than cached, so a palette added in the other panel is here on
   * the mode switch — the switch redraws the incoming mode.
   */
  function renderColorPalette(): void {
    const library = colorPalettes.current()
    const palette = resolveColorPalette(library, selectedPaletteId)
    selectedPaletteId = palette?.id ?? null

    paletteSelect.replaceChildren()
    paletteSelect.disabled = library.palettes.length === 0

    for (const entry of library.palettes) {
      const option = document.createElement('option')
      option.value = entry.id
      option.textContent = `${entry.name} (${entry.colors.length})`
      option.selected = entry.id === palette?.id
      paletteSelect.append(option)
    }

    if (library.palettes.length === 0) {
      const option = document.createElement('option')
      option.textContent = 'no palettes yet'
      paletteSelect.append(option)
    }

    renderSwatches(
      paletteSwatches,
      palette?.colors ?? [],
      PALETTE_SWATCH_ACTIONS,
      {
        selectedIndex: -1,
        emptyMessage:
          library.palettes.length === 0
            ? 'Make one in Colours mode.'
            : 'This palette has no colours.',
      },
    )
    renderPaletteNote()
  }

  /**
   * Its own line rather than the status report, because the report is rebuilt
   * from the skin on every redraw and this is about a colour: a "copied" would
   * not survive the next hover.
   */
  function renderPaletteNote(): void {
    paletteReport.replaceChildren()

    if (paletteNote === null) {
      return
    }

    const line = document.createElement('p')
    line.className = paletteNote.className
    line.textContent = paletteNote.message
    paletteReport.append(line)
  }

  function copyHex(color: string): void {
    void copyTextToClipboard(color).then((copied) => {
      paletteNote = {
        message: copied
          ? `Copied ${color} — paste it into ink or ground.`
          : `Could not reach the clipboard — ${color}`,
        className: copied ? 'ok' : 'error',
      }
      renderPaletteNote()
    })
  }

  function paintPreviewOnly(): void {
    paintPreview(session.current(), draft, sheetImage, {
      showSkinTiles,
      hiddenLayerIds,
      soloLayerId,
      hoverPosition,
      zoom: previewZoom.current(),
    })
  }

  function update(): void {
    persist()
    // Placing a custom tile is an edit to the level, so this panel has to save
    // the level slice too — it is no longer only level mode that changes it.
    levelAutosave.persist()
    paintPalette(
      sheetImage,
      draft.sheet,
      draft.isPixelated,
      selectedTileIndex,
      paletteZoom.current(),
    )
    renderToolControls()
    renderInkControls()
    renderGroundControls()
    renderTileBackgroundControls()
    renderColorPalette()
    paletteZoom.syncControls()
    previewZoom.syncControls()
    paintPreviewOnly()
    renderReport()
    renderCustomTileReport()
    renderLayerList()

    if (storageNote !== null) {
      setMessage(storageNote, 'warning')
    }

    if (levelAutosave.hasFailed()) {
      setMessage(
        'Custom tiles are not being saved — browser storage is unavailable.',
        'warning',
      )
    }

    renderRoleList()

    const canExport = sheetImage !== null && isSkinComplete(draft)
    atlasButton.disabled = !canExport
    manifestButton.disabled = !canExport
  }

  /**
   * Binding is one gesture that sets both halves of a column — the tile and the
   * ink it ships in — because that is what the author just chose in the sidebar.
   * The per-row ink button is how the colour is changed without the tile.
   */
  function assign(role: TileRole): void {
    if (!sheetImage || selectedTileIndex === UNBOUND) {
      return
    }

    draft = setRoleTint(
      bindRole(draft, role, selectedTileIndex),
      role,
      getInkFor(role),
    )
    update()
  }

  /**
   * The current ink as a role takes it: colour and mode from the ink, the
   * background kept from the role. The ink has no background of its own — it is
   * a property of the role's slot, set from its row, and a re-stamp or a rebind
   * should not quietly throw it away.
   */
  function getInkFor(role: TileRole): Tint {
    return { ...ink, background: draft.tints[role].background }
  }

  async function loadSheet(file: File): Promise<void> {
    try {
      const [loaded, dataUrl] = await Promise.all([
        createImageBitmap(file),
        readFileAsDataUrl(file),
      ])

      sheetImage = loaded
      sheetDataUrl = dataUrl
      // Tile indices only mean something against one grid, so a new sheet
      // starts from no bindings rather than art that silently moved. The
      // hand-placed tiles are indices into that same grid, so they go the same
      // way — undoably, since they are part of the level.
      draft = clearBindings(draft)
      session.eraseAllCustomTiles()
      selectedTileIndex = UNBOUND
      update()
    } catch {
      report.replaceChildren()
      setMessage(`Could not read ${file.name} as an image.`, 'error')
    }
  }

  /**
   * Reopening the editor. Unlike loading a sheet this keeps the bindings: the
   * stored image is byte for byte the one they were made against, so the
   * indices still point at the same art.
   */
  async function restoreSheet(dataUrl: string): Promise<void> {
    try {
      sheetImage = await readDataUrlAsImageBitmap(dataUrl)
    } catch {
      // Whatever was stored no longer decodes, so the bindings point at
      // nothing: drop both rather than show indices into a missing sheet.
      sheetDataUrl = null
      draft = clearBindings(draft)
    }

    update()
  }

  /**
   * Called after storage has been cleared; see level mode's `reset`. The custom
   * tiles are not cleared here: they belong to the level, and level mode's reset
   * replaces the whole document, which takes them with it.
   */
  function reset(): void {
    draft = createEmptySkinDraft()
    sheetImage = null
    sheetDataUrl = null
    selectedTileIndex = UNBOUND
    paletteZoom.reset()
    previewZoom.reset()
    previewTool = 'bind'
    selectedLayerId = null
    hiddenLayerIds = new Set()
    soloLayerId = null
    ink = NO_TINT
    selectedPaletteId = null
    paletteNote = null
    showSkinTiles = true
    showSkinTilesInput.checked = true
    hoverPosition = -1
    isEditingGround = false
    savedDraft = draft
    savedSheetDataUrl = sheetDataUrl
    storageNote = null
    // So that picking the same sheet again still fires a change event.
    fileInput.value = ''
    syncSheetInputs()
  }

  /**
   * Z for undo, as in level mode, because it is the same stack: placing custom
   * tiles is a level edit, and this panel is now a place they get made.
   */
  function handleKey(event: KeyboardEvent): boolean {
    const tool = TOOL_OF_KEY[event.key]

    if (tool) {
      selectTool(tool)

      return true
    }

    if (event.key.toLowerCase() === 'z' && session.undo()) {
      update()

      return true
    }

    return false
  }

  function readSheetSettings(): void {
    const next = setSheetSettings(draft, {
      tileWidth: Number(tileWidthInput.value),
      tileHeight: Number(tileHeightInput.value),
      margin: Number(marginInput.value),
      spacing: Number(spacingInput.value),
    })

    const hasResliced =
      next.sheet.tileWidth !== draft.sheet.tileWidth ||
      next.sheet.tileHeight !== draft.sheet.tileHeight ||
      next.sheet.margin !== draft.sheet.margin ||
      next.sheet.spacing !== draft.sheet.spacing

    draft = hasResliced ? clearBindings(next) : next

    if (hasResliced) {
      session.eraseAllCustomTiles()
      selectedTileIndex = UNBOUND
    }

    syncSheetInputs()
    update()
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]

    if (file) {
      void loadSheet(file)
    }
  })

  for (const input of [
    tileWidthInput,
    tileHeightInput,
    marginInput,
    spacingInput,
  ]) {
    input.addEventListener('change', readSheetSettings)
  }

  pixelatedInput.addEventListener('change', () => {
    draft = { ...draft, isPixelated: pixelatedInput.checked }
    update()
  })

  nameInput.addEventListener('input', () => {
    draft = { ...draft, name: nameInput.value }
  })

  // The name is the one edit that does not redraw anything, so it is the one
  // edit autosave has to be asked for by hand — on `change` rather than per
  // keystroke, because each save re-encodes the whole sheet with it.
  nameInput.addEventListener('change', persist)

  paletteCanvas.addEventListener('pointerdown', (event) => {
    if (!sheetImage) {
      return
    }

    const bounds = paletteCanvas.getBoundingClientRect()
    const grid = getSheetGrid(draft.sheet, sheetImage.width, sheetImage.height)
    const layout = computeSheetLayout(
      sheetImage.width,
      sheetImage.height,
      paletteView.clientWidth,
      paletteView.clientHeight,
      paletteZoom.current(),
    )
    const tileIndex = getTileIndexAtPixel(
      draft.sheet,
      grid,
      layout,
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    )

    if (tileIndex < 0) {
      return
    }

    selectedTileIndex = tileIndex
    update()
  })

  function getPositionFromPointer(event: PointerEvent): number {
    const editorDocument = session.current()
    // The bounds are the canvas's and the layout is the view's; see level
    // mode's twin of this function.
    const bounds = previewCanvas.getBoundingClientRect()
    const layout = computeGridLayout(
      editorDocument,
      previewView.clientWidth,
      previewView.clientHeight,
      previewZoom.current(),
    )

    return getPositionAtPixel(
      editorDocument,
      layout,
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    )
  }

  /**
   * Returns whether the document changed, so a drag only redraws when it did.
   * Reached only for the three placement tools: binding is a click, not a
   * stroke, and the pointer handler splits it off before here.
   */
  function applyPlacementTool(position: number): boolean {
    const layer = resolveSelectedLayer()

    // A built-in layer is drawn from the cells, so there is nothing in it to
    // paint — the report already says so.
    if (!layer || !getArtLayer(session.current(), layer.id)) {
      return false
    }

    if (previewTool === 'erase') {
      return session.eraseCustomTile(layer.id, position)
    }

    if (previewTool === 'recolor') {
      return session.recolorCustomTile(layer.id, position, ink)
    }

    return session.placeCustomTile(layer.id, position, selectedTileIndex, ink)
  }

  function selectTool(tool: PreviewTool): void {
    previewTool = tool
    update()
  }

  previewCanvas.addEventListener('pointerdown', (event) => {
    const position = getPositionFromPointer(event)

    if (position < 0) {
      return
    }

    hoverPosition = position

    // Binding is one click on one cell — it changes every cell of that role —
    // so there is nothing to drag. The placement tools are a stroke, exactly
    // like painting the level.
    if (previewTool === 'bind') {
      assign(getTopRoleAtPosition(session.current(), position))

      return
    }

    event.preventDefault()
    isPlacing = true
    previewCanvas.setPointerCapture(event.pointerId)
    session.beginStroke()
    applyPlacementTool(position)
    update()
  })

  /**
   * The hover marker is view state on one canvas, so moving the pointer repaints
   * that canvas and nothing else. The full `update` rebuilds the role list and
   * repaints the sheet, both of which carry the sheet's data url around — far
   * too much to do per pointer move, which is what level mode gets away with
   * only because it has one canvas and a kilobyte of state.
   */
  previewCanvas.addEventListener('pointermove', (event) => {
    const position = getPositionFromPointer(event)
    const hasMoved = position !== hoverPosition
    hoverPosition = position

    if (!hasMoved) {
      return
    }

    // Only on a move onto a new cell, never on every event: every placement
    // tool is idempotent, so this only saves the redraw.
    if (isPlacing && applyPlacementTool(position)) {
      update()

      return
    }

    paintPreviewOnly()
  })

  previewCanvas.addEventListener('pointerup', () => {
    isPlacing = false
  })

  previewCanvas.addEventListener('pointerleave', () => {
    isPlacing = false
    hoverPosition = -1
    paintPreviewOnly()
  })

  previewTools.addEventListener('click', (event) => {
    const tool = (event.target as Element)
      .closest('button[data-tool]')
      ?.getAttribute('data-tool')

    if (tool) {
      selectTool(tool as PreviewTool)
    }
  })

  /**
   * One listener for the whole list, like the role list: the rows are rebuilt
   * on every redraw, so a listener on each would be thrown away with it. The
   * row itself selects; the buttons in it do their own thing and do not.
   */
  layerList.addEventListener('click', (event) => {
    const target = event.target as Element
    const data = target.closest<HTMLButtonElement>('button')?.dataset

    if (data?.layerVisible) {
      const id = data.layerVisible

      if (hiddenLayerIds.has(id)) {
        hiddenLayerIds.delete(id)
      } else {
        hiddenLayerIds.add(id)
      }

      soloLayerId = null
      update()

      return
    }

    if (data?.layerSolo) {
      soloLayerId = soloLayerId === data.layerSolo ? null : data.layerSolo
      update()

      return
    }

    if (data?.layerUp || data?.layerDown) {
      session.moveLayer(
        (data.layerUp ?? data.layerDown)!,
        data.layerUp ? 1 : -1,
      )
      update()

      return
    }

    if (data?.layerRemove) {
      session.removeArtLayer(data.layerRemove)
      update()

      return
    }

    const row = target.closest<HTMLElement>('[data-layer-select]')

    if (
      row?.dataset.layerSelect &&
      row.dataset.layerSelect !== selectedLayerId
    ) {
      selectedLayerId = row.dataset.layerSelect
      update()
    }
  })

  // On `change` rather than per keystroke, so a rename is one undo entry. Enter
  // commits it the way it does every other field in the editor.
  layerList.addEventListener('change', (event) => {
    const input = event.target

    if (!(input instanceof HTMLInputElement) || !input.dataset.layerName) {
      return
    }

    const name = input.value.trim()

    if (name === '' || !session.renameArtLayer(input.dataset.layerName, name)) {
      input.value =
        getArtLayer(session.current(), input.dataset.layerName)?.name ?? ''
    }

    update()
  })

  layerList.addEventListener('keydown', commitFieldOnEnter)

  layerAddButton.addEventListener('click', () => {
    const id = getNextArtLayerId(session.current())

    if (session.addArtLayer(resolveSelectedLayer()?.id ?? null)) {
      selectedLayerId = id
      update()
    }
  })

  layerShowAllButton.addEventListener('click', () => {
    hiddenLayerIds = new Set()
    soloLayerId = null
    update()
  })

  /**
   * The one control whose value nothing on screen is drawn from: a role row
   * shows its *own* ink, not the current one, so changing the picker repaints
   * nothing until it is applied. Which is just as well — a colour input fires
   * `input` continuously while it is dragged, and `update()` rebuilds fourteen
   * role rows.
   *
   * The hex field beside it is the way a colour gets *in* from somewhere else —
   * a palette, an art program, a screenshot someone picked a colour out of —
   * and the way it gets back out, which the copy button is for. Only the picker
   * is moved while it parses: the field keeps whatever was typed, because
   * correcting half a hex under the caret is not help.
   */
  inkColorInput.addEventListener('input', () => {
    ink = readTint({ color: inkColorInput.value, mode: ink.mode })
    inkHexInput.value = ink.color
  })

  inkHexInput.addEventListener('input', () => {
    const color = parseHexColor(inkHexInput.value)

    if (color !== null) {
      ink = readTint({ color, mode: ink.mode })
      inkColorInput.value = color
    }
  })

  // On the way out the field becomes the ink, so an abandoned half-hex does not
  // sit there looking like the colour the next bind would use.
  inkHexInput.addEventListener('change', () => {
    inkHexInput.value = ink.color
  })

  inkHexInput.addEventListener('keydown', commitFieldOnEnter)

  inkCopyButton.addEventListener('click', () => copyHex(ink.color))

  /**
   * The ground colour, which is the level's rather than the skin's — it is this
   * level's backdrop, it means the same against any sheet, and a level published
   * with an unfinished skin still has it. So it goes through the session like a
   * placement does: on the undo stack, and saved by the `level` slice.
   *
   * It sits by the ink all the same, because what it is for is what shows
   * through a transparent tile.
   */
  function editGround(groundColor: string | null): void {
    if (!isEditingGround) {
      session.beginStroke()
      isEditingGround = true
    }

    if (session.setGroundColor(groundColor)) {
      update()
    }
  }

  groundColorInput.addEventListener('input', () => {
    editGround(readHexColor(groundColorInput.value))
  })

  groundColorInput.addEventListener('change', () => {
    isEditingGround = false
  })

  /**
   * Typed or pasted hex, live — so the board behind it changes as the colour
   * arrives, which is the whole reason to paste one here rather than drag the
   * picker to it. Emptying the field is how the ground is cleared by typing,
   * the same thing the × does.
   */
  groundHexInput.addEventListener('input', () => {
    const text = groundHexInput.value.trim()

    if (text === '') {
      editGround(NO_GROUND_COLOR)

      return
    }

    const color = parseHexColor(text)

    if (color !== null) {
      groundColorInput.value = color
      editGround(color)
    }
  })

  // One undo entry per visit, so the field's own gesture ends the stroke the
  // way the picker's closing does — and the field squares up with the ground,
  // written here because `change` also fires on Enter, which does not blur and
  // so would be refused by the guard in `renderGroundControls`.
  groundHexInput.addEventListener('change', () => {
    isEditingGround = false
    groundHexInput.value = session.current().groundColor ?? ''
  })

  groundHexInput.addEventListener('keydown', commitFieldOnEnter)

  groundCopyButton.addEventListener('click', () => {
    const { groundColor } = session.current()

    if (groundColor !== null) {
      copyHex(groundColor)
    }
  })

  groundClearButton.addEventListener('click', () => {
    isEditingGround = false
    session.beginStroke()

    if (session.setGroundColor(NO_GROUND_COLOR)) {
      update()
    }
  })

  /**
   * The skin-wide tile background. The field is left alone while it has the
   * caret, for the same reason the role fields are: a shorthand commits on the
   * way past, and redrawing it would replace what is being typed.
   */
  function renderTileBackgroundControls(): void {
    const { background } = draft
    tileBackgroundSwatch.textContent = background === null ? '□' : '■'
    tileBackgroundSwatch.style.color = background ?? ''
    tileBackgroundClearButton.disabled = background === null

    if (document.activeElement !== tileBackgroundHexInput) {
      tileBackgroundHexInput.value = background ?? ''
    }
  }

  // Live like the role fields: empty is none, a hex applies, anything else is
  // still being typed and changes nothing yet.
  tileBackgroundHexInput.addEventListener('input', () => {
    const text = tileBackgroundHexInput.value.trim()
    const background = text === '' ? null : parseHexColor(text)

    if (text !== '' && background === null) {
      return
    }

    draft = setSkinBackground(draft, background)
    update()
  })

  tileBackgroundHexInput.addEventListener('change', () => {
    tileBackgroundHexInput.value = draft.background ?? ''
  })

  tileBackgroundHexInput.addEventListener('keydown', commitFieldOnEnter)

  tileBackgroundClearButton.addEventListener('click', () => {
    draft = setSkinBackground(draft, null)
    update()
  })

  paletteSelect.addEventListener('change', () => {
    selectedPaletteId = paletteSelect.value
    paletteNote = null
    renderColorPalette()
  })

  paletteSwatches.addEventListener('click', (event) => {
    const click = readSwatchClick(event.target as Element)
    const palette = resolveColorPalette(
      colorPalettes.current(),
      selectedPaletteId,
    )

    if (click === null || palette === null) {
      return
    }

    // Both actions a row offers are the same one: the chip is a big target for
    // the copy the button spells out.
    copyHex(palette.colors[click.index])
  })

  inkControls.addEventListener('click', (event) => {
    const mode = (event.target as Element)
      .closest('button[data-ink-mode]')
      ?.getAttribute('data-ink-mode')

    if (mode) {
      ink = readTint({ color: ink.color, mode })
      update()
    }
  })

  showSkinTilesInput.addEventListener('change', () => {
    showSkinTiles = showSkinTilesInput.checked
    update()
  })

  /**
   * A hex straight onto one role, which is the short way round from a palette:
   * copy it there, paste it here, with no trip through the ink picker and no
   * second click to stamp it.
   *
   * The role's mode is left alone — that is the tile's business, not the
   * colour's, and a flat-inked stencil stays flat when it is recoloured. The
   * stamp button beside it is still how a mode is changed, because it carries
   * the whole ink.
   */
  roleList.addEventListener('input', (event) => {
    const input = event.target

    if (!(input instanceof HTMLInputElement) || !input.dataset.roleHex) {
      return
    }

    const role = input.dataset.roleHex as TileRole
    const color = parseHexColor(input.value)

    if (color === null) {
      return
    }

    draft = setRoleTint(draft, role, { ...draft.tints[role], color })
    update()
  })

  /**
   * The background behind a role's tile: a hex fills its transparent pixels,
   * an empty field takes the fill away again. Anything else is a hex still
   * being typed and changes nothing yet.
   */
  roleList.addEventListener('input', (event) => {
    const input = event.target

    if (!(input instanceof HTMLInputElement) || !input.dataset.roleBackground) {
      return
    }

    const role = input.dataset.roleBackground as TileRole
    const text = input.value.trim()
    const background = text === '' ? null : parseHexColor(text)

    if (text !== '' && background === null) {
      return
    }

    draft = setRoleTint(draft, role, { ...draft.tints[role], background })
    update()
  })

  // On the way out the field becomes the role's colour, so an abandoned
  // half-hex does not sit there looking like what the tile is painted with.
  // Written here rather than left to the redraw, because `change` also fires on
  // Enter, which does not blur — and the redraw's job is to preserve the text of
  // whatever still has the caret.
  roleList.addEventListener('change', (event) => {
    const input = event.target

    if (!(input instanceof HTMLInputElement)) {
      return
    }

    if (input.dataset.roleHex) {
      input.value = draft.tints[input.dataset.roleHex as TileRole].color
    } else if (input.dataset.roleBackground) {
      input.value =
        draft.tints[input.dataset.roleBackground as TileRole].background ?? ''
    } else {
      return
    }

    update()
  })

  roleList.addEventListener('keydown', commitFieldOnEnter)

  roleList.addEventListener('click', (event) => {
    const target = event.target as Element
    const copied = target
      .closest('button[data-role-copy]')
      ?.getAttribute('data-role-copy')

    if (copied) {
      copyHex(draft.tints[copied as TileRole].color)

      return
    }

    const cleared = target
      .closest('button[data-clear]')
      ?.getAttribute('data-clear')

    if (cleared) {
      draft = unbindRole(draft, cleared as TileRole)
      update()

      return
    }

    const inked = target.closest('button[data-ink]')?.getAttribute('data-ink')

    if (inked) {
      draft = setRoleTint(
        draft,
        inked as TileRole,
        getInkFor(inked as TileRole),
      )
      update()

      return
    }

    const role = target.closest('button[data-role]')?.getAttribute('data-role')

    if (role) {
      assign(role as TileRole)
    }
  })

  function addRoleColorsMessage(message: string, className: string): void {
    const line = document.createElement('p')
    line.className = className
    line.textContent = message
    roleColorsReport.append(line)
  }

  roleColorsImportButton.addEventListener('click', () => {
    roleColorsReport.replaceChildren()
    roleColorsDialog.showModal()
    roleColorsText.focus()
  })

  /**
   * Every named role that is bound takes the colour and keeps its mode — the
   * same deal as typing into its hex field. An unbound role is skipped rather
   * than tinted, because binding stamps the current ink over whatever it had.
   * The ground is the level's, so it goes through the session as one undo
   * entry of its own.
   *
   * A clean import closes the dialog; anything skipped keeps it open with the
   * reasons, so the author sees what did not land and can fix the text.
   */
  roleColorsApplyButton.addEventListener('click', () => {
    roleColorsReport.replaceChildren()

    const parsed = parseRoleColors(roleColorsText.value)

    if (parsed === null) {
      addRoleColorsMessage('That is not a JSON object.', 'error')

      return
    }

    const unbound: TileRole[] = []
    let applied = 0

    for (const [role, color] of parsed.colors) {
      if (!isRoleBound(draft, role)) {
        unbound.push(role)
        continue
      }

      draft = setRoleTint(draft, role, { ...draft.tints[role], color })
      applied += 1
    }

    if (parsed.ground !== null) {
      session.beginStroke()
      session.setGroundColor(parsed.ground)
      isEditingGround = false
      applied += 1
    }

    update()

    if (
      parsed.unknownKeys.length === 0 &&
      parsed.invalidKeys.length === 0 &&
      unbound.length === 0 &&
      applied > 0
    ) {
      roleColorsDialog.close()

      return
    }

    addRoleColorsMessage(
      `Applied ${applied} ${applied === 1 ? 'colour' : 'colours'}.`,
      applied === 0 ? 'warning' : 'ok',
    )

    if (unbound.length > 0) {
      addRoleColorsMessage(
        `Skipped, not bound: ${unbound.map((role) => ROLE_LABELS[role]).join(', ')}.`,
        'warning',
      )
    }

    if (parsed.invalidKeys.length > 0) {
      addRoleColorsMessage(
        `Not a hex: ${parsed.invalidKeys.join(', ')}.`,
        'error',
      )
    }

    if (parsed.unknownKeys.length > 0) {
      addRoleColorsMessage(
        `Unknown keys: ${parsed.unknownKeys.join(', ')}.`,
        'error',
      )
    }
  })

  // Built from the parser's own table, so the help cannot list a key the
  // import does not take.
  const groundRow = roleColorsKeys.insertRow()
  groundRow.insertCell().textContent = GROUND_KEY
  groundRow.insertCell().textContent = 'ground — behind the level'

  for (const { role, keys } of ROLE_COLOR_KEYS) {
    const row = roleColorsKeys.insertRow()
    row.insertCell().textContent = keys.join(', ')
    row.insertCell().textContent = ROLE_LABELS[role]
  }

  roleColorsHelpButton.addEventListener('click', () =>
    roleColorsHelpDialog.showModal(),
  )

  /**
   * Which atlas column each hand-placed cell takes. Worked out from the sheet
   * the indices were picked against, so the atlas packer and `tiles.json` are
   * handed the same answer rather than each deriving one.
   */
  function getLayerPacking(image: ImageBitmap): LayerPacking {
    return packLayers(
      draft,
      session.current().layers,
      getSheetGrid(draft.sheet, image.width, image.height).tileCount,
    )
  }

  atlasButton.addEventListener('click', () => {
    if (!sheetImage) {
      return
    }

    const canvas = packSkinAtlas(
      draft,
      sheetImage,
      getLayerPacking(sheetImage).columns,
    )
    canvas.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, `${toSkinFileName(draft.name)}.png`)
      }
    }, 'image/png')
  })

  manifestButton.addEventListener('click', () => {
    const customColumns = sheetImage
      ? getLayerPacking(sheetImage).columns.length
      : 0
    const size = getAtlasSize(draft, customColumns)
    downloadBlob(
      new Blob([formatSkinManifest(draft)], { type: 'application/json' }),
      `${toSkinFileName(draft.name)}.json`,
    )
    report.replaceChildren()
    setMessage(`Atlas is ${size.width}×${size.height} px.`, 'ok')
  })

  /**
   * The tiles for a level bundle, or null when there is no skin to ship — no
   * sheet loaded, or a required role still unbound. Exactly the condition that
   * disables the two download buttons, so what gets published is what the
   * sidebar says is exportable.
   *
   * The custom tiles ride with it rather than with the level, because what they
   * name is columns in this atlas: without the skin there is nothing for them to
   * index, so they cannot be shipped separately from it.
   */
  function getSkinExport(): SkinExport | null {
    if (!sheetImage || !isSkinComplete(draft)) {
      return null
    }

    const editorDocument = session.current()
    const packing = getLayerPacking(sheetImage)

    return {
      manifest: formatSkinManifest(draft),
      atlasDataUrl: packSkinAtlas(draft, sheetImage, packing.columns).toDataURL(
        'image/png',
      ),
      layers: !hasLayersFile(packing)
        ? null
        : formatLayersFile(
            editorDocument.width,
            editorDocument.height,
            packing,
          ),
    }
  }

  return { update, reset, handleKey, getSkinExport }
}
