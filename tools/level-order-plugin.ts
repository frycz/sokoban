import type { IncomingMessage, ServerResponse } from 'node:http'
import { access, writeFile } from 'node:fs/promises'
import { join, resolve as resolvePath } from 'node:path'
import type { Plugin } from 'vite'

/**
 * The dev build's level reordering, server side. The campaign order is
 * `levels/order.json`, checked in beside the levels, and a browser cannot write
 * to the repository — so the dev server does, the way the editor's export does.
 *
 * Serve-only, deliberately: it writes to the working tree, and nothing about it
 * reaches a built bundle.
 */
const ENDPOINT = '/api/level-order'
const LEVELS_DIRECTORY = 'levels'
const ORDER_FILE = 'order.json'

/** A few hundred slugs at most; this is just a guard. */
const MAX_BODY_BYTES = 64 * 1024

/** The shape the export endpoint gives a directory, so nothing else can name a path. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function levelOrderPlugin(): Plugin {
  // The page that saved the order already has it, and a full reload would
  // throw the dev view away mid-drag. Vite still invalidates the module, so
  // the next load reads the new file.
  let isOwnWrite = false

  return {
    name: 'sokoban:level-order',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(ENDPOINT, (request, response) => {
        handle(request, response, server.config.root, () => {
          isOwnWrite = true
        }).catch((error: unknown) => {
          send(response, 500, {
            message: error instanceof Error ? error.message : String(error),
          })
        })
      })
    },
    handleHotUpdate({ file, server }) {
      if (
        isOwnWrite &&
        resolvePath(file) ===
          resolvePath(server.config.root, LEVELS_DIRECTORY, ORDER_FILE)
      ) {
        isOwnWrite = false

        return []
      }

      return undefined
    },
  }
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
  beforeWrite: () => void,
): Promise<void> {
  if (request.method !== 'POST') {
    send(response, 405, { message: `${ENDPOINT} takes a POST.` })

    return
  }

  const order = parseOrder(await readBody(request))

  if (typeof order === 'string') {
    send(response, 400, { message: order })

    return
  }

  // Every slug has to be a level that is there now, so the file never starts
  // out naming something the game would have to skip.
  for (const slug of order) {
    try {
      await access(join(root, LEVELS_DIRECTORY, slug, 'level.xsb'))
    } catch {
      send(response, 400, { message: `"${slug}" is not a level in levels/.` })

      return
    }
  }

  beforeWrite()
  await writeFile(
    join(root, LEVELS_DIRECTORY, ORDER_FILE),
    `${JSON.stringify(order, null, 2)}\n`,
    'utf8',
  )

  send(response, 200, { file: `${LEVELS_DIRECTORY}/${ORDER_FILE}` })
}

/** Returns the order, or the message to refuse it with. */
function parseOrder(body: string): string[] | string {
  let parsed: unknown

  try {
    parsed = JSON.parse(body)
  } catch {
    return 'The order was not JSON.'
  }

  if (!Array.isArray(parsed)) {
    return 'The order was not a list.'
  }

  const order: string[] = []

  for (const slug of parsed) {
    if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
      return `${JSON.stringify(slug)} is not a level slug.`
    }

    if (order.includes(slug)) {
      return `"${slug}" is listed twice.`
    }

    order.push(slug)
  }

  return order
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    request.on('data', (chunk: Buffer) => {
      size += chunk.length

      if (size > MAX_BODY_BYTES) {
        request.destroy()
        reject(new Error('The order was too large to accept.'))

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
