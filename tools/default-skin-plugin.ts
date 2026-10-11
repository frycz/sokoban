import type { IncomingMessage, ServerResponse } from 'node:http'
import { access, writeFile } from 'node:fs/promises'
import { join, resolve as resolvePath } from 'node:path'
import type { Plugin } from 'vite'

/**
 * The dev build's default skin picker, server side. The choice is
 * `levels/default-skin.json`, checked in beside the levels, and a browser
 * cannot write to the repository — so the dev server does, the way it writes
 * the order.
 *
 * Serve-only, deliberately: it writes to the working tree, and nothing about it
 * reaches a built bundle.
 */
const ENDPOINT = '/api/default-skin'
const LEVELS_DIRECTORY = 'levels'
const DEFAULT_SKIN_FILE = 'default-skin.json'

/** One slug; this is just a guard. */
const MAX_BODY_BYTES = 4 * 1024

/** The shape the export endpoint gives a directory, so nothing else can name a path. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function defaultSkinPlugin(): Plugin {
  // The page that saved the choice has already applied it, and a full reload
  // would throw the dev view away. Vite still invalidates the module, so the
  // next load reads the new file.
  let isOwnWrite = false

  return {
    name: 'sokoban:default-skin',
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
          resolvePath(server.config.root, LEVELS_DIRECTORY, DEFAULT_SKIN_FILE)
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

  const choice = parseChoice(await readBody(request))

  if (typeof choice === 'string') {
    send(response, 400, { message: choice })

    return
  }

  const { from } = choice

  // The level has to have a whole skin now, so the file never starts out
  // naming something the game would have to ignore.
  if (from !== null) {
    try {
      for (const file of ['level.xsb', 'skin.json', 'skin.png']) {
        await access(join(root, LEVELS_DIRECTORY, from, file))
      }
    } catch {
      send(response, 400, {
        message: `"${from}" is not a level with a skin in levels/.`,
      })

      return
    }
  }

  beforeWrite()
  await writeFile(
    join(root, LEVELS_DIRECTORY, DEFAULT_SKIN_FILE),
    `${JSON.stringify({ from }, null, 2)}\n`,
    'utf8',
  )

  send(response, 200, { file: `${LEVELS_DIRECTORY}/${DEFAULT_SKIN_FILE}` })
}

/** Returns the choice, or the message to refuse it with. */
function parseChoice(body: string): { from: string | null } | string {
  let parsed: unknown

  try {
    parsed = JSON.parse(body)
  } catch {
    return 'The choice was not JSON.'
  }

  if (typeof parsed !== 'object' || parsed === null || !('from' in parsed)) {
    return 'The choice was not { "from": <slug or null> }.'
  }

  const from = parsed.from

  if (from !== null && (typeof from !== 'string' || !SLUG_PATTERN.test(from))) {
    return `${JSON.stringify(from)} is not a level slug.`
  }

  return { from }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    request.on('data', (chunk: Buffer) => {
      size += chunk.length

      if (size > MAX_BODY_BYTES) {
        request.destroy()
        reject(new Error('The choice was too large to accept.'))

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
