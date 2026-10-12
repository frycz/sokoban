import { requireElement } from './dom'
import { createSaveId, type EditorSave, type SaveStore } from './saves'
import { readStoredText, writeStoredText } from './storage'

/** What a save is made of, gathered from the session, skin mode and publish. */
type Snapshot = Pick<EditorSave, 'level' | 'skin' | 'publish'>

type SavePanelOptions = {
  readonly store: SaveStore
  readonly getSnapshot: () => Snapshot
  /** Puts a save's work back into the editor. Owned by `index.ts`. */
  readonly onOpen: (save: EditorSave) => Promise<void>
  readonly showMessage: (message: string, className: 'ok' | 'warning') => void
  readonly showError: (message: string) => void
}

export type SavePanel = {
  /** Storage was cleared: the editor is blank work that belongs to no save. */
  readonly reset: () => void
}

/**
 * The Saves controls in the top bar. The list picks a save; Open, Delete and
 * Save act on the picked one, and Save as new names a fresh one. The save last
 * opened or written is remembered across reloads, so Save keeps going to it.
 *
 * Like the level picker it only reads and writes saves — what opening one does
 * to the editor is `index.ts`'s, because it touches every panel at once.
 */
export function createSavePanel(options: SavePanelOptions): SavePanel {
  const { store } = options
  const select = requireElement<HTMLSelectElement>('#save-list')
  const saveButton = requireElement<HTMLButtonElement>('#save')
  const saveNewButton = requireElement<HTMLButtonElement>('#save-new')
  const openButton = requireElement<HTMLButtonElement>('#save-open')
  const deleteButton = requireElement<HTMLButtonElement>('#save-delete')
  const buttons = [saveButton, saveNewButton, openButton, deleteButton]

  // The save the work in the editor came from or was last written to.
  // Stored as an empty string when there is none.
  const storedId = readStoredText('save')
  let currentId: string | null = storedId === '' ? null : storedId
  let saves: readonly EditorSave[] = []

  function setCurrent(id: string | null): void {
    currentId = id
    writeStoredText('save', id ?? '')
  }

  function findSave(id: string): EditorSave | undefined {
    return saves.find((save) => save.id === id)
  }

  function render(selectedId: string | null = currentId): void {
    const placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.textContent =
      saves.length === 0 ? 'no saves yet' : 'pick a save…'
    select.replaceChildren(placeholder)

    for (const save of saves) {
      const option = document.createElement('option')
      option.value = save.id
      option.textContent = `${save.id === currentId ? '● ' : ''}${save.name} · ${formatTime(save.savedAt)}`
      select.append(option)
    }

    select.value = selectedId !== null && findSave(selectedId) ? selectedId : ''
    syncButtons()
  }

  function syncButtons(): void {
    const hasPick = select.value !== ''

    openButton.disabled = !hasPick
    deleteButton.disabled = !hasPick
    saveButton.title = hasPick
      ? `Overwrite “${findSave(select.value)?.name ?? ''}” with the current work`
      : 'Save the current work under a new name'
  }

  async function refresh(selectedId?: string | null): Promise<void> {
    saves = await store.list()

    if (currentId !== null && !findSave(currentId)) {
      setCurrent(null)
    }

    render(selectedId === undefined ? currentId : selectedId)
  }

  async function write(id: string, name: string): Promise<void> {
    const save: EditorSave = {
      id,
      name,
      savedAt: Date.now(),
      ...options.getSnapshot(),
    }

    await store.put(save)
    setCurrent(id)
    await refresh(id)
    options.showMessage(`Saved “${name}” at ${formatTime(save.savedAt)}.`, 'ok')
  }

  async function saveAsNew(): Promise<void> {
    const currentName =
      currentId !== null ? findSave(currentId)?.name : undefined
    const publishName = options.getSnapshot().publish.name
    const suggested =
      publishName !== '' ? publishName : (currentName ?? 'untitled')
    const name = window.prompt('Name this save:', suggested)?.trim()

    if (!name) {
      return
    }

    await write(createSaveId(), name)
  }

  async function save(): Promise<void> {
    const picked = findSave(select.value)

    if (!picked) {
      await saveAsNew()

      return
    }

    // Writing over the save the work came from is the everyday case; writing
    // over a different one throws that one away, so it asks.
    if (
      picked.id !== currentId &&
      !window.confirm(
        `Overwrite “${picked.name}” with the current work? Its own contents will be lost.`,
      )
    ) {
      return
    }

    await write(picked.id, picked.name)
  }

  async function open(): Promise<void> {
    const picked = findSave(select.value)

    if (
      !picked ||
      !window.confirm(
        `Open “${picked.name}”? Unsaved work in every panel will be replaced — the level can be undone, the skin cannot.`,
      )
    ) {
      return
    }

    // Read again rather than trusting the list, which another tab may have
    // moved on from.
    const fresh = await store.get(picked.id)

    if (!fresh) {
      await refresh()

      throw new Error(`“${picked.name}” is no longer there.`)
    }

    await options.onOpen(fresh)
    setCurrent(fresh.id)
    render()
    options.showMessage(`Opened “${fresh.name}”.`, 'ok')
  }

  async function remove(): Promise<void> {
    const picked = findSave(select.value)

    if (
      !picked ||
      !window.confirm(
        `Delete the save “${picked.name}”? This cannot be undone.`,
      )
    ) {
      return
    }

    await store.remove(picked.id)

    if (picked.id === currentId) {
      setCurrent(null)
    }

    await refresh(null)
    options.showMessage(`Deleted “${picked.name}”.`, 'ok')
  }

  /** One action at a time, so a slow write cannot interleave with an open. */
  function bind(button: HTMLButtonElement, act: () => Promise<void>): void {
    button.addEventListener('click', () => {
      for (const each of buttons) {
        each.disabled = true
      }

      act()
        .catch((error: unknown) => {
          options.showError(
            `Saves: ${error instanceof Error ? error.message : String(error)}`,
          )
        })
        .finally(() => {
          saveButton.disabled = false
          saveNewButton.disabled = false
          syncButtons()
        })
    })
  }

  bind(saveButton, save)
  bind(saveNewButton, saveAsNew)
  bind(openButton, open)
  bind(deleteButton, remove)
  select.addEventListener('change', syncButtons)

  render()
  refresh().catch((error: unknown) => {
    select.disabled = true

    for (const each of buttons) {
      each.disabled = true
    }

    options.showError(
      `Saves are unavailable: ${error instanceof Error ? error.message : String(error)}`,
    )
  })

  return {
    // Storage has just been cleared, so only the variable moves: writing would
    // put the key straight back.
    reset: () => {
      currentId = null
      render(null)
    },
  }
}

function formatTime(time: number): string {
  return new Date(time).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}
