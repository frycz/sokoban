/**
 * The player's progress, kept in `localStorage` and written on every move, so
 * a reload's Continue puts them back on the same level, in the same position,
 * with the same undo stack, the same counts and the same clock.
 *
 * A level is referred to by its slug rather than its place in the campaign, so
 * reordering the levels does not move a player onto a level they never played.
 */

export type LevelResult = {
  readonly slug: string
  readonly name: string
  readonly moves: number
  readonly pushes: number
  readonly timeMs: number
}

/** The level in progress: the moves made so far and the time spent on it. */
type LevelProgress = {
  readonly slug: string
  /** LURD, uppercase for a push — the history, replayable. */
  readonly lurd: string
  readonly timeMs: number
}

export type Save = {
  /** Null once the last level is solved: the campaign is over. */
  readonly current: LevelProgress | null
  readonly completed: readonly LevelResult[]
}

const VERSION = 1

/** The save, or null when the stored value is not one this build wrote. */
export function parseSave(value: unknown): Save | null {
  if (!isRecord(value) || value.version !== VERSION) {
    return null
  }

  const current = value.current === null ? null : parseProgress(value.current)

  if (current === undefined || !Array.isArray(value.completed)) {
    return null
  }

  const completed: LevelResult[] = []

  for (const entry of value.completed) {
    const result = parseResult(entry)

    if (!result) {
      return null
    }

    completed.push(result)
  }

  return { current, completed }
}

export function serializeSave(save: Save): string {
  return JSON.stringify({ version: VERSION, ...save })
}

export type Resume = {
  readonly index: number
  readonly lurd: string
  readonly timeMs: number
}

/**
 * Where Continue goes, or null when there is nothing to continue. The saved
 * level when it still exists; otherwise — it was removed, or renamed — the
 * first level the player has not solved, from the start of it.
 */
export function resolveResume(
  save: Save,
  slugs: readonly string[],
): Resume | null {
  if (!save.current) {
    return null
  }

  const index = slugs.indexOf(save.current.slug)

  if (index !== -1) {
    return { index, lurd: save.current.lurd, timeMs: save.current.timeMs }
  }

  const solved = new Set(save.completed.map((result) => result.slug))
  const unsolved = slugs.findIndex((slug) => !solved.has(slug))

  return unsolved === -1 ? null : { index: unsolved, lurd: '', timeMs: 0 }
}

/**
 * `localStorage` can be missing or throw — a private window, blocked site data
 * — and the game has to play regardless, just without remembering.
 */
export function readStoredSave(key: string): Save | null {
  try {
    const text = localStorage.getItem(key)

    return text === null ? null : parseSave(JSON.parse(text))
  } catch {
    return null
  }
}

export function writeStoredSave(key: string, save: Save): void {
  try {
    localStorage.setItem(key, serializeSave(save))
  } catch {
    // Nowhere to keep it; the game carries on.
  }
}

function parseProgress(value: unknown): LevelProgress | undefined {
  if (
    !isRecord(value) ||
    typeof value.slug !== 'string' ||
    typeof value.lurd !== 'string' ||
    !isCount(value.timeMs)
  ) {
    return undefined
  }

  return { slug: value.slug, lurd: value.lurd, timeMs: value.timeMs }
}

function parseResult(value: unknown): LevelResult | null {
  if (
    !isRecord(value) ||
    typeof value.slug !== 'string' ||
    typeof value.name !== 'string' ||
    !isCount(value.moves) ||
    !isCount(value.pushes) ||
    !isCount(value.timeMs)
  ) {
    return null
  }

  return {
    slug: value.slug,
    name: value.name,
    moves: value.moves,
    pushes: value.pushes,
    timeMs: value.timeMs,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** `m:ss`, or `h:mm:ss` past the hour. */
export function formatDuration(timeMs: number): string {
  const totalSeconds = Math.floor(timeMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`
}
