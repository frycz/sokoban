import type { CustomTileMode } from '../render/custom-tiles'
import type { LevelAutosave } from './autosave'
import {
  requireElement,
  downloadBlob,
  readDataUrlAsImageBitmap,
  readFileAsDataUrl,
  type EditorMode,
} from './dom'
import { computeGridLayout, getPositionAtPixel } from './layout'
import type { SkinExport } from './publish'
import type { Session } from './session'
import { readStoredText, writeStoredText } from './storage'
import { createZoomControl } from './zoom'
import { decodeStoredSkin, encodeStoredSkin } from './stored-state'
import { getAtlasSize, packSkinAtlas } from './skin/atlas'
import {
  countOverwrites,
  formatCustomTilesFile,
  packCustomTiles,
  type CustomTilePacking,
} from './skin/custom-tiles'
import { createPalettePainter } from './skin/palette'
import { createSkinPreviewPainter } from './skin/preview'
import { ROLE_LABELS, getTopRoleAtPosition, type TileRole } from './skin/roles'
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
  isRoleBound,
  isSkinComplete,
  setSheetSettings,
  toSkinFileName,
  unbindRole,
  type SkinDraft,
} from './skin/skin'

const THUMBNAIL_SIZE = 24

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
 * it: one cell, one tile, whatever the skin would have drawn there.
 *
 * `swap` is how the on-top / overwrite choice is changed after the fact. It
 * exists as its own tool rather than being folded into `place` because
 * re-stamping a cell to change its mode would need the original tile still
 * selected, and would quietly replace the art if it were not.
 */
type PreviewTool = 'bind' | 'place' | 'erase' | 'swap'

