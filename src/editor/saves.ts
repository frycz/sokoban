/**
 * Named snapshots of the work, kept until they are deleted — unlike the
 * autosave, which holds one editor's worth and is overwritten by every edit.
 *
 * They live in IndexedDB rather than `localStorage`, because a save carries the
 * skin's sheet as a data url and a handful of those is past the few megabytes
 * `localStorage` allows a page. The level and the skin are stored as the same
 * text the autosave writes, so there is still one codec for each.
 */
export type EditorSave = {
  readonly id: string
  readonly name: string
  /** Milliseconds since the epoch, for the list's order and its labels. */
  readonly savedAt: number
  /** `encodeStoredLevel` text. */
  readonly level: string
  /** `encodeStoredSkin` text. */
  readonly skin: string
  /** The publish panel's name and directory, so Export still goes home. */
  readonly publish: { readonly name: string; readonly slug: string | null }
}

export type SaveStore = {
  /** Newest first. */
  readonly list: () => Promise<readonly EditorSave[]>
  readonly get: (id: string) => Promise<EditorSave | null>
  readonly put: (save: EditorSave) => Promise<void>
  readonly remove: (id: string) => Promise<void>
}

const DATABASE = 'sokoban.editor'
const STORE = 'saves'

/**
 * Field by field, like every other stored record: a save is read back by a
 * later build than the one that wrote it, and one that does not read is left
 * out of the list rather than breaking it.
 */
export function readSave(value: unknown): EditorSave | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const record = value as Record<string, unknown>
  const publish =
    typeof record.publish === 'object' && record.publish !== null
      ? (record.publish as Record<string, unknown>)
      : {}

  if (
    typeof record.id !== 'string' ||
    record.id === '' ||
    typeof record.level !== 'string' ||
    typeof record.skin !== 'string'
  ) {
    return null
  }

  return {
    id: record.id,
    name: typeof record.name === 'string' ? record.name : record.id,
    savedAt: typeof record.savedAt === 'number' ? record.savedAt : 0,
    level: record.level,
    skin: record.skin,
    publish: {
      name: typeof publish.name === 'string' ? publish.name : '',
      slug: typeof publish.slug === 'string' ? publish.slug : null,
    },
  }
}

export function createSaveId(): string {
  return `save-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () =>
      reject(request.error ?? new Error('Browser storage refused the request')),
    )
  })
}

function openDatabase(): Promise<IDBDatabase> {
  let request: IDBOpenDBRequest

  try {
    request = window.indexedDB.open(DATABASE, 1)
  } catch {
    return Promise.reject(new Error('Browser storage is unavailable here.'))
  }

  request.addEventListener('upgradeneeded', () => {
    request.result.createObjectStore(STORE, { keyPath: 'id' })
  })

  return settle(request)
}

/**
 * Opens the database once and on first use, so an embedding without IndexedDB
 * costs the editor its saves and nothing else: every call rejects with a
 * message the panel can show.
 */
export function createSaveStore(): SaveStore {
  let database: Promise<IDBDatabase> | null = null

  async function run<T>(
    mode: IDBTransactionMode,
    act: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    database ??= openDatabase()
    database.catch(() => {
      // Retried on the next call rather than remembered as broken.
      database = null
    })

    const transaction = (await database).transaction(STORE, mode)
    // A write is only kept once its transaction commits, which can still fail
    // on quota after the request itself succeeded.
    const committed = new Promise<void>((resolve, reject) => {
      transaction.addEventListener('complete', () => resolve())
      transaction.addEventListener('abort', () =>
        reject(transaction.error ?? new Error('Browser storage is full.')),
      )
    })
    // Handled below; this only keeps a failed request from also reporting the
    // abort that follows it as unhandled.
    committed.catch(() => undefined)
    const result = await settle(act(transaction.objectStore(STORE)))

    await committed

    return result
  }

  return {
    list: async () => {
      const records = await run('readonly', (store) => store.getAll())

      return records
        .map(readSave)
        .filter((save): save is EditorSave => save !== null)
        .sort((a, b) => b.savedAt - a.savedAt)
    },
    get: async (id) =>
      readSave(await run('readonly', (store) => store.get(id))),
    put: async (save) => {
      await run('readwrite', (store) => store.put(save))
    },
    remove: async (id) => {
      await run('readwrite', (store) => store.delete(id))
    },
  }
}
