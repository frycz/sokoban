import { requireElement } from './dom'
import type { Session } from './session'
import { readStoredText, writeStoredText } from './storage'
import { validateDocument } from './validate'
import { formatDocumentAsPublishedXsb } from './xsb'

/**
 * The tiles half of a bundle: the manifest text, the packed atlas as a data url,
 * and `tiles.json` for the cells the author placed a tile on. All three are
 * opaque to this module — skin mode builds them, this one posts them — which is
 * what keeps publishing from being a second place that knows how a skin is
 * packed.
 */
export type SkinExport = {
  readonly manifest: string
  readonly atlasDataUrl: string
  /** Null when no cell was given a tile of its own. */
  readonly customTiles: string | null
}

const ENDPOINT = '/api/levels'

/**
 * Writes the level and its tiles into the repository's `levels/` directory,
 * through a dev-server endpoint, so the game picks it up on its next load.
 *
 * It sits in the top bar rather than in either panel because a bundle is both
 * halves at once: the level from level mode and the tiles from skin mode. That
 * is the same reason `index.ts` owns Clear storage.
 *
 * The level has to be playable, which is the one hard gate — the endpoint runs
 * the game's own parser and refuses anything it would not load. Tiles are
 * optional: an incomplete skin exports as a level that plays in flat colour,
 * because a half-bound skin is a normal state to be in halfway through.
 */
export function createPublishPanel(
  session: Session,
  getSkinExport: () => SkinExport | null,
): { readonly reset: () => void } {
  const nameInput = requireElement<HTMLInputElement>('#level-name')
  const publishButton = requireElement<HTMLButtonElement>('#publish')
  const report = requireElement<HTMLElement>('#publish-report')

  nameInput.value = readStoredText('publish') ?? ''

  function setMessage(message: string, className: string): void {
    const line = document.createElement('p')
    line.className = className
    line.textContent = message
    report.replaceChildren(line)
  }

  async function publish(): Promise<void> {
    const name = nameInput.value.trim()

    if (name === '') {
      setMessage('Name the level first.', 'error')

      return
    }

    const validation = validateDocument(session.current())

    if (!validation.isPlayable) {
      setMessage(
        `Not playable: ${validation.problems.find((problem) => problem.severity === 'error')?.message ?? 'see the Level panel.'}`,
        'error',
      )

      return
    }

    const skin = getSkinExport()

    setMessage(`Exporting ${name}…`, 'warning')

    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        xsb: formatDocumentAsPublishedXsb(session.current()),
        // Level data rather than skin data, so it travels beside the XSB and
        // lands in `level.json`: a level published with an unfinished skin — no
        // tiles at all — still has its ground.
        groundColor: session.current().groundColor,
        skin,
      }),
    }

    let response: Response

    try {
      response = await fetch(ENDPOINT, request)
    } catch {
      // The endpoint is the dev server's; a built copy of the editor has
      // nothing to write to the repository with.
      setMessage(
        'Nothing to export through — this needs the editor dev server (npm run editor).',
        'error',
      )

      return
    }

    const result = await readJsonBody(response)

    if (!response.ok) {
      setMessage(
        typeof result.message === 'string'
          ? result.message
          : `The editor's dev server refused the export (${response.status}).`,
        'error',
      )

      return
    }

    writeStoredText('publish', name)
    setMessage(
      `Exported to ${String(result.directory)}${skin ? '' : ' without tiles — the skin is incomplete'}. Reload the game to play it.`,
      'ok',
    )
  }

  publishButton.addEventListener('click', () => {
    publishButton.disabled = true

    publish()
      .catch((error: unknown) => {
        setMessage(
          error instanceof Error ? error.message : String(error),
          'error',
        )
      })
      .finally(() => {
        publishButton.disabled = false
      })
  })

  /**
   * Called after storage has been cleared, like each mode's own reset: the name
   * is stored, so leaving it in the box would be the same lie.
   */
  return {
    reset: () => {
      nameInput.value = ''
      report.replaceChildren()
    },
  }
}

/**
 * The endpoint always answers in JSON, but something else might answer instead
 * — a dev server without the plugin has its own idea of what `/api/levels` is —
 * and a parse error there would be reported in place of the real problem.
 */
async function readJsonBody(
  response: Response,
): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await response.json()

    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
