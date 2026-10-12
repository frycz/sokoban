import type { IncomingMessage, ServerResponse } from 'node:http'
import { access, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve as resolvePath } from 'node:path'
import type { Plugin } from 'vite'

/**
 * The dev build's disabling and deleting of levels, server side. Disabled
 * levels are `levels/disabled.json`, checked in beside the levels, and a level
 * is its directory in `levels/` — neither of which a browser can write, so the
 * dev server does, the way it writes the order.
 *
 * Serve-only, deliberately: it writes to the working tree, and nothing about it
 * reaches a built bundle.
 */
const DISABLED_ENDPOINT = '/api/disabled-levels'
const DELETE_ENDPOINT = '/api/delete-level'
const LEVELS_DIRECTORY = 'levels'
const DISABLED_FILE = 'disabled.json'
const ORDER_FILE = 'order.json'
const DEFAULT_SKIN_FILE = 'default-skin.json'

/** A few hundred slugs at most; this is just a guard. */
const MAX_BODY_BYTES = 64 * 1024

/** The shape the export endpoint gives a directory, so nothing else can name a path. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function levelManagePlugin(): Plugin {
  // The page that wrote these files already has what they say, and a full
  // reload would throw the dev view away. Vite still invalidates the modules,
  // so the next load reads the new files. Deleting a level's directory does
  // reload, as any change to the levels the game globs does.
  const ownWrites = new Set<string>()

  return {
    name: 'sokoban:level-manage',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root
      const markOwnWrite = (file: string) => {
        ownWrites.add(resolvePath(root, LEVELS_DIRECTORY, file))
      }

      for (const [endpoint, handle] of [
        [DISABLED_ENDPOINT, handleDisabled],
        [DELETE_ENDPOINT, handleDelete],
      ] as const) {
        server.middlewares.use(endpoint, (request, response) => {
          if (request.method !== 'POST') {
            send(response, 405, { message: `${endpoint} takes a POST.` })

            return
          }

          readBody(request)
            .then((body) => handle(body, response, root, markOwnWrite))
            .catch((error: unknown) => {
              send(response, 500, {
                message: error instanceof Error ? error.message : String(error),
              })
            })
        })
      }
    },
    handleHotUpdate({ file }) {
      if (ownWrites.delete(resolvePath(file))) {
        return []
      }

      return undefined
    },
  }
}

async function handleDisabled(
  body: string,
  response: ServerResponse,
  root: string,
  markOwnWrite: (file: string) => void,
): Promise<void> {
  const disabled = parseSlugs(body)

  if (typeof disabled === 'string') {
    send(response, 400, { message: disabled })

    return
  }

  // Every slug has to be a level that is there now, so the file never starts
  // out naming something the game would have to skip.
  for (const slug of disabled) {
    if (!(await isLevel(root, slug))) {
      send(response, 400, { message: `"${slug}" is not a level in levels/.` })

      return
    }
  }

  markOwnWrite(DISABLED_FILE)
  await writeList(root, DISABLED_FILE, disabled)

  send(response, 200, { file: `${LEVELS_DIRECTORY}/${DISABLED_FILE}` })
}

/**
 * The directory goes, and so does the slug from the lists that name it, so
 * neither starts out naming a level that is not there.
 */
async function handleDelete(
  body: string,
  response: ServerResponse,
  root: string,
  markOwnWrite: (file: string) => void,
): Promise<void> {
  const slug = parseSlug(body)

  if (slug === null) {
    send(response, 400, { message: 'The level was not { "slug": <slug> }.' })

    return
  }

  if (!(await isLevel(root, slug))) {
    send(response, 400, { message: `"${slug}" is not a level in levels/.` })

    return
  }

  if ((await readDefaultSkin(root)) === slug) {
    send(response, 400, {
      message: `"${slug}" lends the default skin; choose another one first.`,
    })

    return
  }

  for (const file of [ORDER_FILE, DISABLED_FILE]) {
    const listed = await readList(root, file)

    if (listed?.includes(slug)) {
      markOwnWrite(file)
      await writeList(
        root,
        file,
        listed.filter((listedSlug) => listedSlug !== slug),
      )
    }
  }

  await rm(join(root, LEVELS_DIRECTORY, slug), { recursive: true })

  send(response, 200, { directory: `${LEVELS_DIRECTORY}/${slug}` })
}

async function isLevel(root: string, slug: string): Promise<boolean> {
  try {
    await access(join(root, LEVELS_DIRECTORY, slug, 'level.xsb'))

    return true
  } catch {
    return false
  }
}

/** The list a file holds, or null when it is missing or not a list. */
async function readList(root: string, file: string): Promise<unknown[] | null> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(root, LEVELS_DIRECTORY, file), 'utf8'),
    )

    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** The level `default-skin.json` lends from, or null for none or no file. */
async function readDefaultSkin(root: string): Promise<unknown> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(root, LEVELS_DIRECTORY, DEFAULT_SKIN_FILE), 'utf8'),
    )

    return typeof parsed === 'object' && parsed !== null && 'from' in parsed
      ? parsed.from
      : null
  } catch {
    return null
  }
}

async function writeList(
  root: string,
  file: string,
  list: readonly unknown[],
): Promise<void> {
  await writeFile(
    join(root, LEVELS_DIRECTORY, file),
    `${JSON.stringify(list, null, 2)}\n`,
    'utf8',
  )
}

/** Returns the slugs, or the message to refuse them with. */
function parseSlugs(body: string): string[] | string {
  let parsed: unknown

  try {
    parsed = JSON.parse(body)
  } catch {
    return 'The list was not JSON.'
  }

  if (!Array.isArray(parsed)) {
    return 'The list was not a list.'
  }

  const slugs: string[] = []

  for (const slug of parsed) {
    if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
      return `${JSON.stringify(slug)} is not a level slug.`
    }

    if (slugs.includes(slug)) {
      return `"${slug}" is listed twice.`
    }

    slugs.push(slug)
  }

  return slugs
}

function parseSlug(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body)

    if (typeof parsed !== 'object' || parsed === null || !('slug' in parsed)) {
      return null
    }

    const { slug } = parsed

    return typeof slug === 'string' && SLUG_PATTERN.test(slug) ? slug : null
  } catch {
    return null
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    request.on('data', (chunk: Buffer) => {
      size += chunk.length

      if (size > MAX_BODY_BYTES) {
        request.destroy()
        reject(new Error('The request was too large to accept.'))

        return
      }

      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function send(
  response: ServerResponse,
  status: number,
  payload: Record<string, string>,
): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(payload))
}
