import { requireElement } from './dom'
import type { Session } from './session'
import { readStoredText, writeStoredText } from './storage'
import { validateDocument } from './validate'
import { formatDocumentAsPublishedXsb } from './xsb'

/**
 * The tiles half of a bundle: the manifest text, the packed atlas as a data url,
 * and `tiles.json` for the layer stack and the tiles painted on it. All three are
 * opaque to this module — skin mode builds them, this one posts them — which is
 * what keeps publishing from being a second place that knows how a skin is
 * packed.
 */
export type SkinExport = {
  readonly manifest: string
  readonly atlasDataUrl: string
  /** Null when the level draws in the default order with no art layers. */
  readonly layers: string | null
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
export type PublishPanel = {
  readonly reset: () => void
  /**
   * A level was opened from `levels/`: its name goes in the box, and Export
   * writes back to the directory it came from for as long as the name is left
   * alone.
   */
  readonly showOpened: (
    name: string,
    slug: string,
    problems: readonly string[],
  ) => void
  readonly showError: (message: string) => void
}

/**
 * The name in the box, and the directory it was last opened from or exported
 * to. A plain string is what an older build stored: a name with no directory.
 */
type StoredPublish = {
  readonly name: string
  readonly slug: string | null
}

function readStoredPublish(): StoredPublish {
  const text = readStoredText('publish') ?? ''

  try {
    const parsed: unknown = JSON.parse(text)

    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>

      return {
        name: typeof record.name === 'string' ? record.name : '',
        slug: typeof record.slug === 'string' ? record.slug : null,
      }
    }
  } catch {
    // Not JSON, so the name on its own.
  }

  return { name: text, slug: null }
}

export function createPublishPanel(
  session: Session,
  getSkinExport: () => SkinExport | null,
  onExported: () => void,
): PublishPanel {
  const nameInput = requireElement<HTMLInputElement>('#level-name')
  const publishButton = requireElement<HTMLButtonElement>('#publish')
  const report = requireElement<HTMLElement>('#publish-report')

  // The level's home in `levels/`, and the name it had there. A directory is a
  // slug of the name only for levels the editor made — `Original 1` lives in
  // `original-01/` — so an opened level remembers where it came from, and a
  // rename is what moves it somewhere new.
  let home: StoredPublish = readStoredPublish()

  nameInput.value = home.name

  function storeHome(): void {
    writeStoredText('publish', JSON.stringify(home))
  }

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
        slug: home.slug !== null && home.name === name ? home.slug : undefined,
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

    home = {
      name,
      slug: typeof result.slug === 'string' ? result.slug : null,
    }
    storeHome()
    onExported()
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
      home = { name: '', slug: null }
      nameInput.value = ''
      report.replaceChildren()
    },
    showOpened: (name, slug, problems) => {
      home = { name, slug }
      storeHome()
      nameInput.value = name
      setMessage(
        `Opened levels/${slug}/ — Export writes back to it unless the name changes.`,
        'ok',
      )

      for (const problem of problems) {
        const line = document.createElement('p')
        line.className = 'warning'
        line.textContent = problem
        report.append(line)
      }
    },
    showError: (message) => setMessage(message, 'error'),
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
