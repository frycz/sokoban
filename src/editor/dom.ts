/**
 * Shared by the mode modules so each can look up its own elements without
 * either owning the other's, and so `index.ts` stays a mode switch.
 */
export function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)

  if (!element) {
    throw new Error(`Expected ${selector} in the document`)
  }

  return element
}

/** A mode owns one panel: its elements, its listeners, and its redraw. */
export type EditorMode = {
  update: () => void
  /**
   * Discards the mode's own state, for when stored state is cleared. Each mode
   * does its own, because only it knows what it was holding; `index.ts` owns the
   * button because clearing storage is not a level or a skin concern.
   */
  reset: () => void
  /** Returns whether the key was consumed. Modes without keys omit it. */
  handleKey?: (event: KeyboardEvent) => boolean
}

/**
 * A picked file as a data url, which is both what `localStorage` can hold and
 * what a CSS `background-image` and `createImageBitmap` can read — so one
 * string serves the thumbnails, the preview and the stored copy, and there is
 * no object url to remember to revoke.
 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    // `readAsDataURL` always yields a string, but the type does not say so.
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)

        return
      }

      reject(new Error(`Could not read ${file.name} as text`))
    })
    reader.addEventListener('error', () =>
      reject(reader.error ?? new Error(`Could not read ${file.name}`)),
    )
    reader.readAsDataURL(file)
  })
}

/**
 * The way back: a stored data url as the bitmap the painters draw. Through an
 * `Image` rather than `fetch` plus `createImageBitmap`, because an `img` has
 * read a data url in every browser for twenty years.
 */
export function readDataUrlAsImageBitmap(
  dataUrl: string,
): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const image = new Image()

    image.addEventListener('load', () => {
      createImageBitmap(image).then(resolve, reject)
    })
    image.addEventListener('error', () =>
      reject(new Error('The stored tile sheet is not a readable image')),
    )
    image.src = dataUrl
  })
}

/**
 * Enter commits a colour field. A text input fires `change` on Enter only when
 * it is inside a form, and none of the editor's are, so Enter blurs it instead
 * — which is the gesture that squares a half-typed hex up with the value it was
 * editing, and is what leaving the field means anyway.
 */
export function commitFieldOnEnter(event: KeyboardEvent): void {
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
    event.target.blur()
  }
}

/**
 * A hex onto the system clipboard, so it can be pasted into the other panel's
 * colour field — or out of the editor entirely, into the art program the sheet
 * came from, which is half of what a palette is for.
 *
 * Returns whether it landed rather than throwing: the clipboard is refused in
 * an insecure context and in a window that has not been interacted with, and
 * the panel says so in its status line while staying usable — the hex is on
 * screen to read either way.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)

    return true
  } catch {
    return false
  }
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
