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
import { decodeStoredSkin, encodeStoredSkin } from './stored-state'
import { getAtlasSize, packSkinAtlas } from './skin/atlas'
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
 * Multiples of the fit-to-view scale, so `1` always shows the whole sheet
 * whatever its size and the steps above it are what pan around.
 */
const ZOOM_STEPS: readonly number[] = [1, 2, 3, 4, 6, 8, 12, 16]

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
 * Skin mode plus the one thing outside it that needs the skin: publishing a
 * level bundle, which is both halves of the editor at once. The draft and the
 * loaded sheet stay in this closure — `getSkinExport` hands out the packed
 * result, not the state.
 */
export type SkinMode = EditorMode & {
  readonly getSkinExport: () => SkinExport | null
}

export function createSkinMode(session: Session): SkinMode {
  const fileInput = requireElement<HTMLInputElement>('#sheet-file')
  const tileWidthInput = requireElement<HTMLInputElement>('#tile-width')
  const tileHeightInput = requireElement<HTMLInputElement>('#tile-height')
  const marginInput = requireElement<HTMLInputElement>('#sheet-margin')
  const spacingInput = requireElement<HTMLInputElement>('#sheet-spacing')
  const pixelatedInput = requireElement<HTMLInputElement>('#pixelated')
  const nameInput = requireElement<HTMLInputElement>('#skin-name')
  const paletteView = requireElement<HTMLElement>('#palette-view')
  const paletteCanvas = requireElement<HTMLCanvasElement>('#sheet-palette')
  const zoomOutButton = requireElement<HTMLButtonElement>('#zoom-out')
  const zoomInButton = requireElement<HTMLButtonElement>('#zoom-in')
  const zoomLevel = requireElement<HTMLElement>('#zoom-level')
  const previewCanvas = requireElement<HTMLCanvasElement>('#skin-preview')
  const report = requireElement<HTMLElement>('#skin-report')
  const roleList = requireElement<HTMLElement>('#role-list')
  const atlasButton = requireElement<HTMLButtonElement>('#export-atlas')
  const manifestButton = requireElement<HTMLButtonElement>('#export-manifest')

  const paintPalette = createPalettePainter(paletteView, paletteCanvas)
  const paintPreview = createSkinPreviewPainter(previewCanvas)

  const stored = decodeStoredSkin(readStoredText('skin'))

  let draft: SkinDraft = stored?.draft ?? createEmptySkinDraft()
  let sheetImage: ImageBitmap | null = null
  let sheetDataUrl: string | null = stored?.sheetDataUrl ?? null
  let selectedTileIndex = UNBOUND
  // A view setting, not part of the skin, so it is not stored with the draft.
  let paletteZoom = 1
  // As in level mode: the draft came out of storage, so the two start in step
  // and nothing is written back until the draft actually differs.
  let savedSkin = encodeStoredSkin(draft, sheetDataUrl)
  let storageNote: string | null = null

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
    const text = encodeStoredSkin(draft, sheetDataUrl)

    if (text === savedSkin) {
      return
    }

    savedSkin = text

    if (writeStoredText('skin', text)) {
      storageNote = null

      return
    }

    // The sheet is what makes the record big, and bindings mean nothing without
    // it, so fall back to storing the settings alone rather than nothing.
    const withoutSheet = encodeStoredSkin(clearBindings(draft), null)
    savedSkin = withoutSheet
    storageNote = writeStoredText('skin', withoutSheet)
      ? 'Sheet too large for storage — settings are saved, bindings are not.'
      : 'Not being saved — browser storage is unavailable.'
  }

  function renderZoomControls(): void {
    zoomLevel.textContent = paletteZoom === 1 ? 'fit' : `${paletteZoom}×`
    zoomOutButton.disabled =
      sheetImage === null || paletteZoom === ZOOM_STEPS[0]
    zoomInButton.disabled =
      sheetImage === null || paletteZoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]
  }

  function update(): void {
    persist()
    paintPalette(
      sheetImage,
      draft.sheet,
      draft.isPixelated,
      selectedTileIndex,
      paletteZoom,
    )
    renderZoomControls()
    paintPreview(session.current(), draft, sheetImage)
    renderReport()

    if (storageNote !== null) {
      setMessage(storageNote, 'warning')
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

  /**
   * Steps the zoom, keeping whatever was in the middle of the view in the
   * middle of it — zooming in on a corner of a big sheet otherwise lands
   * somewhere else entirely. The browser clamps the scroll offsets for us.
   */
  function zoomBy(steps: number): void {
    const next = ZOOM_STEPS[ZOOM_STEPS.indexOf(paletteZoom) + steps]

    if (next === undefined) {
      return
    }

    const anchorX =
      (paletteView.scrollLeft + paletteView.clientWidth / 2) /
      Math.max(paletteCanvas.clientWidth, 1)
    const anchorY =
      (paletteView.scrollTop + paletteView.clientHeight / 2) /
      Math.max(paletteCanvas.clientHeight, 1)

    paletteZoom = next
    update()

    paletteView.scrollLeft =
      anchorX * paletteCanvas.clientWidth - paletteView.clientWidth / 2
    paletteView.scrollTop =
      anchorY * paletteCanvas.clientHeight - paletteView.clientHeight / 2
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
      // starts from no bindings rather than art that silently moved.
      draft = clearBindings(draft)
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

  /** Called after storage has been cleared; see level mode's `reset`. */
  function reset(): void {
    draft = createEmptySkinDraft()
    sheetImage = null
    sheetDataUrl = null
    selectedTileIndex = UNBOUND
    paletteZoom = 1
    savedSkin = encodeStoredSkin(draft, sheetDataUrl)
    storageNote = null
    // So that picking the same sheet again still fires a change event.
    fileInput.value = ''
    syncSheetInputs()
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
      paletteZoom,
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

  zoomOutButton.addEventListener('click', () => {
    zoomBy(-1)
  })

  zoomInButton.addEventListener('click', () => {
    zoomBy(1)
  })

  // A plain wheel scrolls the zoomed sheet, as it does anywhere else; the
  // modifier is what the browser's own page zoom uses, so it is the gesture
  // already in people's hands.
  paletteView.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) {
        return
      }

      event.preventDefault()

      if (event.deltaY !== 0) {
        zoomBy(event.deltaY < 0 ? 1 : -1)
      }
    },
    { passive: false },
  )

  previewCanvas.addEventListener('pointerdown', (event) => {
    const editorDocument = session.current()
    const bounds = previewCanvas.getBoundingClientRect()
    const layout = computeGridLayout(
      editorDocument,
      previewCanvas.clientWidth,
      previewCanvas.clientHeight,
    )
    const position = getPositionAtPixel(
      editorDocument,
      layout,
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    )

    if (position < 0) {
      return
    }

    assign(getTopRoleAtPosition(editorDocument, position))
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

  atlasButton.addEventListener('click', () => {
    if (!sheetImage) {
      return
    }

    const canvas = packSkinAtlas(draft, sheetImage)
    canvas.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, `${toSkinFileName(draft.name)}.png`)
      }
    }, 'image/png')
  })

  manifestButton.addEventListener('click', () => {
    const size = getAtlasSize(draft)
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
   */
  function getSkinExport(): SkinExport | null {
    if (!sheetImage || !isSkinComplete(draft)) {
      return null
    }

    return {
      manifest: formatSkinManifest(draft),
      atlasDataUrl: packSkinAtlas(draft, sheetImage).toDataURL('image/png'),
    }
  }

  return { update, reset, getSkinExport }
}
