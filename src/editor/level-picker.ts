import { requireElement } from './dom'
import type { LevelBundle, LevelListing } from './open-level'

const ENDPOINT = '/api/levels'

/**
 * The Open level picker in the top bar: every bundle in `levels/`, read through
 * the same dev-server endpoint the export writes through. A built copy of the
 * editor has no endpoint, so there the picker says so and stays disabled.
 *
 * It only fetches; what opening a level does to the editor is `index.ts`'s,
 * because it touches the session, skin mode and the publish panel at once.
 */
export function createLevelPicker(
  onOpen: (bundle: LevelBundle) => Promise<void>,
  onError: (message: string) => void,
): { readonly refresh: () => Promise<void> } {
  const select = requireElement<HTMLSelectElement>('#level-open')

  function setPlaceholder(label: string): void {
    const option = document.createElement('option')
    option.value = ''
    option.textContent = label
    select.replaceChildren(option)
  }

  async function refresh(): Promise<void> {
    let levels: LevelListing[]

    try {
      const response = await fetch(ENDPOINT)
      const body = (await response.json()) as { levels?: LevelListing[] }

      if (!response.ok || !Array.isArray(body.levels)) {
        throw new Error()
      }

      levels = body.levels
    } catch {
      setPlaceholder('open level — needs npm run editor')
      select.disabled = true

      return
    }

    setPlaceholder('open level…')
    select.disabled = false

    for (const level of levels) {
      const option = document.createElement('option')
      option.value = level.slug
      option.textContent =
        level.name === level.slug ? level.slug : `${level.name} (${level.slug})`
      select.append(option)
    }
  }

  async function open(slug: string): Promise<void> {
    const response = await fetch(`${ENDPOINT}/${encodeURIComponent(slug)}`)
    const body = (await response.json()) as Partial<LevelBundle> & {
      message?: string
    }

    if (!response.ok || typeof body.xsb !== 'string') {
      throw new Error(body.message ?? `Could not open levels/${slug}/.`)
    }

    await onOpen(body as LevelBundle)
  }

  select.addEventListener('change', () => {
    const slug = select.value
    // Back to the placeholder straight away, so picking the same level again is
    // still a change.
    select.value = ''

    if (slug === '') {
      return
    }

    select.disabled = true
    open(slug)
      .catch((error: unknown) => {
        onError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        select.disabled = false
      })
  })

  void refresh()

  return { refresh }
}
