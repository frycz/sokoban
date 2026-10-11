/**
 * The editor's end of the live link from the theme colour picker: the set the
 * picker has open, as `tools/live-colors-plugin.ts` relays it. The picker is
 * another origin, so it cannot reach this page itself — the dev server takes
 * its posts and pushes them down the HMR socket this page already holds.
 *
 * Dev only, like the export button. A built editor has no `import.meta.hot`
 * and no endpoint, so subscribing there is a no-op rather than an error.
 */
const ENDPOINT = '/api/live-colors'
const EVENT = 'live-colors'

export type LiveColors = {
  /** The picker's palette and set, for saying what is being followed. */
  readonly palette: string
  readonly set: string
  /** `{ name: hex }`, the same object the picker's copy button hands over. */
  readonly colors: Readonly<Record<string, string>>
}

/** Whether this editor can follow at all: only under the dev server. */
export function canFollowLiveColors(): boolean {
  return import.meta.hot !== undefined
}

/**
 * Calls `listener` with every set the picker sends from now on. Returns the
 * unsubscribe.
 */
export function subscribeToLiveColors(
  listener: (colors: LiveColors) => void,
): () => void {
  const hot = import.meta.hot

  if (!hot) {
    return () => {}
  }

  const handle = (data: unknown) => {
    const colors = readLiveColors(data)

    if (colors !== null) {
      listener(colors)
    }
  }

  hot.on(EVENT, handle)

  return () => hot.off(EVENT, handle)
}

/**
 * The last set the picker sent, if the dev server has one — what turning the
 * link on, or reloading with it on, starts from rather than waiting for the
 * next edit in the picker.
 */
export async function fetchLiveColors(): Promise<LiveColors | null> {
  if (!canFollowLiveColors()) {
    return null
  }

  try {
    const response = await fetch(ENDPOINT)

    return response.ok ? readLiveColors(await response.json()) : null
  } catch {
    return null
  }
}

/** Checked here as well: the socket is shared, and the server is a dev tool. */
function readLiveColors(value: unknown): LiveColors | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const record = value as Record<string, unknown>
  const colors = record.colors

  if (typeof colors !== 'object' || colors === null || Array.isArray(colors)) {
    return null
  }

  return {
    palette: typeof record.palette === 'string' ? record.palette : '',
    set: typeof record.set === 'string' ? record.set : '',
    colors: colors as Record<string, string>,
  }
}