const TOOL_OF_KEY: Record<string, PreviewTool | undefined> = {
  '1': 'bind',
  '2': 'place',
  '3': 'erase',
  '4': 'swap',
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
 */
export function createSkinMode(
  session: Session,
  levelAutosave: LevelAutosave,
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
  const previewOptions = requireElement<HTMLElement>('#preview-options')
  const showSkinTilesInput =
    requireElement<HTMLInputElement>('#show-skin-tiles')
  const showCustomTilesInput =
    requireElement<HTMLInputElement>('#show-custom-tiles')
  const report = requireElement<HTMLElement>('#skin-report')
  const roleList = requireElement<HTMLElement>('#role-list')
  const atlasButton = requireElement<HTMLButtonElement>('#export-atlas')
  const manifestButton = requireElement<HTMLButtonElement>('#export-manifest')

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
  // What the place tool writes. Each cell keeps its own copy, so changing this
  // affects the next placement and never one already made — those are the swap
  // tool's job.
  let placeMode: CustomTileMode = 'onTop'
  let showSkinTiles = true
  let showCustomTiles = true
  let hoverPosition = -1
  let isPlacing = false
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

  function renderRoleList(): void {
    const grid = sheetImage
      ? getSheetGrid(draft.sheet, sheetImage.width, sheetImage.height)
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

        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.role = role

        const thumbnail = document.createElement('span')
        thumbnail.className = 'tile'

        if (sheetImage && sheetDataUrl && grid && tileIndex !== UNBOUND) {
          const rect = getSourceTileRect(draft.sheet, grid, tileIndex)

          if (rect.width > 0) {
            const scale = THUMBNAIL_SIZE / rect.width
            thumbnail.style.backgroundImage = `url("${sheetDataUrl}")`
            thumbnail.style.backgroundSize = `${sheetImage.width * scale}px ${sheetImage.height * scale}px`
            thumbnail.style.backgroundPosition = `${-rect.x * scale}px ${-rect.y * scale}px`
          }
        }

        const label = document.createElement('span')
        label.textContent = ROLE_LABELS[role]

        const bound = document.createElement('span')
        bound.className = 'bound'
        bound.textContent = tileIndex === UNBOUND ? 'unbound' : `#${tileIndex}`

        button.append(thumbnail, label, bound)
        row.append(button)

        if (isRoleBound(draft, role)) {
          const clear = document.createElement('button')
          clear.type = 'button'
          clear.className = 'clear'
          clear.dataset.clear = role
          clear.title = `Unbind ${ROLE_LABELS[role]}`
          clear.textContent = '×'
          row.append(clear)
        }

        roleList.append(row)
      }
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
   * The hand-placed tiles, said in the sidebar rather than only drawn, because
   * the two visibility switches mean the preview can be showing none of them.
   */
  function renderCustomTileReport(): void {
    const { customTiles } = session.current()
    const placed = customTiles.size

    if (previewTool === 'place' && selectedTileIndex === UNBOUND) {
      setMessage('Pick a tile from the sheet to place.', 'error')
    }

    if (placed === 0) {
      if (previewTool === 'swap') {
        setMessage('No custom tiles to swap yet.', 'warning')
      }

      return
    }

    const overwrites = countOverwrites(customTiles)

    setMessage(
      `${placed} custom ${placed === 1 ? 'tile' : 'tiles'} placed, ${overwrites} overwriting the skin${showCustomTiles ? '' : ' — hidden'}.`,
      showCustomTiles ? 'ok' : 'warning',
    )
  }

  function renderToolControls(): void {
    for (const button of previewTools.querySelectorAll('button[data-tool]')) {
      button.setAttribute(
        'aria-pressed',
        String(button.getAttribute('data-tool') === previewTool),
      )
    }

    for (const button of previewOptions.querySelectorAll(
      'button[data-place-mode]',
    )) {
      button.setAttribute(
        'aria-pressed',
        String(button.getAttribute('data-place-mode') === placeMode),
      )
    }
  }

  function paintPreviewOnly(): void {
    paintPreview(session.current(), draft, sheetImage, {
      showSkinTiles,
      showCustomTiles,
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
    paletteZoom.syncControls()
    previewZoom.syncControls()
    paintPreviewOnly()
    renderReport()
    renderCustomTileReport()

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

  function assign(role: TileRole): void {
    if (!sheetImage || selectedTileIndex === UNBOUND) {
      return
    }

    draft = bindRole(draft, role, selectedTileIndex)
    update()
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
    placeMode = 'onTop'
    showSkinTiles = true
    showCustomTiles = true
    showSkinTilesInput.checked = true
    showCustomTilesInput.checked = true
    hoverPosition = -1
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
    if (previewTool === 'erase') {
      return session.eraseCustomTile(position)
    }

    if (previewTool === 'swap') {
      return session.swapCustomTileMode(position)
    }

    return session.placeCustomTile(position, selectedTileIndex, placeMode)
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

    // Only on a move onto a new cell, never on every event. Placing and erasing
    // are idempotent and would not have cared, but swapping a mode is not: a
    // pointer trembling inside one cell would flip it back and forth.
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

  previewOptions.addEventListener('click', (event) => {
    const mode = (event.target as Element)
      .closest('button[data-place-mode]')
      ?.getAttribute('data-place-mode')

    if (mode) {
      placeMode = mode as CustomTileMode
      update()
    }
  })

  showSkinTilesInput.addEventListener('change', () => {
    showSkinTiles = showSkinTilesInput.checked
    update()
  })

  showCustomTilesInput.addEventListener('change', () => {
    showCustomTiles = showCustomTilesInput.checked
    update()
  })

  roleList.addEventListener('click', (event) => {
    const target = event.target as Element
    const cleared = target
      .closest('button[data-clear]')
      ?.getAttribute('data-clear')

    if (cleared) {
      draft = unbindRole(draft, cleared as TileRole)
      update()

      return
    }

    const role = target.closest('button[data-role]')?.getAttribute('data-role')

    if (role) {
      assign(role as TileRole)
    }
  })

  /**
   * Which atlas column each hand-placed cell takes. Worked out from the sheet
   * the indices were picked against, so the atlas packer and `tiles.json` are
   * handed the same answer rather than each deriving one.
   */
  function getCustomTilePacking(image: ImageBitmap): CustomTilePacking {
    return packCustomTiles(
      draft,
      session.current().customTiles,
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
      getCustomTilePacking(sheetImage).sheetTileIndices,
    )
    canvas.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, `${toSkinFileName(draft.name)}.png`)
      }
    }, 'image/png')
  })

  manifestButton.addEventListener('click', () => {
    const customColumns = sheetImage
      ? getCustomTilePacking(sheetImage).sheetTileIndices.length
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
    const packing = getCustomTilePacking(sheetImage)

    return {
      manifest: formatSkinManifest(draft),
      atlasDataUrl: packSkinAtlas(
        draft,
        sheetImage,
        packing.sheetTileIndices,
      ).toDataURL('image/png'),
      customTiles:
        packing.placementOfPosition.size === 0
          ? null
          : formatCustomTilesFile(
              editorDocument.width,
              editorDocument.height,
              packing,
            ),
    }
  }

  return { update, reset, handleKey, getSkinExport }
}
