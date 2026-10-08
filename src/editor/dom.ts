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
  /** Returns whether the key was consumed. Modes without keys omit it. */
  handleKey?: (event: KeyboardEvent) => boolean
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
