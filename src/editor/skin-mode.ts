import { requireElement, downloadBlob, type EditorMode } from './dom'
import { computeGridLayout, getPositionAtPixel } from './layout'
import type { Session } from './session'
import { getAtlasSize, packSkinAtlas } from './skin/atlas'
import { createPalettePainter } from './skin/palette'
import { createSkinPreviewPainter } from './skin/preview'
import { ROLE_LABELS, getTopRoleAtPosition, type TileRole } from './skin/roles'
import {
  computeSheetLayout,
  getSheetGrid,
  getSourceTileRect,
  getTileIndexAtPixel,
} from './skin/sheet'
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

export function createSkinMode(session: Session): EditorMode {
  const fileInput = requireElement<HTMLInputElement>('#sheet-file')
  const tileWidthInput = requireElement<HTMLInputElement>('#tile-width')
  const tileHeightInput = requireElement<HTMLInputElement>('#tile-height')
  const marginInput = requireElement<HTMLInputElement>('#sheet-margin')
  const spacingInput = requireElement<HTMLInputElement>('#sheet-spacing')
  const pixelatedInput = requireElement<HTMLInputElement>('#pixelated')
  const nameInput = requireElement<HTMLInputElement>('#skin-name')
  const paletteCanvas = requireElement<HTMLCanvasElement>('#sheet-palette')
  const previewCanvas = requireElement<HTMLCanvasElement>('#skin-preview')
  const report = requireElement<HTMLElement>('#skin-report')
  const roleList = requireElement<HTMLElement>('#role-list')
  const atlasButton = requireElement<HTMLButtonElement>('#export-atlas')
  const manifestButton = requireElement<HTMLButtonElement>('#export-manifest')

  const paintPalette = createPalettePainter(paletteCanvas)
  const paintPreview = createSkinPreviewPainter(previewCanvas)

  let draft: SkinDraft = createEmptySkinDraft()
  let sheetImage: ImageBitmap | null = null
  let sheetObjectUrl: string | null = null
  let selectedTileIndex = UNBOUND

  syncSheetInputs()

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

        if (sheetImage && sheetObjectUrl && grid && tileIndex !== UNBOUND) {
          const rect = getSourceTileRect(draft.sheet, grid, tileIndex)

          if (rect.width > 0) {
            const scale = THUMBNAIL_SIZE / rect.width
            thumbnail.style.backgroundImage = `url(${sheetObjectUrl})`
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

  function update(): void {
    paintPalette(sheetImage, draft.sheet, draft.isPixelated, selectedTileIndex)
    paintPreview(session.current(), draft, sheetImage)
    renderReport()
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
      const loaded = await createImageBitmap(file)

      if (sheetObjectUrl) {
        URL.revokeObjectURL(sheetObjectUrl)
      }

      sheetImage = loaded
      sheetObjectUrl = URL.createObjectURL(file)
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

  paletteCanvas.addEventListener('pointerdown', (event) => {
    if (!sheetImage) {
      return
    }

    const bounds = paletteCanvas.getBoundingClientRect()
    const grid = getSheetGrid(draft.sheet, sheetImage.width, sheetImage.height)
    const layout = computeSheetLayout(
      sheetImage.width,
      sheetImage.height,
      paletteCanvas.clientWidth,
      paletteCanvas.clientHeight,
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

  return { update }
}
